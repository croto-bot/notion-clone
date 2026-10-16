"""Events module: the workspace events WebSocket and its in-process bus."""

from .bus import WorkspaceEventBus, get_event_bus

__all__ = [
    "WorkspaceEventBus",
    "get_event_bus",
]
