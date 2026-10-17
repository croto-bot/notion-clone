"""Pages repository - database access layer."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import asc, case, delete, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.modules.pages.models import Page, PageFavorite, PageKind, PageVisit
from app.modules.workspaces.models import WorkspaceMember, WorkspaceRole
from app.repositories.exceptions import DuplicateError
from app.repositories.sql_repository import SQLAlchemyRepository


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so user text matches literally."""
    return term.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


class PageRepository(SQLAlchemyRepository[Page]):
    model = Page

    async def siblings(
        self,
        workspace_id: uuid.UUID,
        parent_id: uuid.UUID | None,
        *,
        include_trashed: bool = False,
    ) -> list[Page]:
        """The pages directly under ``parent_id`` (None = workspace root)."""
        parent_clause = (
            Page.parent_id == parent_id
            if parent_id is not None
            else Page.parent_id.is_(None)
        )
        conditions = [Page.workspace_id == workspace_id, parent_clause]
        if not include_trashed:
            conditions.append(Page.deleted_at.is_(None))
        statement = select(Page).where(*conditions).order_by(asc(Page.position))
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def live_pages(self, workspace_id: uuid.UUID) -> list[Page]:
        """Every non-trashed page of the workspace, database rows included.

        One read for the features that need the whole live tree shape
        (search breadcrumbs, has_children), instead of a query per parent hop.
        """
        statement = (
            select(Page)
            .where(Page.workspace_id == workspace_id, Page.deleted_at.is_(None))
            .order_by(asc(Page.position), asc(Page.created_at))
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def tree_pages(self, workspace_id: uuid.UUID) -> list[Page]:
        """All non-trashed pages except database rows, ordered by position."""
        database_ids = (
            select(Page.id)
            .where(
                Page.workspace_id == workspace_id,
                Page.kind == PageKind.DATABASE,
                Page.deleted_at.is_(None),
            )
            .scalar_subquery()
        )
        statement = (
            select(Page)
            .where(
                Page.workspace_id == workspace_id,
                Page.deleted_at.is_(None),
                Page.parent_id.not_in(database_ids) | Page.parent_id.is_(None),
            )
            .order_by(asc(Page.position), asc(Page.created_at))
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def trash_root_pages(
        self, workspace_id: uuid.UUID, query: str | None
    ) -> list[Page]:
        conditions = [
            Page.workspace_id == workspace_id,
            Page.deleted_at.is_not(None),
            Page.deleted_root.is_(True),
        ]
        if query:
            conditions.append(Page.title.ilike(f"%{_escape_like(query)}%", escape="\\"))
        statement = select(Page).where(*conditions).order_by(Page.deleted_at.desc())
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def search_pages(
        self, workspace_id: uuid.UUID, query: str, limit: int
    ) -> list[Page]:
        pattern = f"%{_escape_like(query)}%"
        title_match = Page.title.ilike(pattern, escape="\\")
        content_match = Page.content_text.ilike(pattern, escape="\\")
        statement = (
            select(Page)
            .where(
                Page.workspace_id == workspace_id,
                Page.deleted_at.is_(None),
                title_match | content_match,
            )
            .order_by(
                case((title_match, 0), else_=1),
                Page.updated_at.desc(),
            )
            .limit(limit)
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def subtree_ids(self, root_id: uuid.UUID) -> list[uuid.UUID]:
        """The root and all its descendants, recursively.

        The CYCLE clause (Postgres 14+) stops the walk when the rows contain a
        parent cycle (two concurrent moves could write one before the row
        locks existed), so one bad row cannot hang trash, restore, duplicate
        and move with an endless recursion.
        """
        statement = text(
            "WITH RECURSIVE subtree(id) AS ("
            "SELECT id FROM pages WHERE id = :root "
            "UNION ALL "
            "SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id"
            ") CYCLE id SET is_cycle USING path "
            "SELECT DISTINCT id FROM subtree"
        )
        result = await self._session.execute(statement, {"root": root_id})
        return [row for (row,) in result.all()]

    async def ancestor_ids(self, page_id: uuid.UUID) -> list[uuid.UUID]:
        """The parent chain of a page (the page itself excluded), cycle-safe."""
        statement = text(
            "WITH RECURSIVE chain(id) AS ("
            "SELECT parent_id FROM pages WHERE id = :page "
            "UNION ALL "
            "SELECT p.parent_id FROM pages p "
            "JOIN chain c ON p.id = c.id WHERE c.id IS NOT NULL"
            ") CYCLE id SET is_cycle USING path "
            "SELECT DISTINCT id FROM chain WHERE id IS NOT NULL"
        )
        result = await self._session.execute(statement, {"page": page_id})
        return [row for (row,) in result.all()]

    async def lock_for_move(self, page_ids: list[uuid.UUID]) -> list[Page]:
        """Fresh row locks for a move, one row at a time in sorted id order.

        Loading full rows with populate_existing refreshes the identity-mapped
        copies (expire_on_commit=False would keep them stale otherwise), so
        the post-lock trash checks read committed state. Locking one row per
        statement, smallest id first, is what makes the ordering claim hold:
        every move grabs the same rows in the same order, so two overlapping
        moves queue on the first row instead of deadlocking, and no move ever
        waits holding rows a peer wants first. The caller's commit (or its
        rollback on error) releases the locks.
        """
        rows: list[Page] = []
        for page_id in sorted(set(page_ids)):
            statement = (
                select(Page)
                .where(Page.id == page_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            row = (await self._session.execute(statement)).scalar_one_or_none()
            if row is not None:
                rows.append(row)
        return rows

    async def mark_trashed(
        self, page_ids: list[uuid.UUID], root_id: uuid.UUID, now: datetime
    ) -> None:
        """Move the pages (and the root of the delete) into the trash."""
        statement = (
            update(Page)
            .where(Page.id.in_(page_ids))
            .values(
                deleted_at=now,
                deleted_root=(Page.id == root_id) | Page.deleted_root.is_(True),
            )
        )
        await self._session.execute(statement)
        await self._session.commit()

    async def purge_subtree(
        self, root_id: uuid.UUID, delete_ids: list[uuid.UUID]
    ) -> bool:
        """Purge a trashed subtree in one transaction; False when it left the trash.

        The purged row is locked and its trash flag re-checked first, so a
        restore that commits before the purge turns it into the same 409 the
        caller's pre-check produces, and a live page is never deleted. In
        that same transaction, independent trash roots whose parent is among
        the deleted rows (only descendants of the purged root can be) move
        to the workspace root, still trashed; a nested root under a surviving
        root keeps its parent and its subtree. Then the row delete cascades
        through the rest and everything commits or rolls back together - no
        window where survivors sit detached while their old parent still
        exists.
        """
        statement = (
            select(Page)
            .where(Page.id == root_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        row = (await self._session.execute(statement)).scalar_one_or_none()
        if row is None or row.deleted_at is None:
            await self._session.rollback()
            return False
        await self._session.execute(
            update(Page)
            .where(
                Page.id != root_id,
                Page.deleted_root.is_(True),
                Page.parent_id.in_(delete_ids),
            )
            .values(parent_id=None)
        )
        await self._session.execute(delete(Page).where(Page.id == root_id))
        await self._session.commit()
        return True

    async def database_rows(self, database_id: uuid.UUID) -> list[Page]:
        statement = (
            select(Page)
            .where(
                Page.parent_id == database_id,
                Page.deleted_at.is_(None),
            )
            .order_by(asc(Page.position), asc(Page.created_at))
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def public_page(self, public_id: str) -> Page | None:
        statement = select(Page).where(
            Page.public_id == public_id,
            Page.is_public.is_(True),
            Page.deleted_at.is_(None),
        )
        result = await self._session.execute(statement)
        return result.scalar_one_or_none()

    async def public_children(self, page_id: uuid.UUID) -> list[Page]:
        statement = (
            select(Page)
            .where(
                Page.parent_id == page_id,
                Page.deleted_at.is_(None),
                Page.is_public.is_(True),
                Page.public_id.is_not(None),
            )
            .order_by(asc(Page.position))
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def recent_visits(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, limit: int
    ) -> list[Page]:
        statement = (
            select(Page)
            .join(PageVisit, PageVisit.page_id == Page.id)
            .where(
                PageVisit.user_id == user_id,
                Page.workspace_id == workspace_id,
                Page.deleted_at.is_(None),
            )
            .order_by(PageVisit.visited_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    @SQLAlchemyRepository.translate_commit_errors
    async def insert_tree(self, rows: list[dict[str, Any]]) -> list[Page]:
        """Insert many pages in one transaction (duplicate subtree)."""
        statement = pg_insert(Page).values(rows).returning(Page)
        result = await self._session.execute(statement)
        await self._session.commit()
        return list(result.scalars().all())

    async def set_document(
        self,
        page_id: uuid.UUID,
        *,
        ydoc_state: bytes,
        content_text: str,
        last_edited_by_id: uuid.UUID | None,
        last_edited_at: datetime,
    ) -> None:
        statement = (
            update(Page)
            .where(Page.id == page_id)
            .values(
                ydoc_state=ydoc_state,
                content_text=content_text,
                last_edited_by_id=last_edited_by_id,
                last_edited_at=last_edited_at,
            )
        )
        await self._session.execute(statement)
        await self._session.commit()

    async def stored_state(self, page_id: uuid.UUID) -> bytes | None:
        """The page's stored Yjs update (room creation reads it under the page lock)."""
        statement = select(Page.ydoc_state).where(Page.id == page_id)
        result = await self._session.execute(statement)
        return result.scalar_one_or_none()

    async def write_access(
        self, page_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[datetime | None, WorkspaceRole] | None:
        """The page's deleted_at and the member's role, in one joined read.

        This is what the collab socket's write guard checks on every push:
        one query instead of a page read followed by a membership read.
        None when the page is gone or the user is not a member.
        """
        statement = (
            select(Page.deleted_at, WorkspaceMember.role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Page.workspace_id)
            .where(Page.id == page_id, WorkspaceMember.user_id == user_id)
        )
        result = await self._session.execute(statement)
        row = result.one_or_none()
        return (row.deleted_at, row.role) if row is not None else None

    async def has_child(self, page_id: uuid.UUID) -> bool:
        """Whether a live page sits directly under this one.

        Trashed children do not count: the sidebar shows no expander for them
        (GET /pages/{id} and search consume this; page-tree computes it from
        its own live set).
        """
        statement = (
            select(Page.id)
            .where(Page.parent_id == page_id, Page.deleted_at.is_(None))
            .limit(1)
        )
        result = await self._session.execute(statement)
        return result.scalar_one_or_none() is not None

    async def get_many(self, page_ids: list[uuid.UUID]) -> list[Page]:
        statement = select(Page).where(Page.id.in_(page_ids))
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def write_slot(
        self,
        *,
        page_id: uuid.UUID | None = None,
        values: dict[str, Any] | None = None,
        tree_rows: list[dict[str, Any]] | None = None,
        tree_root_id: uuid.UUID | None = None,
        restore_ids: list[uuid.UUID] | None = None,
    ) -> Page | None:
        """Write a page's live placement at an allocated sibling slot.

        One transaction per call, exactly one of the shapes every placement
        goes through:

        - ``values``: insert a new page (create);
        - ``page_id`` (+ ``values``): update an existing page's placement
          columns, position and parent_id and, for a restore, deleted_at
          (move, restore); ``restore_ids`` clears trash on the restored
          subtree's rows in the same transaction;
        - ``tree_rows`` (+ ``tree_root_id``): insert a copied subtree and
          return its root row (duplicate).

        Returns the written page, or None when a concurrent writer committed
        the same sibling slot first: the whole transaction is rolled back and
        the caller regenerates a key from the now-committed siblings. Any
        other error leaves translated, so no raw IntegrityError escapes.
        """
        try:
            if tree_rows is not None:
                created = await self.insert_tree(tree_rows)
                return next(row for row in created if row.id == tree_root_id)
            if restore_ids is not None:
                await self._session.execute(
                    update(Page)
                    .where(Page.id.in_(restore_ids), Page.deleted_at.is_not(None))
                    .values(deleted_at=None, deleted_root=False)
                )
            if page_id is not None:
                return await self.update(page_id, values)
            return await self.create(values)
        except DuplicateError:
            await self._session.rollback()
            return None
        except Exception as exc:
            parsed = self._parse_integrity_error(exc)
            if isinstance(parsed, DuplicateError):
                await self._session.rollback()
                return None
            if parsed is not exc:
                raise parsed from exc
            raise


class PageFavoriteRepository(SQLAlchemyRepository[PageFavorite]):
    model = PageFavorite

    async def get_favorite(
        self, user_id: uuid.UUID, page_id: uuid.UUID
    ) -> PageFavorite | None:
        statement = select(PageFavorite).where(
            PageFavorite.user_id == user_id, PageFavorite.page_id == page_id
        )
        result = await self._session.execute(statement)
        return result.scalar_one_or_none()

    async def last_position(self, user_id: uuid.UUID) -> str | None:
        statement = (
            select(PageFavorite.position)
            .where(PageFavorite.user_id == user_id)
            .order_by(PageFavorite.position.desc())
            .limit(1)
        )
        result = await self._session.execute(statement)
        row = result.scalar_one_or_none()
        return str(row) if row is not None else None

    async def favorites_of_workspace(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID
    ) -> list[tuple[PageFavorite, Page]]:
        statement = (
            select(PageFavorite, Page)
            .join(Page, Page.id == PageFavorite.page_id)
            .where(
                PageFavorite.user_id == user_id,
                Page.workspace_id == workspace_id,
                Page.deleted_at.is_(None),
            )
            .order_by(PageFavorite.position.asc())
        )
        result = await self._session.execute(statement)
        return [(favorite, page) for favorite, page in result.all()]

    async def create_favorite(self, favorite: PageFavorite) -> PageFavorite:
        self._session.add(favorite)
        await self._session.commit()
        await self._session.refresh(favorite)
        return favorite


class PageVisitRepository(SQLAlchemyRepository[PageVisit]):
    model = PageVisit

    async def upsert_visit(
        self, user_id: uuid.UUID, page_id: uuid.UUID, visited_at: datetime
    ) -> None:
        statement = pg_insert(PageVisit).values(
            user_id=user_id,
            page_id=page_id,
            visited_at=visited_at,
        )
        statement = statement.on_conflict_do_update(
            index_elements=["user_id", "page_id"],
            set_={"visited_at": visited_at},
        )
        await self._session.execute(statement)
        await self._session.commit()
