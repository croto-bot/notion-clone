"""Comments service - discussions under a page (SPEC §3)."""

import uuid

from app.exceptions import ForbiddenError
from app.modules.comments.models import Comment
from app.modules.comments.repository import CommentRepository
from app.modules.comments.schemas import CommentCreate, CommentUpdate
from app.modules.events.bus import WorkspaceEventBus
from app.modules.pages.exceptions import PageInTrashError
from app.modules.pages.models import Page
from app.modules.pages.repository import PageRepository
from app.modules.pages.schemas import UserRef
from app.modules.workspaces.models import WorkspaceMember, WorkspaceRole
from app.modules.workspaces.repository import WorkspaceMemberRepository
from app.repositories.exceptions import NotFoundError
from app.services.base_crud_service import BaseService
from app.user.repository import UserRepository


class CommentService(BaseService[Comment]):
    """Comments: viewers may comment; the author edits the body; editors+ resolve."""

    def __init__(
        self,
        repo: CommentRepository,
        page_repo: PageRepository,
        member_repo: WorkspaceMemberRepository,
        user_repo: UserRepository,
        event_bus: WorkspaceEventBus,
    ) -> None:
        self.repo = repo
        self.page_repo = page_repo
        self.member_repo = member_repo
        self.user_repo = user_repo
        self.event_bus = event_bus

    async def _access_page(
        self, page_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Page, WorkspaceMember]:
        page = await self.page_repo.get(page_id, raise_error=False)
        if page is None:
            raise NotFoundError(detail=f"Page {page_id} not found")
        member = await self.member_repo.get_membership(page.workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Page {page_id} not found")
        return page, member

    def _publish(
        self, workspace_id: uuid.UUID, actor_id: uuid.UUID, page_id: uuid.UUID
    ) -> None:
        self.event_bus.publish(
            workspace_id,
            {
                "type": "comment.changed",
                "page_id": str(page_id),
                "actor_id": str(actor_id),
            },
        )

    async def _author_ref(self, author_id: uuid.UUID) -> UserRef:
        user = await self.user_repo.get(author_id)
        return UserRef(id=user.id, display_name=user.display_name, email=user.email)

    async def list_comments(
        self, page_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> list[tuple[Comment, UserRef]]:
        await self._access_page(page_id, user_id)
        comments = await self.repo.list_of_page(page_id)
        authors: dict[uuid.UUID, UserRef] = {}
        result = []
        for comment in comments:
            if comment.author_id not in authors:
                authors[comment.author_id] = await self._author_ref(comment.author_id)
            result.append((comment, authors[comment.author_id]))
        return result

    async def create_comment(
        self, page_id: uuid.UUID, payload: CommentCreate, *, user_id: uuid.UUID
    ) -> tuple[Comment, UserRef]:
        page, _member = await self._access_page(page_id, user_id)
        if page.deleted_at is not None:
            raise PageInTrashError()
        if payload.parent_id is not None:
            # A reply hangs under a discussion of the same page: a comment id
            # from any other page (or workspace) is not a visible parent.
            parent = await self.repo.get(payload.parent_id, raise_error=False)
            if parent is None or parent.page_id != page_id:
                raise NotFoundError(detail=f"Comment {payload.parent_id} not found")
        created = await self.repo.create(
            {
                "page_id": page_id,
                "author_id": user_id,
                "parent_id": payload.parent_id,
                "body": payload.body,
            }
        )
        self._log_entity(created.id)
        self._publish(page.workspace_id, user_id, page_id)
        return created, await self._author_ref(user_id)

    async def update_comment(
        self,
        comment_id: uuid.UUID,
        payload: CommentUpdate,
        *,
        user_id: uuid.UUID,
    ) -> tuple[Comment, UserRef]:
        comment, page, member = await self._access_comment(comment_id, user_id)
        values: dict[str, object] = payload.model_dump(exclude_unset=True)
        if "body" in values:
            if comment.author_id != user_id:
                raise ForbiddenError(detail="Only the author can edit the body")
            values["edited"] = True
        if "resolved" in values:
            if member.role == WorkspaceRole.VIEWER:
                raise ForbiddenError(detail="Only editors can resolve comments")
        updated = await self.repo.update(comment_id, values)
        self._log_entity(comment_id)
        self._publish(page.workspace_id, user_id, page.id)
        return updated, await self._author_ref(comment.author_id)

    async def delete_comment(
        self, comment_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> None:
        comment, page, member = await self._access_comment(comment_id, user_id)
        if comment.author_id != user_id and member.role != WorkspaceRole.OWNER:
            raise ForbiddenError(detail="Only the author or the owner can delete")
        await self.repo.delete(comment_id)
        self._log_entity(comment_id)
        self._publish(page.workspace_id, user_id, page.id)

    async def _access_comment(
        self, comment_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Comment, Page, WorkspaceMember]:
        row = await self.repo.get_with_page(comment_id)
        if row is None:
            raise NotFoundError(detail=f"Comment {comment_id} not found")
        comment, page = row
        member = await self.member_repo.get_membership(page.workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Comment {comment_id} not found")
        return comment, page, member
