"""Base module for HTTP Exceptions"""

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Standard error response contract surfaced to clients."""

    detail: Any = "Internal Server Error"
    error_code: str = "internal_server_error"


class HTTPExceptionMixin(HTTPException):
    """Base HTTP exception"""

    error_code = "internal_server_error"
    detail = "Internal Server Error"
    status_code = 500

    def __init__(
        self, *, status_code: int | None = None, detail: Any = None, **kwargs: Any
    ) -> None:
        super().__init__(
            status_code=status_code or self.status_code,
            detail=detail or self.detail,
            **kwargs,
        )


class ForbiddenError(HTTPExceptionMixin):
    """The user is authenticated and a member, but lacks the role for this.

    The spec's contract for viewer writes (SPEC §2: 403 ``forbidden``).
    """

    detail = "You do not have permission to perform this action"
    error_code = "forbidden"
    status_code = 403
