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
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from loguru import logger
from pycrdt.websocket import WebsocketServer, YRoom, exception_logger
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.dependencies import get_engine
from app.modules.pages.yjs import extract_text

if TYPE_CHECKING:
    from pycrdt import Subscription
    from sqlalchemy.ext.asyncio import AsyncSession

FLUSH_INTERVAL_S = 1.0


def _session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False)


class CollabServer:
    """Rooms, dirty tracking and debounced persistence for page documents."""

    def __init__(self) -> None:
        self._server = WebsocketServer(
            rooms_ready=False,
            auto_clean_rooms=False,
            exception_handler=exception_logger,
        )
        self._dirty: set[str] = set()
        self._writers: dict[str, uuid.UUID] = {}
        self._subscriptions: dict[str, Subscription] = {}
        self._lock = asyncio.Lock()
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
        """Persist everything, then stop the loops (app shutdown)."""
        await self.flush_all()
        if self._flusher is not None:
            self._flusher.cancel()
            await asyncio.gather(self._flusher, return_exceptions=True)
            self._flusher = None
        await self._server.stop()
        if self._starter is not None:
            await asyncio.gather(self._starter, return_exceptions=True)
            self._starter = None

    # --- rooms ----------------------------------------------------------------

    async def get_room(self, page_id: uuid.UUID, initial_state: bytes | None) -> YRoom:
        """Return the page's room, creating it with the stored state."""
        name = str(page_id)
        async with self._lock:
            if room := self._server.rooms.get(name):
                return room
            room = YRoom(ready=False, exception_handler=exception_logger)
            if initial_state:
                room.ydoc.apply_update(initial_state)
            room.ready = True
            self._server.rooms[name] = room
            await self._server.start_room(room)
            self._subscriptions[name] = room.ydoc.observe(
                lambda _event, _name=name: self._dirty.add(_name)
            )
            return room

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
        """Persist the room's document if it changed since the last flush."""
        name = str(page_id)
        room = self._server.rooms.get(name)
        if room is None:
            return
        async with self._lock:
            if name not in self._dirty:
                return
            self._dirty.discard(name)
            state = room.ydoc.get_update()
            writer = self._writers.get(name)
        content_text = extract_text(state)
        from app.modules.pages.repository import PageRepository  # circular-safe

        async with _session_factory()() as session:
            repo = PageRepository(session)
            await repo.set_document(
                page_id,
                ydoc_state=state,
                content_text=content_text,
                last_edited_by_id=writer,
                last_edited_at=datetime.now(tz=UTC),
            )

    def dirty_pages(self) -> set[str]:  # observability for logs
        return set(self._dirty)


def get_collab_server() -> CollabServer:
    """Return the process-wide collab server."""
    global _SERVER
    if _SERVER is None:
        _SERVER = CollabServer()
    return _SERVER


_SERVER: CollabServer | None = None
