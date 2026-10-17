"""Schema contracts beyond the guards' alembic check (review finding 11)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.stack import run_alembic, server_environment

if TYPE_CHECKING:
    from tests.e2e.stack import Database


def test_pages_user_fk_columns_are_indexed(db: Database) -> None:
    """Deleting a user must not scan pages to null its FK columns.

    ``created_by_id`` and ``last_edited_by_id`` are ON DELETE SET NULL
    foreign keys; without an index Postgres sequential-scans pages for every
    deleted user.
    """
    rows = db.fetch_all(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'pages' "
        "AND indexname IN ('pages_created_by_id_idx', 'pages_last_edited_by_id_idx') "
        "ORDER BY indexname"
    )

    assert [row[0] for row in rows] == [
        "pages_created_by_id_idx",
        "pages_last_edited_by_id_idx",
    ]


def test_alembic_refuses_a_database_url_that_is_not_postgres(db: Database) -> None:
    """A DB_URL of another database stops Alembic with a clear message.

    The schema is untouched: the run fails before it connects.
    """
    env = server_environment(db.url)
    env["DB_URL"] = "mysql://app:secret@127.0.0.1:3306/app"

    result = run_alembic(env, "current")

    assert result.returncode != 0
    assert "DB_URL must be a Postgres URL" in result.stderr
    assert db.fetch_one("SELECT count(*) FROM alembic_version") == (1,)


def test_order_keys_sort_by_byte_order(db: Database) -> None:
    """Sibling and favorite order keys compare byte by byte, on any server locale.

    The keys are fractional indexes such as ``Zz`` < ``a0`` (the frontend
    compares them the same way). A language collation such as ``en_US`` sorts
    ``Zz`` after ``a0``, so a page added on top would show at the bottom.
    """
    rows = db.fetch_all(
        "SELECT table_name, collation_name FROM information_schema.columns "
        "WHERE column_name = 'position' AND table_name IN ('pages', 'page_favorites') "
        "ORDER BY table_name"
    )

    assert rows == [("page_favorites", "C"), ("pages", "C")]
