"""Comments repository - database access layer."""

import uuid

from sqlalchemy import select

from app.modules.comments.models import Comment
from app.modules.pages.models import Page
from app.repositories.sql_repository import SQLAlchemyRepository


class CommentRepository(SQLAlchemyRepository[Comment]):
    model = Comment

    async def list_of_page(self, page_id: uuid.UUID) -> list[Comment]:
        statement = (
            select(Comment)
            .where(Comment.page_id == page_id)
            .order_by(Comment.created_at, Comment.id)
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def get_with_page(self, comment_id: uuid.UUID) -> tuple[Comment, Page] | None:
        statement = (
            select(Comment, Page)
            .join(Page, Page.id == Comment.page_id)
            .where(Comment.id == comment_id)
        )
        result = await self._session.execute(statement)
        row = result.first()
        if row is None:
            return None
        comment, page = row
        return comment, page
