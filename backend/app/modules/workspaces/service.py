"""Workspace service - business logic layer."""

import uuid

from pydantic import BaseModel

from app.exceptions import ForbiddenError
from app.modules.events.bus import WorkspaceEventBus
from app.modules.workspaces.exceptions import AlreadyMemberError, LastOwnerError
from app.modules.workspaces.models import Workspace, WorkspaceMember, WorkspaceRole
from app.modules.workspaces.repository import (
    WorkspaceMemberRepository,
    WorkspaceRepository,
)
from app.modules.workspaces.schemas import MemberAddRequest, MemberResponse
from app.repositories.exceptions import NotFoundError
from app.services.base_crud_service import BaseService
from app.user.auth.exceptions import UserNotFoundError
from app.user.repository import UserRepository
from app.user.schemas import normalize_email


class WorkspaceService(BaseService[Workspace]):
    """Workspaces, membership and roles (SPEC §2-3).

    A user sees a workspace only as a member: for a non-member, every method
    raises the same 404 as for a missing workspace. Owner-only changes
    (rename, icon, delete, member management) raise 403 ``forbidden`` for
    other members.
    """

    def __init__(
        self,
        repo: WorkspaceRepository,
        member_repo: WorkspaceMemberRepository,
        user_repo: UserRepository,
        event_bus: WorkspaceEventBus,
    ) -> None:
        self.repo = repo
        self.member_repo = member_repo
        self.user_repo = user_repo
        self.event_bus = event_bus

    # --- helpers -------------------------------------------------------------

    async def get_membership(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> WorkspaceMember | None:
        return await self.member_repo.get_membership(workspace_id, user_id)

    async def _member_or_404(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> WorkspaceMember:
        member = await self.get_membership(workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Workspace {workspace_id} not found")
        return member

    async def _workspace_for_user(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Workspace, WorkspaceMember]:
        member = await self._member_or_404(workspace_id, user_id)
        workspace = await self.repo.get(workspace_id, raise_error=False)
        if workspace is None:
            raise NotFoundError(detail=f"Workspace {workspace_id} not found")
        return workspace, member

    @staticmethod
    def _require_owner(member: WorkspaceMember) -> None:
        if member.role != WorkspaceRole.OWNER:
            raise ForbiddenError()

    def _publish(
        self, workspace_id: uuid.UUID, event_type: str, actor_id: uuid.UUID
    ) -> None:
        self.event_bus.publish(
            workspace_id, {"type": event_type, "actor_id": str(actor_id)}
        )

    # --- workspaces ----------------------------------------------------------

    async def list_for_user(
        self, user_id: uuid.UUID
    ) -> list[tuple[Workspace, WorkspaceRole]]:
        rows = await self.member_repo.list_for_user(user_id)
        return [(workspace, member.role) for workspace, member in rows]

    async def get_for_user(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Workspace, WorkspaceRole]:
        workspace, member = await self._workspace_for_user(workspace_id, user_id)
        return workspace, member.role

    async def create(self, entity: BaseModel, *, user_id: uuid.UUID) -> Workspace:
        values = entity.model_dump()
        workspace = Workspace(
            id=uuid.uuid4(),
            name=values["name"],
            icon=values["icon"],
            owner_id=user_id,
        )
        owner_member = WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user_id,
            role=WorkspaceRole.OWNER,
        )
        created = await self.repo.create_with_owner(workspace, owner_member)
        self._log_entity(created.id)
        return created, WorkspaceRole.OWNER

    async def update(
        self,
        workspace_id: uuid.UUID,
        entity: BaseModel,
        *,
        user_id: uuid.UUID,
    ) -> tuple[Workspace, WorkspaceRole]:
        _, member = await self._workspace_for_user(workspace_id, user_id)
        self._require_owner(member)
        updated = await self.repo.update(workspace_id, entity)
        self._publish(workspace_id, "workspace.updated", actor_id=user_id)
        return updated, member.role

    async def delete(self, workspace_id: uuid.UUID, *, user_id: uuid.UUID) -> None:
        _, member = await self._workspace_for_user(workspace_id, user_id)
        self._require_owner(member)
        await self.repo.delete(workspace_id)

    # --- members ---------------------------------------------------------------

    async def list_members(
        self, workspace_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> list[MemberResponse]:
        await self._member_or_404(workspace_id, user_id)
        rows = await self.member_repo.list_members_with_users(workspace_id)
        return [
            MemberResponse(
                user_id=member.user_id,
                email=user.email,
                display_name=user.display_name,
                role=member.role,
                joined_at=member.created_at,
            )
            for member, user in rows
        ]

    async def add_member(
        self,
        workspace_id: uuid.UUID,
        payload: MemberAddRequest,
        *,
        user_id: uuid.UUID,
    ) -> MemberResponse:
        member = await self._member_or_404(workspace_id, user_id)
        self._require_owner(member)
        target = await self.user_repo.get_by_field(
            "email", normalize_email(payload.email), raise_error=False
        )
        if target is None:
            raise UserNotFoundError()
        if await self.member_repo.get_membership(workspace_id, target.id) is not None:
            raise AlreadyMemberError()
        created = await self.member_repo.create(
            {
                "workspace_id": workspace_id,
                "user_id": target.id,
                "role": payload.role,
            }
        )
        self._publish(workspace_id, "members.changed", actor_id=user_id)
        return MemberResponse(
            user_id=target.id,
            email=target.email,
            display_name=target.display_name,
            role=created.role,
            joined_at=created.created_at,
        )

    async def update_member(
        self,
        workspace_id: uuid.UUID,
        target_user_id: uuid.UUID,
        role: WorkspaceRole,
        *,
        user_id: uuid.UUID,
    ) -> MemberResponse:
        member = await self._member_or_404(workspace_id, user_id)
        self._require_owner(member)
        target = await self.member_repo.get_membership(workspace_id, target_user_id)
        if target is None:
            raise NotFoundError(detail=f"Member {target_user_id} not found")
        if (
            target.role == WorkspaceRole.OWNER
            and role != WorkspaceRole.OWNER
            and await self.member_repo.count_owners(workspace_id) == 1
        ):
            raise LastOwnerError()
        updated = await self.member_repo.update(target.id, {"role": role})
        target_user = await self.user_repo.get(target_user_id)
        self._publish(workspace_id, "members.changed", actor_id=user_id)
        return MemberResponse(
            user_id=updated.user_id,
            email=target_user.email,
            display_name=target_user.display_name,
            role=updated.role,
            joined_at=updated.created_at,
        )

    async def remove_member(
        self,
        workspace_id: uuid.UUID,
        target_user_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
    ) -> None:
        member = await self._member_or_404(workspace_id, user_id)
        if member.user_id != target_user_id:
            self._require_owner(member)
        target = await self.member_repo.get_membership(workspace_id, target_user_id)
        if target is None:
            raise NotFoundError(detail=f"Member {target_user_id} not found")
        if target.role == WorkspaceRole.OWNER and (
            await self.member_repo.count_owners(workspace_id) == 1
        ):
            raise LastOwnerError()
        await self.member_repo.delete(target.id)
        self._publish(workspace_id, "members.changed", actor_id=user_id)
