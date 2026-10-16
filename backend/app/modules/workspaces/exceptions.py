"""Workspace exceptions."""

from app.exceptions import HTTPExceptionMixin


class AlreadyMemberError(HTTPExceptionMixin):
    detail = "User is already a member of this workspace"
    error_code = "already_member"
    status_code = 409


class LastOwnerError(HTTPExceptionMixin):
    detail = "The last owner cannot leave or lose the owner role"
    error_code = "last_owner"
    status_code = 409
