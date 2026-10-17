"""The collaboration server: y-websocket rooms backed by ``pages.ydoc_state``.

One process-wide ``CollabServer`` (like the event bus, the deployment runs a
single backend process). Its ``WebsocketServer`` keeps one ``YRoom`` per page
that has (or had) a connected socket; rooms are never deleted while the
process lives, which removes the create/delete race between a last
disconnect and a new connect: a reconnect finds its room with the freshest
in-memory state.

Persistence (SPEC §WebSockets):

- the page's stored ``ydoc_state`` is applied to the room's doc when the room
  is first created;
- every document change marks the room dirty; a flush loop persists dirty
  rooms about once a second (debounce) and the endpoint persists on the last
  disconnect;
- persisting also extracts the plain text of the ``document-store`` fragment
  into ``content_text`` and sets ``last_edited_*`` (to the user who most
  recently sent a document update).

Concurrent writers are serialized by one lock per page, shared by room
creation, ``PUT /pages/{id}/document`` and the flush: the room is always
built from the newest stored state, the flush writes inside the lock, and
the dirty flag is cleared only after a successful write (a change that
arrives during the write marks the room dirty again).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from loguru import logger
from pycrdt import create_awareness_message
from pycrdt.websocket import WebsocketServer, YRoom, exception_logger
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.dependencies import get_engine
from app.modules.pages.yjs import extract_text

if TYPE_CHECKING:
    from pycrdt import Channel, Subscription
    from sqlalchemy.ext.asyncio import AsyncSession

FLUSH_INTERVAL_S = 1.0
# Bounded retries at shutdown: a dead database must not hang the process.
SHUTDOWN_FLUSH_ROUNDS = 3
# A beat between the shutdown rounds, so a failed flush is retried after
# the pool or the database had a moment to come back, not in a tight loop.
SHUTDOWN_FLUSH_GAP_S = 0.3


def _session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False)


class PageRoom(YRoom):
    """A room that also tells a new client who is already on the page.

    ``YRoom.serve`` only relays awareness between clients, so a client that
    connects later never learns the presence of the ones already in the room.
    The y-websocket JS server sends the room's current awareness on connect;
    this mirrors that behaviour.
    """

    async def serve(self, channel: Channel) -> None:
        states = [
            client_id
            for client_id, state in self.awareness.states.items()
            if client_id != self.awareness.client_id and state
        ]
        if states:
            await channel.send(
                create_awareness_message(self.awareness.encode_awareness_update(states))
            )
        await super().serve(channel)


class CollabServer:
    """Rooms, dirty tracking and debounced persistence for page documents."""

    def __init__(self) -> None:
        self._server = WebsocketServer(
            rooms_ready=False,
            auto_clean_rooms=False,
            exception_handler=exception_logger,
        )
        self._dirty: set[str] = set()
        self._changes: dict[str, int] = {}
        self._writers: dict[str, uuid.UUID] = {}
        self._subscriptions: dict[str, Subscription] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._starter: asyncio.Task[None] | None = None
        self._flusher: asyncio.Task[None] | None = None

    # --- lifecycle ------------------------------------------------------------

    async def start(self) -> None:
        """Start the room server and the debounce flush loop (app startup)."""
        # Keep the reference: an unreferenced task can be garbage collected.
        self._starter = asyncio.create_task(
            self._server.start(), name="collab-room-server"
        )
        await self._server.started.wait()
        self._flusher = asyncio.create_task(
            self._flush_loop(), name="collab-flush-loop"
        )

    async def stop(self) -> None:
        """Persist everything (retrying until clean), then stop the loops."""
        for _round in range(SHUTDOWN_FLUSH_ROUNDS):
            if not self._dirty:
                break
            if _round:
                await asyncio.sleep(SHUTDOWN_FLUSH_GAP_S)
            await self.flush_all()
        else:
            logger.error(
                "collab shutdown gives up on dirty pages: {pages}",
                pages=sorted(self._dirty),
            )
        if self._flusher is not None:
            self._flusher.cancel()
            await asyncio.gather(self._flusher, return_exceptions=True)
            self._flusher = None
        await self._server.stop()
        if self._starter is not None:
            await asyncio.gather(self._starter, return_exceptions=True)
            self._starter = None

    # --- rooms ----------------------------------------------------------------

    def page_lock(self, page_id: uuid.UUID) -> asyncio.Lock:
        """The per-page lock shared by room creation, ``PUT /document`` and flush."""
        if (lock := self._locks.get(str(page_id))) is None:
            lock = self._locks[str(page_id)] = asyncio.Lock()
        return lock

    async def get_room(self, page_id: uuid.UUID) -> YRoom:
        """Return the page's room, creating it with the stored state.

        The stored ``ydoc_state`` is read inside the page lock, so a
        ``PUT /pages/{id}/document`` that commits while the socket connects
        (it holds the same lock) can never be overwritten by a room built
        from older bytes.
        """
        name = str(page_id)
        async with self.page_lock(page_id):
            if room := self._server.rooms.get(name):
                return room
            initial_state = await self._stored_state(page_id)
            room = PageRoom(ready=False, exception_handler=exception_logger)
            if initial_state:
                room.ydoc.apply_update(initial_state)
            room.ready = True
            self._server.rooms[name] = room
            await self._server.start_room(room)
            self._subscriptions[name] = room.ydoc.observe(
                lambda _event, _name=name: self._touch(_name)
            )
            return room

    async def _stored_state(self, page_id: uuid.UUID) -> bytes | None:
        from app.modules.pages.repository import PageRepository  # circular-safe

        async with _session_factory()() as session:
            return await PageRepository(session).stored_state(page_id)

    def room_state(self, page_id: uuid.UUID) -> bytes | None:
        """The live document state, or None when no room exists."""
        room = self._server.rooms.get(str(page_id))
        if room is None:
            return None
        return room.ydoc.get_update()

    def apply_external_update(self, page_id: uuid.UUID, update: bytes) -> None:
        """Feed an out-of-band update (PUT /pages/{id}/document) to the room.

        The room then broadcasts it to its clients and the flush loop stores
        it like any other change. A page without a room needs nothing: the
        caller wrote the database directly.
        """
        if not update:
            return
        if room := self._server.rooms.get(str(page_id)):
            room.ydoc.apply_update(update)

    def note_write(self, page_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """Record the user who most recently sent a document update."""
        self._writers[str(page_id)] = user_id

    async def may_write(self, page_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Fresh write-access check for one incoming document push.

        One joined read in its own short session (the connect-time check is
        long gone by then). The page must be out of the trash and the member
        must still have a write role, so a trash, demotion or removal after
        connect takes effect from the client's next push.
        """
        from app.modules.pages.repository import PageRepository  # circular-safe
        from app.modules.workspaces.models import WorkspaceRole

        async with _session_factory()() as session:
            access = await PageRepository(session).write_access(page_id, user_id)
            if access is None:
                return False
            deleted_at, role = access
            return deleted_at is None and role != WorkspaceRole.VIEWER

    def _touch(self, name: str) -> None:
        self._dirty.add(name)
        self._changes[name] = self._changes.get(name, 0) + 1

    # --- persistence ----------------------------------------------------------

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            try:
                await self.flush_all()
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                logger.error("collab flush failed: {exc}", exc=exc)

    async def flush_all(self) -> None:
        for name in list(self._dirty):
            try:
                await self.flush_page(uuid.UUID(name))
            except Exception as exc:  # noqa: BLE001 - one page must not stop the rest
                logger.error(
                    "collab flush of page {name} failed: {exc}", name=name, exc=exc
                )

    async def flush_page(self, page_id: uuid.UUID) -> None:
        """Persist the room's document if it changed since the last flush.

        The write runs inside the page lock and the dirty flag is cleared
        only after it succeeds; a change that arrives during the write has
        already marked the room dirty again, so the next flush keeps it.
        """
        name = str(page_id)
        room = self._server.rooms.get(name)
        if room is None:
            return
        from app.modules.pages.repository import PageRepository  # circular-safe

        async with self.page_lock(page_id):
            if name not in self._dirty:
                return
            state = room.ydoc.get_update()
            writer = self._writers.get(name)
            seen_changes = self._changes.get(name, 0)
            content_text = extract_text(state)
            async with _session_factory()() as session:
                repo = PageRepository(session)
                await repo.set_document(
                    page_id,
                    ydoc_state=state,
                    content_text=content_text,
                    last_edited_by_id=writer,
                    last_edited_at=datetime.now(tz=UTC),
                )
            if self._changes.get(name, 0) == seen_changes:
                self._dirty.discard(name)

    def dirty_pages(self) -> set[str]:  # observability for logs
        return set(self._dirty)


def get_collab_server() -> CollabServer:
    """Return the process-wide collab server."""
    global _SERVER
    if _SERVER is None:
        _SERVER = CollabServer()
    return _SERVER


_SERVER: CollabServer | None = None
