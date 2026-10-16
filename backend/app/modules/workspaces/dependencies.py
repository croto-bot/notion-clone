"""Dependency factory functions for the workspaces module."""

from fastapi import Depends

from app.dependencies import get_repository
from app.modules.events.bus import WorkspaceEventBus, get_event_bus
from app.modules.workspaces.repository import (
    WorkspaceMemberRepository,
    WorkspaceRepository,
)
from app.modules.workspaces.service import WorkspaceService
from app.user.repository import UserRepository


def get_workspace_service(
    repo: WorkspaceRepository = Depends(get_repository(WorkspaceRepository)),
    member_repo: WorkspaceMemberRepository = Depends(
        get_repository(WorkspaceMemberRepository)
    ),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
    event_bus: WorkspaceEventBus = Depends(get_event_bus),
) -> WorkspaceService:
    return WorkspaceService(
        repo=repo, member_repo=member_repo, user_repo=user_repo, event_bus=event_bus
    )
