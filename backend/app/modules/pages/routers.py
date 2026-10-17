"""Pages router - the page tree endpoints (SPEC §3)."""

import base64
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, status

from app.core.logging import log_action, log_entity
from app.modules.pages.dependencies import get_page_service
from app.modules.pages.models import PageKind
from app.modules.pages.schemas import (
    DocumentResponse,
    DocumentUpdate,
    MoveRequest,
    PageCreate,
    PageResponse,
    PageSummary,
    PageUpdatePatch,
    PublicChild,
    PublicPageResponse,
    PublicRow,
    SearchResult,
    UserRef,
)
from app.modules.pages.service import PageDetail, PageService
from app.repositories.exceptions import NotFoundError
from app.user.auth import require_current_user_id

pages_router = APIRouter(
    prefix="/pages",
    tags=["pages"],
    dependencies=[Depends(require_current_user_id)],
)
workspace_pages_router = APIRouter(
    prefix="/workspaces",
    tags=["pages"],
    dependencies=[Depends(require_current_user_id)],
)
public_router = APIRouter(prefix="/public", tags=["public"])


def _summary(page: Any, *, has_children: bool = False) -> PageSummary:
    return PageSummary.from_page(page, has_children=has_children)


def _user_ref(user: Any) -> UserRef | None:
    if user is None:
        return None
    return UserRef(id=user.id, display_name=user.display_name, email=user.email)


def _response(detail: PageDetail) -> PageResponse:
    page = detail.page
    return PageResponse(
        id=page.id,
        workspace_id=page.workspace_id,
        parent_id=page.parent_id,
        kind=page.kind,
        title=page.title,
        icon=page.icon,
        position=page.position,
        is_public=page.is_public,
        deleted_at=page.deleted_at,
        updated_at=page.updated_at,
        last_edited_at=page.last_edited_at,
        has_children=detail.has_children,
        cover=page.cover,
        cover_position=page.cover_position,
        full_width=page.full_width,
        small_text=page.small_text,
        locked=page.locked,
        font=page.font,
        public_id=page.public_id,
        created_by=_user_ref(detail.created_by),
        last_edited_by=_user_ref(detail.last_edited_by),
        created_at=page.created_at,
        database_schema=page.database_schema,
        database_views=page.database_views,
        properties=dict(page.properties or {}),
        breadcrumbs=detail.breadcrumbs,
        is_favorite=detail.is_favorite,
        role=detail.role,
    )


# --- workspace-scoped lists --------------------------------------------------


