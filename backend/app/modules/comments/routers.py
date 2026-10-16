"""Comments router - discussions under a page (SPEC §3)."""

import uuid

from fastapi import APIRouter, Body, Depends, status

from app.core.logging import log_action, log_entity
from app.modules.comments.dependencies import get_comment_service
from app.modules.comments.schemas import (
    CommentCreate,
    CommentUpdate,
    CommentWithAuthor,
)
from app.modules.comments.service import CommentService
from app.user.auth import require_current_user_id

comments_router = APIRouter(
    tags=["comments"],
    dependencies=[Depends(require_current_user_id)],
)


def _response(comment, author) -> CommentWithAuthor:  # noqa: ANN001
    return CommentWithAuthor.from_comment(comment, author)


@comments_router.get("/pages/{page_id}/comments", status_code=status.HTTP_200_OK)
async def list_comments(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    comment_service: CommentService = Depends(get_comment_service),
) -> list[CommentWithAuthor]:
    """A page's comments, oldest first (not paged)."""
    log_action("list")
    log_entity("pages", page_id)
    pairs = await comment_service.list_comments(page_id, user_id=user_id)
    return [_response(comment, author) for comment, author in pairs]


@comments_router.post("/pages/{page_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_comment(
    page_id: uuid.UUID,
    payload: CommentCreate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    comment_service: CommentService = Depends(get_comment_service),
) -> CommentWithAuthor:
    """Add a discussion or a reply (viewers may comment)."""
    log_action("create")
    log_entity("pages", page_id)
    comment, author = await comment_service.create_comment(
        page_id, payload, user_id=user_id
    )
    return _response(comment, author)


@comments_router.patch("/comments/{comment_id}", status_code=status.HTTP_200_OK)
async def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    comment_service: CommentService = Depends(get_comment_service),
) -> CommentWithAuthor:
    """The author edits the body; any editor+ resolves or reopens."""
    log_action("update")
    log_entity("comments", comment_id)
    comment, author = await comment_service.update_comment(
        comment_id, payload, user_id=user_id
    )
    return _response(comment, author)


@comments_router.delete(
    "/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_comment(
    comment_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    comment_service: CommentService = Depends(get_comment_service),
) -> None:
    """Delete a comment (the author or the workspace owner)."""
    log_action("delete")
    log_entity("comments", comment_id)
    await comment_service.delete_comment(comment_id, user_id=user_id)
