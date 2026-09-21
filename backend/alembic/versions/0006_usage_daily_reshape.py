"""usage_daily: add token/cost/review counters, per §E.

Additive only. `daily_limit` is dead data but stays -- it's still an insert
target inside the live consume_ai_request_quota() RPC, which isn't replaced
until Phase 6. Dropping it now would break that RPC ahead of its
replacement. Same expand/contract reasoning as migrations 0002 and 0004.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "usage_daily",
        sa.Column("ai_input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        schema="public",
    )
    op.add_column(
        "usage_daily",
        sa.Column("ai_output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        schema="public",
    )
    op.add_column(
        "usage_daily",
        sa.Column("ai_cost_usd", sa.Numeric(10, 4), nullable=False, server_default="0"),
        schema="public",
    )
    op.add_column(
        "usage_daily",
        sa.Column("reviews_done", sa.Integer(), nullable=False, server_default="0"),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("usage_daily", "reviews_done", schema="public")
    op.drop_column("usage_daily", "ai_cost_usd", schema="public")
    op.drop_column("usage_daily", "ai_output_tokens", schema="public")
    op.drop_column("usage_daily", "ai_input_tokens", schema="public")
