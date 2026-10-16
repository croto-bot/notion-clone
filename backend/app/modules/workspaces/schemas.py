"""Workspace schemas - request and response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.optional_model import partial_model
from app.database.mixins import OrmBaseModel
from app.modules.workspaces.models import WorkspaceRole


class WorkspaceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: str | None = Field(None, max_length=64)


class WorkspaceCreate(WorkspaceBase):
    pass


@partial_model
class WorkspaceUpdate(WorkspaceBase):
    """All fields omittable (PATCH)."""


class WorkspaceResponse(WorkspaceBase, OrmBaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    # Default only so model_validate can run on the ORM row (which has no
    # role): every caller sets the requesting member's role right after.
    role: WorkspaceRole = WorkspaceRole.VIEWER
    created_at: datetime
    updated_at: datetime


class MemberResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role: WorkspaceRole
    joined_at: datetime


class MemberAddRequest(BaseModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.VIEWER


class MemberUpdateRequest(BaseModel):
    role: WorkspaceRole


class MemberRow(BaseModel):
    """A member row joined with its user, internal to the module."""

    model_config = ConfigDict(from_attributes=True)

    workspace_id: uuid.UUID
    user_id: uuid.UUID
    role: WorkspaceRole
    email: str
    display_name: str
    joined_at: datetime
