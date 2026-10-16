"""Collab router: the per-page y-websocket endpoint (SPEC §WebSockets)."""

import uuid
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.websockets import (
    WS_CLOSE_NOT_FOUND,
    authenticate_socket,
    log_socket,
    refuse_socket,
)
from app.dependencies import get_db_session
from app.modules.collab.channels import (
    Channel,
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

    # End the setup transaction now: the socket below can stay open for
    # hours, and its request-scoped session must not hold locks that long.
    await session.commit()
    await websocket.accept()
    # Logged at accept: the connection succeeded, however long it stays open.
    log_socket(PATH_TEMPLATE, path, 200)
    room = await collab_server.get_room(page_id, page.ydoc_state)
    base = StarletteChannel(websocket, str(page_id))
    channel: Channel  # noqa: F821  (TYPE_CHECKING import; runtime is a channel wrapper)
    if read_only:
        channel = ReadOnlyChannel(base)
    else:
        channel = WriteTrackingChannel(
            base, lambda: collab_server.note_write(page_id, user.id)
        )

    try:
        await room.serve(channel)
    except Exception:  # noqa: BLE001 - a broken socket must not kill the app
        pass
    finally:
        if not read_only:
            # The last disconnect persists right away (no debounce wait).
            await collab_server.flush_page(page_id)
