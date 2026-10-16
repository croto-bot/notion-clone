"""Pages exceptions."""

from app.exceptions import HTTPExceptionMixin


class InvalidMoveError(HTTPExceptionMixin):
    detail = "A page cannot move into itself or its own subtree"
    error_code = "invalid_move"
    status_code = 400


class PageInTrashError(HTTPExceptionMixin):
    detail = "This page is in the trash"
    error_code = "page_in_trash"
    status_code = 400


class NotInTrashError(HTTPExceptionMixin):
    detail = "This page is not in the trash"
    error_code = "not_in_trash"
    status_code = 409


class NotADatabaseError(HTTPExceptionMixin):
    detail = "This page is not a database"
    error_code = "not_a_database"
    status_code = 400
