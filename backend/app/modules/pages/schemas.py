"""Pages schemas - request and response models."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.optional_model import partial_model
from app.modules.pages.models import PageFont, PageKind
from app.modules.workspaces.models import WorkspaceRole


class UserRef(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str


class Breadcrumb(BaseModel):
    id: uuid.UUID
    title: str
    icon: str | None


class PageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    parent_id: uuid.UUID | None
    kind: PageKind
    title: str
    icon: str | None
    position: str
    is_public: bool
    deleted_at: datetime | None
    updated_at: datetime
    last_edited_at: datetime
    has_children: bool = False

    @classmethod
    def from_page(cls, page: Any, *, has_children: bool = False) -> "PageSummary":
        summary = cls.model_validate(page)
        summary.has_children = has_children
        return summary


class PageResponse(PageSummary):
    cover: str | None
    cover_position: int
    full_width: bool
    small_text: bool
    locked: bool
    font: PageFont
    public_id: str | None
    created_by: UserRef | None
    last_edited_by: UserRef | None
    created_at: datetime
    database_schema: list[dict[str, Any]] | None
    database_views: list[dict[str, Any]] | None
    properties: dict[str, Any]
    breadcrumbs: list[Breadcrumb]
    is_favorite: bool
    role: WorkspaceRole


class SearchResult(PageSummary):
    snippet: str
    breadcrumbs: list[Breadcrumb]


class PageCreate(BaseModel):
    workspace_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    kind: PageKind = PageKind.PAGE
    title: str = Field("", max_length=4096)
    icon: str | None = Field(None, max_length=64)
    after_id: uuid.UUID | None = None
    properties: dict[str, Any] | None = None


class PageUpdate(BaseModel):
    title: str = Field("", max_length=4096)
    icon: str | None = Field(None, max_length=64)
    cover: str | None = Field(None, max_length=2048)
    cover_position: int = Field(50, ge=0, le=100)
    full_width: bool = False
    small_text: bool = False
    locked: bool = False
    font: PageFont = PageFont.DEFAULT
    is_public: bool = False
    database_schema: list[dict[str, Any]] | None = None
    database_views: list[dict[str, Any]] | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


@partial_model
class PageUpdatePatch(PageUpdate):
    """Any subset of PageUpdate's fields (PATCH)."""


class MoveRequest(BaseModel):
    parent_id: uuid.UUID | None
    after_id: uuid.UUID | None = None


class DocumentResponse(BaseModel):
    state: str | None


class DocumentUpdate(BaseModel):
    """A Yjs update, base64-encoded; validated here so bad input is a 422."""

    state: bytes

    @field_validator("state", mode="before")
    @classmethod
    def decode_base64(cls, value: Any) -> bytes:
        if isinstance(value, bytes):
            return value
        import base64
        import binascii

        try:
            return base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as err:
            raise ValueError("state must be valid base64") from err


class PublicRow(BaseModel):
    id: uuid.UUID
    title: str
    icon: str | None
    properties: dict[str, Any]
    # Computed columns (created_time / last_edited_time) read these; without
    # them every such column renders empty and filters on them hide all rows.
    created_at: datetime
    last_edited_at: datetime


class PublicChild(BaseModel):
    id: uuid.UUID
    title: str
    icon: str | None
    public_id: str | None


class PublicPageResponse(BaseModel):
    id: uuid.UUID
    title: str
    icon: str | None
    cover: str | None
    cover_position: int
    full_width: bool
    small_text: bool
    font: PageFont
    kind: PageKind
    state: str | None
    database_schema: list[dict[str, Any]] | None
    database_views: list[dict[str, Any]] | None
    rows: list[PublicRow]
    children: list[PublicChild]
