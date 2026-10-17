"""Page models: pages (the tree, databases and their rows), favorites, visits."""

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.database.mixins import TimestampMixin


class PageKind(enum.StrEnum):
    PAGE = "page"
    DATABASE = "database"


class PageFont(enum.StrEnum):
    DEFAULT = "default"
    SERIF = "serif"
    MONO = "mono"


class Page(TimestampMixin, Base):
    __tablename__ = "pages"
    __table_args__ = (
        # Two live siblings can never share a position (sidebar order must be
        # total). Partial because parent_id is null at the root and distinct
        # nulls would dodge a plain unique index, and because trashed rows do
        # not sit in any sidebar: they keep their last position while parked.
        Index(
            "uq_pages_position_under_parent",
            "workspace_id",
            "parent_id",
            "position",
            unique=True,
            postgresql_where=text("parent_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_pages_position_at_root",
            "workspace_id",
            "position",
            unique=True,
            postgresql_where=text("parent_id IS NULL AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), default=None, index=True
    )
    kind: Mapped[PageKind] = mapped_column(
        Enum(PageKind, name="pagekind"), default=PageKind.PAGE
    )
    title: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str | None] = mapped_column(String(64), default=None)
    cover: Mapped[str | None] = mapped_column(Text, default=None)
    cover_position: Mapped[int] = mapped_column(Integer, default=50)
    position: Mapped[str] = mapped_column(String(255), default="a0")
    full_width: Mapped[bool] = mapped_column(Boolean, default=False)
    small_text: Mapped[bool] = mapped_column(Boolean, default=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    font: Mapped[PageFont] = mapped_column(
        Enum(PageFont, name="pagefont"), default=PageFont.DEFAULT
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    public_id: Mapped[str | None] = mapped_column(String(32), unique=True, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, index=True
    )
    deleted_root: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), default=None
    )
    last_edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), default=None
    )
    last_edited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(tz=UTC)
    )
    ydoc_state: Mapped[bytes | None] = mapped_column(LargeBinary, default=None)
    content_text: Mapped[str] = mapped_column(Text, default="")
    database_schema: Mapped[list[Any] | None] = mapped_column(JSONB, default=None)
    database_views: Mapped[list[Any] | None] = mapped_column(JSONB, default=None)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class PageFavorite(TimestampMixin, Base):
    __tablename__ = "page_favorites"
    __table_args__ = (UniqueConstraint("user_id", "page_id", name="uq_page_favorite"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[str] = mapped_column(String(255), default="a0")


class PageVisit(TimestampMixin, Base):
    __tablename__ = "page_visits"
    __table_args__ = (UniqueConstraint("user_id", "page_id", name="uq_page_visit"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True
    )
    page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), index=True
    )
    visited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