@workspace_pages_router.get("/{workspace_id}/page-tree", status_code=status.HTTP_200_OK)
async def page_tree(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[PageSummary]:
    """All non-trashed pages of the workspace except database rows, by position."""
    log_action("page_tree")
    pages = await page_service.tree_pages(workspace_id, user_id=user_id)
    parent_ids = {page.parent_id for page in pages if page.parent_id is not None}
    return [_summary(page, has_children=page.id in parent_ids) for page in pages]


@workspace_pages_router.get("/{workspace_id}/trash", status_code=status.HTTP_200_OK)
async def trash(
    workspace_id: uuid.UUID,
    q: str | None = Query(None),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[PageSummary]:
    """Trashed pages deleted as roots, newest first."""
    log_action("trash")
    pages = await page_service.trash_pages(workspace_id, q, user_id=user_id)
    return [_summary(page) for page in pages]


@workspace_pages_router.get("/{workspace_id}/recent", status_code=status.HTTP_200_OK)
async def recent_pages(
    workspace_id: uuid.UUID,
    limit: int = Query(12, ge=1, le=100),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[PageSummary]:
    """Pages I visited, newest visit first (not trashed)."""
    log_action("recent")
    pages = await page_service.recent_pages(workspace_id, limit, user_id=user_id)
    return [_summary(page) for page in pages]


@workspace_pages_router.get("/{workspace_id}/search", status_code=status.HTTP_200_OK)
async def search_pages(
    workspace_id: uuid.UUID,
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[SearchResult]:
    """Title matches first, then content matches; both case-insensitive."""
    log_action("search")
    entries = await page_service.search_pages(workspace_id, q, limit, user_id=user_id)
    return [
        SearchResult(
            **_summary(entry.page, has_children=entry.has_children).model_dump(),
            snippet=entry.snippet,
            breadcrumbs=entry.breadcrumbs,
        )
        for entry in entries
    ]


@workspace_pages_router.get("/{workspace_id}/favorites", status_code=status.HTTP_200_OK)
async def favorites(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[PageSummary]:
    """My favorites of this workspace, by favorite position."""
    log_action("favorites")
    pairs = await page_service.favorite_pages(workspace_id, user_id=user_id)
    return [_summary(page) for _favorite, page in pairs]


# --- pages ----------------------------------------------------------------------


@pages_router.post("", status_code=status.HTTP_201_CREATED)
async def create_page(
    payload: PageCreate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    """Create a page (or a database) at the root or under a parent."""
    log_action("create")
    detail = await page_service.create_page(payload, user_id=user_id)
    log_entity("pages", detail.page.id)
    return _response(detail)


@pages_router.get("/{page_id}", status_code=status.HTTP_200_OK)
async def get_page(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    """Get a page; records a visit."""
    log_action("get")
    return _response(await page_service.get_page(page_id, user_id=user_id))


@pages_router.patch("/{page_id}", status_code=status.HTTP_200_OK)
async def update_page(
    page_id: uuid.UUID,
    payload: PageUpdatePatch = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    log_action("update")
    log_entity("pages", page_id)
    return _response(await page_service.update_page(page_id, payload, user_id=user_id))


@pages_router.post("/{page_id}/move", status_code=status.HTTP_200_OK)
async def move_page(
    page_id: uuid.UUID,
    payload: MoveRequest = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    log_action("move")
    log_entity("pages", page_id)
    return _response(
        await page_service.move_page(
            page_id,
            payload.parent_id,
            payload.after_id,
            user_id=user_id,
            after_id_sent="after_id" in payload.model_fields_set,
        )
    )


@pages_router.post("/{page_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_page(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    """Copy the page with its whole subtree and content, right after itself."""
    log_action("duplicate")
    log_entity("pages", page_id)
    return _response(await page_service.duplicate_page(page_id, user_id=user_id))


@pages_router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def trash_page(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> None:
    """Move the page and its subtree to the trash."""
    log_action("trash")
    log_entity("pages", page_id)
    await page_service.trash_page(page_id, user_id=user_id)


@pages_router.post("/{page_id}/restore", status_code=status.HTTP_200_OK)
async def restore_page(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> PageResponse:
    log_action("restore")
    log_entity("pages", page_id)
    return _response(await page_service.restore_page(page_id, user_id=user_id))


@pages_router.delete("/{page_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def purge_page(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> None:
    """Delete a trashed page and its subtree forever."""
    log_action("purge")
    log_entity("pages", page_id)
    await page_service.purge_page(page_id, user_id=user_id)


@pages_router.get("/{page_id}/rows", status_code=status.HTTP_200_OK)
async def database_rows(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> list[PageResponse]:
    """A database's rows (pages), by position, without breadcrumbs."""
    log_action("rows")
    log_entity("pages", page_id)
    rows, role = await page_service.database_rows(page_id, user_id=user_id)
    return [
        PageResponse(
            **_summary(page).model_dump(),
            cover=page.cover,
            cover_position=page.cover_position,
            full_width=page.full_width,
            small_text=page.small_text,
            locked=page.locked,
            font=page.font,
            public_id=page.public_id,
            created_by=None,
            last_edited_by=None,
            created_at=page.created_at,
            database_schema=page.database_schema,
            database_views=page.database_views,
            properties=dict(page.properties or {}),
            breadcrumbs=[],
            is_favorite=False,
            role=role,
        )
        for page in rows
    ]


@pages_router.get("/{page_id}/document", status_code=status.HTTP_200_OK)
async def get_document(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> DocumentResponse:
    """The stored Yjs update of the page, base64-encoded."""
    log_action("get_document")
    log_entity("pages", page_id)
    state = await page_service.get_document(page_id, user_id=user_id)
    return DocumentResponse(state=base64.b64encode(state).decode() if state else None)


@pages_router.put("/{page_id}/document", status_code=status.HTTP_200_OK)
async def put_document(
    page_id: uuid.UUID,
    payload: DocumentUpdate = Body(...),
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> DocumentResponse:
    """Merge a Yjs update into the page's document."""
    log_action("put_document")
    log_entity("pages", page_id)
    merged = await page_service.put_document(page_id, payload.state, user_id=user_id)
    return DocumentResponse(state=base64.b64encode(merged).decode())


@pages_router.put("/{page_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> None:
    log_action("favorite")
    log_entity("pages", page_id)
    await page_service.add_favorite(page_id, user_id=user_id)


@pages_router.delete("/{page_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    page_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_current_user_id),
    page_service: PageService = Depends(get_page_service),
) -> None:
    log_action("unfavorite")
    log_entity("pages", page_id)
    await page_service.remove_favorite(page_id, user_id=user_id)


# --- public ------------------------------------------------------------------------


@public_router.get("/pages/{public_id}", status_code=status.HTTP_200_OK)
async def public_page(
    public_id: str,
    page_service: PageService = Depends(get_page_service),
) -> PublicPageResponse:
    """A published page, read-only, no session needed."""
    log_action("public_get")
    page = await page_service.public_page(public_id)
    if page is None:
        raise NotFoundError(detail=f"Published page {public_id} not found")
    state = await page_service.current_state(page.id)
    children = await page_service.public_children(page.id)
    rows = (
        await page_service.database_rows_of(page)
        if page.kind == PageKind.DATABASE
        else []
    )
    return PublicPageResponse(
        id=page.id,
        title=page.title,
        icon=page.icon,
        cover=page.cover,
        cover_position=page.cover_position,
        full_width=page.full_width,
        small_text=page.small_text,
        font=page.font,
        kind=page.kind,
        state=base64.b64encode(state).decode() if state else None,
        database_schema=page.database_schema,
        database_views=page.database_views,
        rows=[
            PublicRow(
                id=row.id,
                title=row.title,
                icon=row.icon,
                properties=dict(row.properties or {}),
                created_at=row.created_at,
                last_edited_at=row.last_edited_at,
            )
            for row in rows
        ],
        children=[
            PublicChild(
                id=child.id,
                title=child.title,
                icon=child.icon,
                public_id=child.public_id,
            )
            for child in children
        ],
    )
