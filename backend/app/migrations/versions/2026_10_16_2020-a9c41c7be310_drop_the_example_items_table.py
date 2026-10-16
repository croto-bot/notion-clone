"""drop the example items table

The items module was the template's example feature; this product no longer
has it. The table is dropped by a new migration (never by editing an old one).

Revision ID: a9c41c7be310
Revises: 3807bd59bb6e
Create Date: 2026-10-16 20:17:05.593327

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9c41c7be310"
down_revision: str | None = "3807bd59bb6e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(op.f("item_created_at_idx"), table_name="item")
    op.drop_index(op.f("item_sku_idx"), table_name="item")
    op.drop_index(op.f("item_updated_at_idx"), table_name="item")
    op.drop_index(op.f("item_user_id_idx"), table_name="item")
    op.drop_table("item")


def downgrade() -> None:
    # The item table as it last existed (see the initial migration and
    # a1b2c3d4e5f6 "Add user_id to item").
    op.create_table(
        "item",
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name=op.f("item_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("item_pkey")),
        sa.UniqueConstraint("sku", name=op.f("item_sku_key")),
    )
    op.create_index("item_created_at_idx", "item", ["created_at"])
    op.create_index("item_sku_idx", "item", ["sku"])
    op.create_index("item_updated_at_idx", "item", ["updated_at"])
    op.create_index("item_user_id_idx", "item", ["user_id"])
