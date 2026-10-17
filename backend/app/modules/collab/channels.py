"""WebSocket channel adapters for the collab socket.

``StarletteChannel`` adapts a Starlette/FastAPI ``WebSocket`` to pycrdt's
``Channel`` protocol (what ``YRoom.serve`` consumes). ``ReadOnlyChannel``
drops a client's document (sync) messages while awareness keeps flowing, and
``WriteTrackingChannel`` records who last sent a document update.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from anyio import Lock
from pycrdt import YMessageType, YSyncMessageType
from starlette.websockets import WebSocketDisconnect

if TYPE_CHECKING:
    from starlette.websockets import WebSocket


class Channel(Protocol):
    """The transport pycrdt's YRoom serves (pycrdt._provider.Channel)."""

    @property
    def path(self) -> str: ...

    async def send(self, message: bytes) -> None: ...

    async def recv(self) -> bytes: ...


class StarletteChannel:
    """A Starlette WebSocket as a pycrdt Channel."""

    def __init__(self, websocket: WebSocket, path: str) -> None:
        self._websocket = websocket
        self._path = path
        self._send_lock = Lock()

    @property
    def path(self) -> str:
        return self._path

    async def send(self, message: bytes) -> None:
        async with self._send_lock:
            try:
                await self._websocket.send_bytes(message)
            except (WebSocketDisconnect, RuntimeError):
                # The socket closed under us (a client that left between two
                # sends). Letting this raise tears down pycrdt's room task
                # group and restarts the room on every late send; the client's
                # own recv loop notices the disconnect and cleans it up.
                return

    async def recv(self) -> bytes:
        try:
            message = await self._websocket.receive_bytes()
        except WebSocketDisconnect as exc:
            raise StopAsyncIteration from exc
        return bytes(message)

    def __aiter__(self) -> StarletteChannel:
        return self

    async def __anext__(self) -> bytes:
        return await self.recv()


class ReadOnlyChannel:
    """Passes sync requests and awareness through, drops state pushes.

    Used for viewers and for trashed pages (SPEC §WebSockets): the client
    still receives the current document (its sync step 1 asks for it) and
    live awareness, but nothing it sends can change the document - its sync
    step 2 (its own state) and update messages are dropped.
    """

    def __init__(self, inner: Channel) -> None:
        self._inner = inner

    @property
    def path(self) -> str:
        return self._inner.path

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        while True:
            message = await self._inner.recv()  # StopAsyncIteration propagates
            if message[0] == int(YMessageType.SYNC) and message[1] != int(
                YSyncMessageType.SYNC_STEP1
            ):
                continue
            return message

    def __aiter__(self) -> ReadOnlyChannel:
        return self

    async def __anext__(self) -> bytes:
        return await self.recv()


class WriteTrackingChannel:
    """Marks the page edited on every document message this client sends."""

    def __init__(self, inner: Channel, on_write) -> None:  # noqa: ANN001 (callback)
        self._inner = inner
        self._on_write = on_write

    @property
    def path(self) -> str:
        return self._inner.path

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        message = await self._inner.recv()
        if message[0] == int(YMessageType.SYNC):
            self._on_write()
        return message

    def __aiter__(self) -> WriteTrackingChannel:
        return self

    async def __anext__(self) -> bytes:
        return await self.recv()
