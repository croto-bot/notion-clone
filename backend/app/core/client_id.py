"""Tab id echoed on workspace events.

The frontend generates one UUID per browser tab. HTTP requests send it as
``X-Client-Id``; the collab socket sends the same value as ``client_id``.
The wide-event context holds the HTTP value for the request. A collab save
is not an HTTP request, so it passes the socket's id into the event bus
directly. A value that is not a UUID is dropped: a truncated or arbitrary
string must not alias another tab.
"""

import re

from app.core.logging.context import get_wide_event_context

HEADER = "X-Client-Id"

_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def parse_client_id(value: str | None) -> str | None:
    """Return ``value`` when it is a UUID, else None."""
    if value and _UUID.fullmatch(value):
        return value
    return None


def get_client_id() -> str | None:
    """The tab id of the current HTTP request, when it sent a UUID."""
    ctx = get_wide_event_context()
    if ctx is None:
        return None
    return ctx.client_id
