"""Dependency factory functions for the comments module."""

from fastapi import Depends

from app.dependencies import get_repository
from app.modules.comments.repository import CommentRepository
from app.modules.comments.service import CommentService
from app.modules.events.bus import WorkspaceEventBus, get_event_bus
from app.modules.pages.repository import PageRepository
from app.modules.workspaces.repository import WorkspaceMemberRepository
from app.user.repository import UserRepository


def get_comment_service(
    repo: CommentRepository = Depends(get_repository(CommentRepository)),
    page_repo: PageRepository = Depends(get_repository(PageRepository)),
    member_repo: WorkspaceMemberRepository = Depends(
        get_repository(WorkspaceMemberRepository)
    ),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
    event_bus: WorkspaceEventBus = Depends(get_event_bus),
) -> CommentService:
    return CommentService(
        repo=repo,
        page_repo=page_repo,
        member_repo=member_repo,
        user_repo=user_repo,
        event_bus=event_bus,
    )
