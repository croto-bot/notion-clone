"""Workspace repositories - database access layer."""

import uuid

from sqlalchemy import func, select

from app.modules.workspaces.models import Workspace, WorkspaceMember
from app.repositories.sql_repository import SQLAlchemyRepository
from app.user.models import User


class WorkspaceRepository(SQLAlchemyRepository[Workspace]):
    model = Workspace

    async def create_with_owner(
        self, workspace: Workspace, owner_member: WorkspaceMember
    ) -> Workspace:
        """Insert the workspace and its owner membership in one transaction."""
        self._session.add_all([workspace, owner_member])
        await self._session.commit()
        await self._session.refresh(workspace)
        return workspace


class WorkspaceMemberRepository(SQLAlchemyRepository[WorkspaceMember]):
    model = WorkspaceMember

    async def get_membership(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> WorkspaceMember | None:
        statement = (
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
        result = await self._session.execute(statement)
        return result.scalar_one_or_none()

    async def list_for_user(
        self, user_id: uuid.UUID
    ) -> list[tuple[Workspace, WorkspaceMember]]:
        statement = (
            select(Workspace, WorkspaceMember)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user_id)
            .order_by(Workspace.created_at)
        )
        result = await self._session.execute(statement)
        return [(workspace, member) for workspace, member in result.all()]

    async def count_owners(self, workspace_id: uuid.UUID) -> int:
        statement = (
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role == "owner",
            )
        )
        result = await self._session.execute(statement)
        return int(result.scalar_one())

    async def list_members_with_users(
        self, workspace_id: uuid.UUID
    ) -> list[tuple[WorkspaceMember, User]]:
        statement = (
            select(WorkspaceMember, User)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(WorkspaceMember.workspace_id == workspace_id)
            .order_by(WorkspaceMember.created_at)
        )
        result = await self._session.execute(statement)
        return [(member, user) for member, user in result.all()]
