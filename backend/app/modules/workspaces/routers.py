"""Workspaces router - workspace and member endpoints (SPEC §3)."""

import uuid

from fastapi import APIRouter, Body, Depends, status

from app.core.logging import log_action, log_entity
from app.modules.workspaces.dependencies import get_workspace_service
from app.modules.workspaces.models import Workspace, WorkspaceRole
from app.modules.workspaces.schemas import (
    MemberAddRequest,
    MemberResponse,
    MemberUpdateRequest,
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.modules.workspaces.service import WorkspaceService
from app.user.auth import require_current_user_id

workspaces_router = APIRouter(
    prefix="/workspaces",
    tags=["workspaces"],
    dependencies=[Depends(require_current_user_id)],
)


def _response(workspace: Workspace, role: WorkspaceRole) -> WorkspaceResponse:
    response = WorkspaceResponse.model_validate(workspace)
    response.role = role
    return response


@workspaces_router.get("", status_code=status.HTTP_200_OK)
async def list_workspaces(
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> list[WorkspaceResponse]:
    """My workspaces, each with my role (not paged)."""
    log_action("list")
    rows = await workspace_service.list_for_user(user_id)
    return [_response(workspace, role) for workspace, role in rows]


@workspaces_router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    workspace: WorkspaceCreate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceResponse:
    """Create a workspace; the creator becomes its owner."""
    log_action("create")
    result, role = await workspace_service.create(workspace, user_id=user_id)
    log_entity("workspaces", result.id)
    return _response(result, role)


@workspaces_router.get("/{workspace_id}", status_code=status.HTTP_200_OK)
async def get_workspace(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceResponse:
    log_action("get")
    workspace, role = await workspace_service.get_for_user(workspace_id, user_id)
    return _response(workspace, role)


@workspaces_router.patch("/{workspace_id}", status_code=status.HTTP_200_OK)
async def update_workspace(
    workspace_id: uuid.UUID,
    workspace: WorkspaceUpdate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> WorkspaceResponse:
    log_action("update")
    log_entity("workspaces", workspace_id)
    result, role = await workspace_service.update(
        workspace_id, workspace, user_id=user_id
    )
    return _response(result, role)


@workspaces_router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> None:
    log_action("delete")
    log_entity("workspaces", workspace_id)
    await workspace_service.delete(workspace_id, user_id=user_id)


@workspaces_router.get("/{workspace_id}/members", status_code=status.HTTP_200_OK)
async def list_members(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> list[MemberResponse]:
    log_action("list_members")
    return await workspace_service.list_members(workspace_id, user_id=user_id)


@workspaces_router.post("/{workspace_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(
    workspace_id: uuid.UUID,
    payload: MemberAddRequest = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> MemberResponse:
    log_action("add_member")
    log_entity("workspaces", workspace_id)
    return await workspace_service.add_member(workspace_id, payload, user_id=user_id)


@workspaces_router.patch(
    "/{workspace_id}/members/{target_user_id}", status_code=status.HTTP_200_OK
)
async def update_member(
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
    payload: MemberUpdateRequest = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> MemberResponse:
    log_action("update_member")
    log_entity("workspace_members", target_user_id)
    return await workspace_service.update_member(
        workspace_id, target_user_id, payload.role, user_id=user_id
    )


@workspaces_router.delete(
    "/{workspace_id}/members/{target_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
) -> None:
    log_action("remove_member")
    log_entity("workspace_members", target_user_id)
    await workspace_service.remove_member(workspace_id, target_user_id, user_id=user_id)
