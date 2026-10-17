"""Collab router: the per-page y-websocket endpoint (SPEC §WebSockets)."""

import uuid
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_id import parse_client_id
from app.core.websockets import (
    WS_CLOSE_NOT_FOUND,
    authenticate_socket,
    log_socket,
    refuse_socket,
)
from app.dependencies import get_db_session
from app.modules.collab.channels import (
    Channel,
    GuardedChannel,
    ReadOnlyChannel,
    StarletteChannel,
    WriteTrackingChannel,
)
from app.modules.collab.server import CollabServer, get_collab_server
from app.modules.pages.dependencies import get_page_service
from app.user.auth.dependencies import get_auth_service
from app.user.auth.service import AuthService

if TYPE_CHECKING:
    from app.modules.collab.channels import Channel

PATH_TEMPLATE = "/pages/{page_id}/collab"

collab_router = APIRouter(tags=["collab"])


@collab_router.websocket(PATH_TEMPLATE)
async def collab_socket(
    websocket: WebSocket,
    page_id: uuid.UUID,
    token: str = "",
    client_id: str = "",
    auth_service: AuthService = Depends(get_auth_service),
    page_service: Any = Depends(get_page_service),
    collab_server: CollabServer = Depends(get_collab_server),
    session: AsyncSession = Depends(get_db_session),
) -> None:
    """Sync one page's Yjs document and awareness with a member's client.

    ``?token=<session token>`` authenticates: a bad token closes with 4401,
    a missing page or a non-member with 4404. Viewers and trashed pages are
    read-only: their document updates are dropped (awareness still works).
    """
    path = websocket.url.path
    user = await authenticate_socket(websocket, auth_service, token)
    if user is None:
        log_socket(PATH_TEMPLATE, path, 401)
        return
    access = await page_service.socket_access(page_id, user.id)
    if access is None:
        await refuse_socket(websocket, WS_CLOSE_NOT_FOUND)
        log_socket(PATH_TEMPLATE, path, 404)
        return
    from app.modules.workspaces.models import WorkspaceRole

    page, member = access
    read_only = page.deleted_at is not None or member.role == WorkspaceRole.VIEWER
    tab = parse_client_id(client_id)

    # End the setup transaction now: the socket below can stay open for
    # hours, and its request-scoped session must not hold locks that long.
    await session.commit()
    await websocket.accept()
    # Logged at accept: the connection succeeded, however long it stays open.
    log_socket(PATH_TEMPLATE, path, 200)
    room = await collab_server.get_room(page_id)
    base = StarletteChannel(websocket, str(page_id))
    channel: Channel  # noqa: F821  (TYPE_CHECKING import; runtime is a channel wrapper)
    if read_only:
        channel = ReadOnlyChannel(base)
    else:
        # Write access is re-checked on every push: trash or a demotion that
        # happens after connect takes effect from the next message on. The
        # guard sits inside the tracker, so a dropped push never credits its
        # sender as the page's last editor.
        channel = WriteTrackingChannel(
            GuardedChannel(base, lambda: collab_server.may_write(page_id, user.id)),
            lambda: collab_server.note_write(page_id, user.id, client_id=tab),
        )

    # serve() never raises: the room's exception_handler (pycrdt's
    # exception_logger) logs and discards every error, a broken socket too.
    try:
        await room.serve(channel)
    finally:
        if not read_only:
            # The last disconnect persists right away (no debounce wait).
            await collab_server.flush_page(page_id)
