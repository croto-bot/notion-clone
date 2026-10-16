"""Dependency factory functions for the pages module."""

from typing import Any

from fastapi import Depends

from app.dependencies import get_repository
from app.modules.events.bus import WorkspaceEventBus, get_event_bus
from app.modules.pages.repository import (
    PageFavoriteRepository,
    PageRepository,
    PageVisitRepository,
)
from app.modules.pages.service import PageService
from app.modules.workspaces.repository import WorkspaceMemberRepository
from app.user.repository import UserRepository


def _collab_server() -> Any:  # imported lazily: collab.server imports pages.yjs
    from app.modules.collab.server import get_collab_server

    return get_collab_server()


def get_page_service(
    repo: PageRepository = Depends(get_repository(PageRepository)),
    favorite_repo: PageFavoriteRepository = Depends(
        get_repository(PageFavoriteRepository)
    ),
    visit_repo: PageVisitRepository = Depends(get_repository(PageVisitRepository)),
    member_repo: WorkspaceMemberRepository = Depends(
        get_repository(WorkspaceMemberRepository)
    ),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
    event_bus: WorkspaceEventBus = Depends(get_event_bus),
    collab_server: Any = Depends(_collab_server),
) -> PageService:
    return PageService(
        repo=repo,
        favorite_repo=favorite_repo,
        visit_repo=visit_repo,
        member_repo=member_repo,
        user_repo=user_repo,
        event_bus=event_bus,
        collab_server=collab_server,
    )
