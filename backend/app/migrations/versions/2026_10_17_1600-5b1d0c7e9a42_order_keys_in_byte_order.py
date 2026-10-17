"""order keys in byte order

Revision ID: 5b1d0c7e9a42
Revises: ce33a21cd36a
Create Date: 2026-10-17 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b1d0c7e9a42"
down_revision: str | None = "ce33a21cd36a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("pages", "page_favorites")


def upgrade() -> None:
    for table in TABLES:
        op.alter_column(
            table,
            "position",
            existing_type=sa.String(length=255),
            type_=sa.String(length=255, collation="C"),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table in TABLES:
        op.alter_column(
            table,
            "position",
            existing_type=sa.String(length=255, collation="C"),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
