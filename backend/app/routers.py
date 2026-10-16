"""Module for including all the app's routers"""

from fastapi import APIRouter

from app.modules.collab.routers import collab_router
from app.modules.comments.routers import comments_router
from app.modules.events.routers import events_router
from app.modules.pages.routers import (
    pages_router,
    public_router,
    workspace_pages_router,
)
from app.modules.workspaces.routers import workspaces_router
from app.user.auth.routers import auth_router
from app.user.routers import user_router


def get_app_router() -> APIRouter:
    router = APIRouter()

    router.include_router(
        auth_router,
        prefix="/auth",
        tags=["auth"],
    )

    router.include_router(
        user_router,
        prefix="/users",
        tags=["users"],
    )

    router.include_router(workspaces_router)
    router.include_router(workspace_pages_router)
    router.include_router(pages_router)
    router.include_router(comments_router)
    router.include_router(public_router)
    router.include_router(events_router)
    router.include_router(collab_router)

    return router
