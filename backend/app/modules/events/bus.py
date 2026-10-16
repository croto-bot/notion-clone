"""In-process pub/sub for workspace events.

One queue per connected ``/workspaces/{id}/events`` socket; services publish
an event after their transaction commits and every queue of that workspace
receives it. The bus is process-wide (the deployment runs one backend
process), so every socket served by this process sees every event.

Payload contract (docs/SPEC.md §WebSockets)::

    {"type": "page.created", "page_id": "<uuid>", "actor_id": "<uuid>"}
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import uuid

# Queue capacity per socket. A slow client must not block publishers; when the
# queue is full the event is dropped for that client only.
_QUEUE_SIZE = 256


class WorkspaceEventBus:
    """Fan-out of workspace events to subscriber queues."""

    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[asyncio.Queue[dict[str, Any]]]] = {}

    def subscribe(self, workspace_id: uuid.UUID) -> asyncio.Queue[dict[str, Any]]:
        """Register a queue for the workspace's events."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_SIZE)
        self._subscribers.setdefault(workspace_id, set()).add(queue)
        return queue

    def unsubscribe(
        self, workspace_id: uuid.UUID, queue: asyncio.Queue[dict[str, Any]]
    ) -> None:
        """Remove a queue; safe to call twice."""
        if queues := self._subscribers.get(workspace_id):
            queues.discard(queue)
            if not queues:
                del self._subscribers[workspace_id]

    def publish(self, workspace_id: uuid.UUID, event: dict[str, Any]) -> None:
        """Deliver the event to every subscriber of the workspace, now."""
        for queue in list(self._subscribers.get(workspace_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A client that cannot keep up loses events; it refetches its
                # state on the next one. Never block the publishing request.
                continue

    def subscriber_count(self, workspace_id: uuid.UUID) -> int:
        """Number of live subscribers (observability, used by logs)."""
        return len(self._subscribers.get(workspace_id, ()))


def get_event_bus() -> WorkspaceEventBus:
    """Return the process-wide bus (one backend process serves every socket)."""
    global _BUS
    if _BUS is None:
        _BUS = WorkspaceEventBus()
    return _BUS


_BUS: WorkspaceEventBus | None = None
