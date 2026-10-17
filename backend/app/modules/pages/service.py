"""Pages service - business logic for the page tree (SPEC §2-3)."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.exceptions import ForbiddenError
from app.modules.pages.exceptions import (
    InvalidMoveError,
    NotADatabaseError,
    NotInTrashError,
    PageInTrashError,
)
from app.modules.pages.models import Page, PageFavorite, PageKind
from app.modules.pages.ordering import generate_key_between
from app.modules.pages.schemas import Breadcrumb
from app.modules.pages.yjs import extract_text, merge_updates
from app.modules.workspaces.models import WorkspaceRole
from app.repositories.exceptions import DuplicateError, NotFoundError
from app.services.base_crud_service import BaseService

if TYPE_CHECKING:
    from app.modules.collab.server import CollabServer
    from app.modules.events.bus import WorkspaceEventBus
    from app.modules.pages.repository import (
        PageFavoriteRepository,
        PageRepository,
        PageVisitRepository,
    )
    from app.modules.pages.schemas import PageCreate, PageUpdatePatch
    from app.modules.workspaces.models import WorkspaceMember
    from app.modules.workspaces.repository import WorkspaceMemberRepository
    from app.user.models import User
    from app.user.repository import UserRepository

SNIPPET_RADIUS = 40
# How often a create/move regenerates its position when a concurrent writer
# took the same sibling slot (the unique sibling index rejects it).
SLOT_ATTEMPTS = 5


def _default_database_schema() -> list[dict[str, Any]]:
    """Name (title), Tags (multi_select), Status (select) - SPEC §3 POST /pages."""
    return [
        {"id": "title", "name": "Name", "type": "title"},
        {"id": uuid.uuid4().hex, "name": "Tags", "type": "multi_select", "options": []},
        {
            "id": uuid.uuid4().hex,
            "name": "Status",
            "type": "select",
            "options": [
                {"id": uuid.uuid4().hex, "name": "Not started", "color": "default"},
                {"id": uuid.uuid4().hex, "name": "In progress", "color": "blue"},
                {"id": uuid.uuid4().hex, "name": "Done", "color": "green"},
            ],
        },
    ]


def _default_database_views() -> list[dict[str, Any]]:
    return [
        {
            "id": uuid.uuid4().hex,
            "name": "Table",
            "type": "table",
            "sorts": [],
            "filters": [],
            "hidden_properties": [],
        }
    ]


def _snippet(text: str, query: str) -> str:
    """A window of ``text`` around the first case-insensitive match."""
    if not text:
        return ""
    index = text.casefold().find(query.casefold())
    if index < 0:
        return text[: 2 * SNIPPET_RADIUS].strip()
    start = max(0, index - SNIPPET_RADIUS)
    end = min(len(text), index + len(query) + SNIPPET_RADIUS)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"


@dataclass
class PageDetail:
    """A page plus everything PageResponse adds around the row."""

    page: Page
    created_by: User | None
    last_edited_by: User | None
    role: WorkspaceRole
    is_favorite: bool
    breadcrumbs: list[Breadcrumb]
    has_children: bool


@dataclass
class SearchEntry:
    page: Page
    snippet: str
    breadcrumbs: list[Breadcrumb]
    has_children: bool


class PageService(BaseService[Page]):
    """Page tree, trash, favorites, search, databases and documents."""

    def __init__(
        self,
        repo: PageRepository,
        favorite_repo: PageFavoriteRepository,
        visit_repo: PageVisitRepository,
        member_repo: WorkspaceMemberRepository,
        user_repo: UserRepository,
        event_bus: WorkspaceEventBus,
        collab_server: CollabServer,
    ) -> None:
        self.repo = repo
        self.favorite_repo = favorite_repo
        self.visit_repo = visit_repo
        self.member_repo = member_repo
        self.user_repo = user_repo
        self.event_bus = event_bus
        self.collab_server = collab_server

    # --- access ---------------------------------------------------------------

    async def _access(
        self, page_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Page, WorkspaceMember]:
        """The page and the user's membership, or 404 for both failures.

        A non-member gets the same 404 as a missing page (SPEC §2).
        """
        page = await self.repo.get(page_id, raise_error=False)
        if page is None:
            raise NotFoundError(detail=f"Page {page_id} not found")
        member = await self.member_repo.get_membership(page.workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Page {page_id} not found")
        return page, member

    @staticmethod
    def _require_editor(member: WorkspaceMember) -> None:
        if member.role == WorkspaceRole.VIEWER:
            raise ForbiddenError()

    async def socket_access(
        self, page_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Page, WorkspaceMember] | None:
        """_access without raising: the socket closes with 4404 instead."""
        try:
            return await self._access(page_id, user_id)
        except NotFoundError:
            return None

    def _publish(
        self,
        workspace_id: uuid.UUID,
        event_type: str,
        actor_id: uuid.UUID,
        page_id: uuid.UUID,
    ) -> None:
        self.event_bus.publish(
            workspace_id,
            {"type": event_type, "page_id": str(page_id), "actor_id": str(actor_id)},
        )

    # --- helpers ----------------------------------------------------------------

    async def _breadcrumbs(self, page: Page) -> list[Breadcrumb]:
        chain: list[Breadcrumb] = []
        current = page
        depth = 0
        while current.parent_id is not None and depth < 100:
            parent = await self.repo.get(current.parent_id, raise_error=False)
            if parent is None:
                break
            chain.append(Breadcrumb(id=parent.id, title=parent.title, icon=parent.icon))
            current = parent
            depth += 1
        chain.reverse()
        return chain

    async def _has_children(self, page_id: uuid.UUID) -> bool:
        return await self.repo.has_child(page_id)

    async def _detail(
        self,
        page: Page,
        member: WorkspaceMember,
        *,
        breadcrumbs: bool = True,
    ) -> PageDetail:
        favorite = await self.favorite_repo.get_favorite(member.user_id, page.id)
        users: dict[uuid.UUID, User] = {}
        for user_id in {page.created_by_id, page.last_edited_by_id}:
            if user_id is not None and user_id not in users:
                user = await self.user_repo.get(user_id, raise_error=False)
                if user is not None:
                    users[user_id] = user
        return PageDetail(
            page=page,
            created_by=users.get(page.created_by_id),  # type: ignore[arg-type]
            last_edited_by=users.get(page.last_edited_by_id),  # type: ignore[arg-type]
            role=member.role,
            is_favorite=favorite is not None,
            breadcrumbs=await self._breadcrumbs(page) if breadcrumbs else [],
            has_children=await self._has_children(page.id),
        )

    @staticmethod
    def _breadth_first(
        nodes: dict[uuid.UUID, Page], root_id: uuid.UUID
    ) -> list[uuid.UUID]:
        """Parents before children, so one INSERT satisfies the self-FK."""
        order: list[uuid.UUID] = []
        queue = [root_id]
        while queue:
            current = queue.pop(0)
            order.append(current)
            queue.extend(
                node_id for node_id, node in nodes.items() if node.parent_id == current
            )
        return order

    @staticmethod
    def _position_after(
        siblings: list[Page],
        after_id: uuid.UUID | None,
        *,
        after_id_sent: bool,
    ) -> str:
        """Fractional position for a new or moved page.

        ``after_id`` set: right after that sibling. ``after_id`` explicitly
        null: first. ``after_id`` omitted: last (SPEC: "Without after_id the
        page goes last"; an explicit null is "first", like Notion's drop on
        top). Sibling keys the indexer cannot order (a lost position race
        left rows, or a corrupted row) are a client-visible 400, not a 500.
        """
        try:
            return PageService._position_between(
                siblings, after_id, after_id_sent=after_id_sent
            )
        except ValueError as exc:
            raise InvalidMoveError(
                detail="The sibling order keys leave no valid position"
            ) from exc

    @staticmethod
    def _position_between(
        siblings: list[Page],
        after_id: uuid.UUID | None,
        *,
        after_id_sent: bool,
    ) -> str:
        if after_id is not None:
            after_index = next(
                (i for i, page in enumerate(siblings) if page.id == after_id), None
            )
            if after_index is None:
                # Not a sibling (or not visible): go last, like Notion's fallback.
                last = siblings[-1] if siblings else None
                return generate_key_between(last.position if last else None, None)
            after = siblings[after_index]
            before = (
                siblings[after_index + 1] if after_index + 1 < len(siblings) else None
            )
            return generate_key_between(
                after.position, before.position if before else None
            )
        if after_id_sent:  # explicit null = first
            first = siblings[0] if siblings else None
            return generate_key_between(None, first.position if first else None)
        last = siblings[-1] if siblings else None
        return generate_key_between(last.position if last else None, None)

    async def _visible_parent_or_404(
        self, workspace_id: uuid.UUID, parent_id: uuid.UUID | None
    ) -> Page | None:
        """The parent for a create: same workspace, not trashed, or 404."""
        if parent_id is None:
            return None
        parent = await self.repo.get(parent_id, raise_error=False)
        if parent is None or parent.workspace_id != workspace_id:
            raise NotFoundError(detail=f"Page {parent_id} not found")
        return parent

    async def _move_parent_or_error(
        self, page: Page, parent_id: uuid.UUID, user_id: uuid.UUID
    ) -> Page:
        """The move's parent, with the move-specific cross-workspace error.

        A create under a foreign parent is a plain 404 (SPEC), but a move
        under a page of another workspace the user can see is 400
        invalid_move: the page exists, the tree just cannot reach it.
        """
        parent = await self.repo.get(parent_id, raise_error=False)
        if parent is None:
            raise NotFoundError(detail=f"Page {parent_id} not found")
        if parent.workspace_id != page.workspace_id:
            member = await self.member_repo.get_membership(parent.workspace_id, user_id)
            if member is not None:
                raise InvalidMoveError(
                    detail="A page cannot move under a page of another workspace"
                )
            raise NotFoundError(detail=f"Page {parent_id} not found")
        return parent

    # --- create / read / update -------------------------------------------------

    async def create_page(
        self, payload: PageCreate, *, user_id: uuid.UUID
    ) -> PageDetail:
        parent = await self._visible_parent_or_404(
            payload.workspace_id, payload.parent_id
        )
        if parent is not None and parent.deleted_at is not None:
            raise NotFoundError(detail=f"Page {parent.id} not found")

        values: dict[str, Any] = {
            "workspace_id": payload.workspace_id,
            "parent_id": payload.parent_id,
            "kind": payload.kind,
            "title": payload.title,
            "icon": payload.icon,
            "created_by_id": user_id,
            "last_edited_by_id": user_id,
            "properties": payload.properties or {},
        }
        if payload.kind == PageKind.DATABASE:
            values["database_schema"] = _default_database_schema()
            values["database_views"] = _default_database_views()

        for _attempt in range(SLOT_ATTEMPTS):
            created = await self._create_once(payload, values, user_id=user_id)
            if created is not None:
                page, member = created
                break
        else:
            raise DuplicateError(
                detail="Could not allocate a page position; retry the request"
            )
        self._log_entity(page.id)
        self._publish(
            payload.workspace_id, "page.created", actor_id=user_id, page_id=page.id
        )
        return await self._detail(page, member)

    async def _create_once(
        self, payload: PageCreate, values: dict[str, Any], *, user_id: uuid.UUID
    ) -> tuple[Page, WorkspaceMember] | None:
        """One create attempt; None when the position slot was taken.

        Like a move attempt, this re-reads the membership: the failed slot
        insert rolled the transaction back, which expires the session's
        objects (async ORM objects cannot refresh themselves lazily).
        """
        member = await self.member_repo.get_membership(payload.workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Workspace {payload.workspace_id} not found")
        self._require_editor(member)
        siblings = await self.repo.siblings(payload.workspace_id, payload.parent_id)
        position = self._position_after(
            siblings,
            payload.after_id,
            after_id_sent="after_id" in payload.model_fields_set,
        )
        page = await self.repo.create_in_slot({**values, "position": position})
        if page is None:
            return None
        return page, member

    async def get_page(self, page_id: uuid.UUID, *, user_id: uuid.UUID) -> PageDetail:
        page, member = await self._access(page_id, user_id)
        await self.visit_repo.upsert_visit(user_id, page_id, datetime.now(tz=UTC))
        return await self._detail(page, member)

    async def update_page(
        self,
        page_id: uuid.UUID,
        payload: PageUpdatePatch,
        *,
        user_id: uuid.UUID,
    ) -> PageDetail:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is not None:
            raise PageInTrashError()
        values: dict[str, Any] = payload.model_dump(exclude_unset=True)
        if values.get("is_public") and not page.public_id:
            values["public_id"] = secrets.token_urlsafe(12)
        values["last_edited_by_id"] = user_id
        values["last_edited_at"] = datetime.now(tz=UTC)
        updated = await self.repo.update(page_id, values)
        self._log_entity(page_id)
        self._publish(
            page.workspace_id, "page.updated", actor_id=user_id, page_id=page_id
        )
        return await self._detail(updated, member)

    # --- move / duplicate ---------------------------------------------------------

    async def move_page(
        self,
        page_id: uuid.UUID,
        parent_id: uuid.UUID | None,
        after_id: uuid.UUID | None,
        *,
        user_id: uuid.UUID,
        after_id_sent: bool = True,
    ) -> PageDetail:
        """Move (and reorder) a page, retrying a taken sibling slot."""
        for _attempt in range(SLOT_ATTEMPTS):
            result = await self._move_once(
                page_id,
                parent_id,
                after_id,
                user_id=user_id,
                after_id_sent=after_id_sent,
            )
            if result is not None:
                return result
        raise DuplicateError(
            detail="Could not allocate a page position; retry the request"
        )

    async def _move_once(
        self,
        page_id: uuid.UUID,
        parent_id: uuid.UUID | None,
        after_id: uuid.UUID | None,
        *,
        user_id: uuid.UUID,
        after_id_sent: bool,
    ) -> PageDetail | None:
        """One full move attempt; None when the target slot was taken.

        An attempt restarts from the access checks on purpose: the failed
        slot insert rolled the transaction back (releasing the row locks and
        expiring its objects), and the cycle and trash checks must run again
        under fresh locks anyway.
        """
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is not None:
            raise PageInTrashError()
        if parent_id == page_id:
            raise InvalidMoveError()
        if parent_id is not None:
            parent = await self._move_parent_or_error(page, parent_id, user_id)
            # Serialize against concurrent moves before the subtree check: two
            # moves that each pass the check on stale rows can write a cycle
            # (A under B while B under A). The lock also re-reads the moved
            # page and the parent, so a trash that committed meanwhile is
            # seen here.
            chain = await self.repo.ancestor_ids(parent_id)
            await self.repo.lock_for_move([page_id, parent_id, *chain])
            if page.deleted_at is not None:
                raise PageInTrashError()
            subtree = await self.repo.subtree_ids(page_id)
            if parent_id in subtree:
                raise InvalidMoveError()
            if parent.deleted_at is not None:
                raise InvalidMoveError(
                    detail="A page cannot move into a page that is in the trash"
                )

        siblings = [
            sibling
            for sibling in await self.repo.siblings(page.workspace_id, parent_id)
            if sibling.id != page_id
        ]
        position = self._position_after(siblings, after_id, after_id_sent=after_id_sent)
        updated = await self.repo.move_in_slot(page_id, parent_id, position)
        if updated is None:
            return None
        self._log_entity(page_id)
        self._publish(
            page.workspace_id, "page.moved", actor_id=user_id, page_id=page_id
        )
        return await self._detail(updated, member)

    async def duplicate_page(
        self, page_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> PageDetail:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is not None:
            raise PageInTrashError()

        subtree_ids = await self.repo.subtree_ids(page_id)
        nodes = {node.id: node for node in await self.repo.get_many(subtree_ids)}
        # Trashed descendants (and their subtrees) are skipped: the copy must
        # not resurrect deleted content (review finding 4).
        nodes = {
            node_id: node for node_id, node in nodes.items() if node.deleted_at is None
        }

        siblings = await self.repo.siblings(page.workspace_id, page.parent_id)
        copy_position = self._position_after(siblings, page_id, after_id_sent=True)

        id_map = {old_id: uuid.uuid4() for old_id in nodes}
        rows: list[dict[str, Any]] = []
        for old_id in self._breadth_first(nodes, page_id):
            node = nodes[old_id]
            is_root_copy = old_id == page_id
            rows.append(
                {
                    "id": id_map[old_id],
                    "workspace_id": node.workspace_id,
                    "parent_id": (
                        node.parent_id if is_root_copy else id_map.get(node.parent_id)
                    ),
                    "kind": node.kind,
                    "title": node.title,
                    "icon": node.icon,
                    "cover": node.cover,
                    "cover_position": node.cover_position,
                    "position": copy_position if is_root_copy else node.position,
                    "full_width": node.full_width,
                    "small_text": node.small_text,
                    "locked": node.locked,
                    "font": node.font,
                    "is_public": False,
                    "public_id": None,
                    "created_by_id": user_id,
                    "last_edited_by_id": user_id,
                    "ydoc_state": node.ydoc_state,
                    "content_text": node.content_text,
                    "database_schema": node.database_schema,
                    "database_views": node.database_views,
                    "properties": dict(node.properties or {}),
                }
            )
        created = await self.repo.insert_tree(rows)
        copy = next(node for node in created if node.id == id_map[page_id])
        for node in created:
            self._log_entity(node.id)
        self._publish(
            page.workspace_id, "page.created", actor_id=user_id, page_id=copy.id
        )
        return await self._detail(copy, member)

    # --- trash ---------------------------------------------------------------------

    async def trash_page(self, page_id: uuid.UUID, *, user_id: uuid.UUID) -> None:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        subtree = await self.repo.subtree_ids(page_id)
        await self.repo.mark_trashed(subtree, page_id, datetime.now(tz=UTC))
        self._log_entity(page_id)
        self._publish(
            page.workspace_id, "page.deleted", actor_id=user_id, page_id=page_id
        )

    async def _own_trash_ids(
        self, root_id: uuid.UUID, subtree: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """The subtree minus independent trash roots and their subtrees.

        A descendant that was already in the trash when this root was deleted
        kept its own trash item (``deleted_root`` stays true). Restoring or
        purging the root must not touch those: they keep their trash entry.
        """
        nodes = {node.id: node for node in await self.repo.get_many(subtree)}
        excluded: set[uuid.UUID] = set()
        for node_id in subtree:
            if node_id != root_id and nodes[node_id].deleted_root:
                excluded.update(await self.repo.subtree_ids(node_id))
        return [node_id for node_id in subtree if node_id not in excluded]

    async def restore_page(
        self, page_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> PageDetail:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is None:
            raise NotInTrashError()
        subtree = await self.repo.subtree_ids(page_id)
        await self.repo.restore_trashed(await self._own_trash_ids(page_id, subtree))

        parent = await self.repo.get(page.parent_id, raise_error=False)
        if parent is None or parent.deleted_at is not None:
            siblings = await self.repo.siblings(page.workspace_id, None)
            position = generate_key_between(
                siblings[-1].position if siblings else None, None
            )
            page = await self.repo.update(
                page_id, {"parent_id": None, "position": position}
            )
        else:
            page = await self.repo.get(page_id)
        self._log_entity(page_id)
        self._publish(
            page.workspace_id, "page.restored", actor_id=user_id, page_id=page_id
        )
        return await self._detail(page, member)

    async def purge_page(self, page_id: uuid.UUID, *, user_id: uuid.UUID) -> None:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is None:
            raise NotInTrashError()
        subtree = await self.repo.subtree_ids(page_id)
        # Independent trash roots inside the subtree would cascade-delete with
        # it (parent FK); move them out first, still trashed, at the root.
        await self.repo.detach_trash_roots(subtree, page_id)
        await self.repo.delete(page_id)
        self._log_entity(page_id)
        self._publish(
            page.workspace_id, "page.purged", actor_id=user_id, page_id=page_id
        )

    # --- lists -----------------------------------------------------------------------

    async def tree_pages(
        self, workspace_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> list[Page]:
        await self._require_member(workspace_id, user_id)
        return await self.repo.tree_pages(workspace_id)

    async def trash_pages(
        self, workspace_id: uuid.UUID, query: str | None, *, user_id: uuid.UUID
    ) -> list[Page]:
        await self._require_member(workspace_id, user_id)
        return await self.repo.trash_root_pages(workspace_id, query)

    async def recent_pages(
        self, workspace_id: uuid.UUID, limit: int, *, user_id: uuid.UUID
    ) -> list[Page]:
        await self._require_member(workspace_id, user_id)
        return await self.repo.recent_visits(user_id, workspace_id, limit)

    async def favorite_pages(
        self, workspace_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> list[tuple[PageFavorite, Page]]:
        await self._require_member(workspace_id, user_id)
        return await self.favorite_repo.favorites_of_workspace(user_id, workspace_id)

    async def search_pages(
        self, workspace_id: uuid.UUID, query: str, limit: int, *, user_id: uuid.UUID
    ) -> list[SearchEntry]:
        await self._require_member(workspace_id, user_id)
        pages = await self.repo.search_pages(workspace_id, query, limit)
        entries = []
        for page in pages:
            content = page.content_text or ""
            if query.casefold() in page.title.casefold():
                snippet = _snippet(page.title, query)
            else:
                snippet = _snippet(content, query)
            entries.append(
                SearchEntry(
                    page=page,
                    snippet=snippet,
                    breadcrumbs=await self._breadcrumbs(page),
                    has_children=await self._has_children(page.id),
                )
            )
        return entries

    async def database_rows(
        self, page_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> list[Page]:
        page, _ = await self._access(page_id, user_id)
        if page.kind != PageKind.DATABASE:
            raise NotADatabaseError()
        return await self.repo.database_rows(page_id)

    async def database_rows_of(self, page: Page) -> list[Page]:
        """Rows of a database page, without an access check (public pages)."""
        return await self.repo.database_rows(page.id)

    async def detail_of(self, page: Page, member: WorkspaceMember) -> PageDetail:
        """Everything PageResponse adds around the row."""
        return await self._detail(page, member)

    async def role_of_page(self, page: Page, user_id: uuid.UUID) -> WorkspaceRole:
        member = await self.member_repo.get_membership(page.workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Page {page.id} not found")
        return member.role

    async def _require_member(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID
    ) -> WorkspaceMember:
        member = await self.member_repo.get_membership(workspace_id, user_id)
        if member is None:
            raise NotFoundError(detail=f"Workspace {workspace_id} not found")
        return member

    # --- favorites ---------------------------------------------------------------------

    async def add_favorite(self, page_id: uuid.UUID, *, user_id: uuid.UUID) -> None:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is not None:
            raise PageInTrashError()
        if await self.favorite_repo.get_favorite(user_id, page_id) is not None:
            return
        last = await self.favorite_repo.last_position(user_id)
        await self.favorite_repo.create_favorite(
            PageFavorite(
                user_id=user_id,
                page_id=page_id,
                position=generate_key_between(last, None),
            )
        )

    async def remove_favorite(self, page_id: uuid.UUID, *, user_id: uuid.UUID) -> None:
        _page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        favorite = await self.favorite_repo.get_favorite(user_id, page_id)
        if favorite is not None:
            await self.favorite_repo.delete(favorite.id)

    # --- documents ------------------------------------------------------------------------

    async def stored_state(self, page_id: uuid.UUID) -> bytes | None:
        page = await self.repo.get(page_id, raise_error=False)
        return page.ydoc_state if page else None

    async def current_state(self, page_id: uuid.UUID) -> bytes | None:
        """The freshest state: the live room's doc, else the stored one."""
        return self.collab_server.room_state(page_id) or await self.stored_state(
            page_id
        )

    async def get_document(
        self, page_id: uuid.UUID, *, user_id: uuid.UUID
    ) -> bytes | None:
        await self._access(page_id, user_id)
        return await self.current_state(page_id)

    async def put_document(
        self, page_id: uuid.UUID, state: bytes, *, user_id: uuid.UUID
    ) -> bytes:
        page, member = await self._access(page_id, user_id)
        self._require_editor(member)
        if page.deleted_at is not None:
            raise PageInTrashError()
        # The same per-page lock as room creation and the flush: the merge
        # reads, the write and the room update happen as one unit, so a
        # concurrently connecting socket can never load the pre-PUT bytes.
        async with self.collab_server.page_lock(page_id):
            existing = await self.current_state(page_id)
            merged = merge_updates(existing, state)
            content_text = extract_text(merged)
            await self.repo.set_document(
                page_id,
                ydoc_state=merged,
                content_text=content_text,
                last_edited_by_id=user_id,
                last_edited_at=datetime.now(tz=UTC),
            )
            self.collab_server.note_write(page_id, user_id)
            self.collab_server.apply_external_update(page_id, state)
        self._publish(
            page.workspace_id, "page.updated", actor_id=user_id, page_id=page_id
        )
        return merged

    # --- public pages -------------------------------------------------------------------------

    async def public_page(self, public_id: str) -> Page | None:
        return await self.repo.public_page(public_id)

    async def public_children(self, page_id: uuid.UUID) -> list[Page]:
        return await self.repo.public_children(page_id)
