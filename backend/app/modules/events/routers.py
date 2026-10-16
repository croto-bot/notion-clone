"""Workspace events WebSocket: one JSON event per change (SPEC §WebSockets)."""

import asyncio
import contextlib
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.websockets import (
    WS_CLOSE_NOT_FOUND,
    authenticate_socket,
    log_socket,
    refuse_socket,
)
from app.dependencies import get_db_session
from app.modules.events.bus import WorkspaceEventBus, get_event_bus
from app.modules.workspaces.dependencies import get_workspace_service
from app.user.auth.dependencies import get_auth_service
from app.user.auth.service import AuthService

PATH_TEMPLATE = "/workspaces/{workspace_id}/events"

events_router = APIRouter(tags=["events"])


@events_router.websocket(PATH_TEMPLATE)
async def workspace_events(
    websocket: WebSocket,
    workspace_id: uuid.UUID,
    token: str = "",
    auth_service: AuthService = Depends(get_auth_service),
    workspace_service: Any = Depends(get_workspace_service),
    event_bus: WorkspaceEventBus = Depends(get_event_bus),
    session: AsyncSession = Depends(get_db_session),
) -> None:
    """Push workspace events to a member until the client disconnects.

    ``?token=<session token>`` authenticates (browsers cannot set headers on
    a WebSocket): a bad token closes with 4401, a non-member with 4404.
    """
    path = websocket.url.path
    user = await authenticate_socket(websocket, auth_service, token)
    if user is None:
        log_socket(PATH_TEMPLATE, path, 401)
        return
    member = await workspace_service.get_membership(workspace_id, user.id)
    if member is None:
        await refuse_socket(websocket, WS_CLOSE_NOT_FOUND)
        log_socket(PATH_TEMPLATE, path, 404)
        return

    # End the setup transaction now: the socket below can stay open for
    # hours, and its request-scoped session must not hold locks that long.
    await session.commit()
    await websocket.accept()
    # Logged at accept: the connection succeeded, however long it stays open.
    log_socket(PATH_TEMPLATE, path, 200)
    queue = event_bus.subscribe(workspace_id)

    async def deliver() -> None:
        while True:
            event = await queue.get()
            await websocket.send_text(json.dumps(event))

    sender = asyncio.create_task(deliver())
    try:
        # Clients send nothing; reading is how the server sees the close at
        # once, instead of on the next event (which may never come).
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await sender
        event_bus.unsubscribe(workspace_id, queue)
