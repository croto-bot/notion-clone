"""Pages module: the page tree, trash, favorites, search and documents."""

from .exceptions import (
    InvalidMoveError,
    NotADatabaseError,
    NotInTrashError,
    PageInTrashError,
)
from .models import Page, PageFavorite, PageFont, PageKind, PageVisit
from .ordering import generate_key_between
from .repository import (
    PageFavoriteRepository,
    PageRepository,
    PageVisitRepository,
)
from .routers import pages_router, public_router, workspace_pages_router
from .schemas import (
    Breadcrumb,
    DocumentResponse,
    DocumentUpdate,
    MoveRequest,
    PageCreate,
    PageResponse,
    PageSummary,
    PageUpdatePatch,
    PublicPageResponse,
    SearchResult,
    UserRef,
)
from .service import PageDetail, PageService, SearchEntry

__all__ = [
    "Breadcrumb",
    "DocumentResponse",
    "DocumentUpdate",
    "InvalidMoveError",
    "MoveRequest",
    "NotADatabaseError",
    "NotInTrashError",
    "Page",
    "PageCreate",
    "PageDetail",
    "PageFavorite",
    "PageFavoriteRepository",
    "PageFont",
    "PageInTrashError",
    "PageKind",
    "PageRepository",
    "PageResponse",
    "PageService",
    "PageSummary",
    "PageUpdatePatch",
    "PageVisit",
    "PageVisitRepository",
    "PublicPageResponse",
    "SearchEntry",
    "SearchResult",
    "UserRef",
    "generate_key_between",
    "pages_router",
    "public_router",
    "workspace_pages_router",
]
