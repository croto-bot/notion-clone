"""Comments schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.core.optional_model import partial_model
from app.database.mixins import OrmBaseModel
from app.modules.comments.models import Comment
from app.modules.pages.schemas import UserRef


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)
    parent_id: uuid.UUID | None = None


@partial_model
class CommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)
    resolved: bool = False


class CommentResponse(OrmBaseModel):
    id: uuid.UUID
    page_id: uuid.UUID
    parent_id: uuid.UUID | None
    body: str
    resolved: bool
    edited: bool
    created_at: datetime
    updated_at: datetime


class CommentWithAuthor(CommentResponse):
    author: UserRef

    @classmethod
    def from_comment(cls, comment: Comment, author: UserRef) -> "CommentWithAuthor":
        data = CommentResponse.model_validate(comment).model_dump()
        data["author"] = author
        return cls(**data)
