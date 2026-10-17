"""The ``X-Client-Id`` request header: which browser tab made a request.

The frontend generates one id per tab (``src/lib/client-id.ts``) and sends it
on every request. The middleware below stores it for the request's duration,
and the workspace event bus echoes it onto the published event as
``client_id``: a client can then tell its own events from everyone else's,
including its user's other tabs (docs/SPEC.md §WebSockets).
"""

from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

HEADER = "X-Client-Id"

# The id is echoed to every member of the workspace, so bound it: the
# frontend sends a 36-char UUID. Anything longer is dropped, not truncated
# (a truncated id could alias another tab's).
MAX_LENGTH = 64

_client_id: ContextVar[str | None] = ContextVar("client_id", default=None)


def get_client_id() -> str | None:
    """The id of the tab that made the current request, when it sent one."""
    return _client_id.get()


class ClientIdMiddleware(BaseHTTPMiddleware):
    """Store the request's ``X-Client-Id`` for the code that publishes events."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        value = request.headers.get(HEADER)
        token = _client_id.set(value if value and len(value) <= MAX_LENGTH else None)
        try:
            return await call_next(request)
        finally:
            _client_id.reset(token)
