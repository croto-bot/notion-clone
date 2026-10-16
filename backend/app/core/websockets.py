"""Shared WebSocket helpers: token authentication with close codes.

Browsers cannot set headers on a WebSocket handshake, so the sockets of this
app authenticate with ``?token=<session id>`` in the query string. A bad token
closes the socket with code 4401; that contract lives here so every socket
behaves the same.
"""

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.user.auth.service import AuthService
from app.user.models import User

# Close codes (4xxx: application-defined, no standard meaning).
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_NOT_FOUND = 4404


async def authenticate_socket(
    websocket: WebSocket, auth_service: AuthService, token: str
) -> User | None:
    """Validate ``token``; on failure accept-then-close with 4401.

    Closing before the handshake is accepted would answer with a plain HTTP
    403, which the client cannot read as a close code. Accepting first lets
    the server deliver the application close code, as the spec requires.

    Returns the authenticated user, or None when the socket was closed.
    """
    try:
        user = await auth_service.validate_session(token)
    except Exception:
        await websocket.accept()
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return None
    return user


async def refuse_socket(websocket: WebSocket, close_code: int) -> None:
    """Accept the handshake, then close with an application close code."""
    if websocket.client_state == WebSocketState.CONNECTING:
        await websocket.accept()
    await websocket.close(code=close_code)


def log_socket(path_template: str, path: str, status_code: int) -> None:
    """Log one line per WebSocket connection, shaped like a wide event.

    ``WideEventMiddleware`` only sees HTTP requests, so without this line a
    socket connection is invisible to the logs and to the route-coverage
    guard (tests/e2e/guards.py), which reads the server output.
    """
    from loguru import logger

    logger.bind(
        method="WEBSOCKET",
        path=path,
        path_template=path_template,
        status_code=status_code,
    ).info("websocket_completed")
