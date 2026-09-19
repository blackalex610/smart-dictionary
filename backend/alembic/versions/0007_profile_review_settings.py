"""profiles: locale, timezone, daily review/new limits, per §E.

Additive only. `timezone` is needed to compute the user's local "today" for
the review queue's daily caps and streaks -- a UTC day boundary is wrong
for a study streak. `tier` is untouched; its retirement is a separate,
deferred work order (see docs/superpowers/specs/2026-09-15-*.md).

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("locale", sa.Text(), nullable=False, server_default="bg"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("timezone", sa.Text(), nullable=False, server_default="Europe/Sofia"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("daily_new_limit", sa.SmallInteger(), nullable=False, server_default="10"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("daily_review_limit", sa.SmallInteger(), nullable=False, server_default="100"),
        schema="public",
    )
    op.create_check_constraint(
        "profiles_daily_new_limit_check",
        "profiles",
        "daily_new_limit between 0 and 100",
        schema="public",
    )
    op.create_check_constraint(
        "profiles_daily_review_limit_check",
        "profiles",
        "daily_review_limit between 10 and 500",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("profiles_daily_review_limit_check", "profiles", schema="public")
    op.drop_constraint("profiles_daily_new_limit_check", "profiles", schema="public")
    op.drop_column("profiles", "daily_review_limit", schema="public")
    op.drop_column("profiles", "daily_new_limit", schema="public")
    op.drop_column("profiles", "timezone", schema="public")
    op.drop_column("profiles", "locale", schema="public")
