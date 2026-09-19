"""Baseline: adopt the existing live schema.

Mirrors what supabase/migrations/202608260001_security_hotfix.sql and
202608260002_tighten_function_grants.sql already established directly
against the live project (tables, columns, PKs/FKs only -- Alembic
autogenerate does not see triggers, SECURITY DEFINER functions, or RLS
policies, which remain hand-authored SQL under supabase/migrations/).

IMPORTANT: do not `alembic upgrade head` this revision against the live
project -- the tables already exist there. Stamp it instead:

    alembic stamp 0001

`upgrade()` is for a fresh database only (a new local/CI Postgres), where it
genuinely creates the tables that are already live in Supabase.

Revision ID: 0001
Revises:
Create Date: 2026-08-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.execute("create extension if not exists pgcrypto")

    op.create_table(
        "profiles",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("tier", sa.Text(), nullable=False, server_default="free"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("tier in ('free', 'premium')", name="profiles_tier_check"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )

    op.create_table(
        "words",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("word", sa.Text(), nullable=False),
        sa.Column("definition", sa.Text(), nullable=False),
        sa.Column("part_of_speech", sa.Text(), nullable=False),
        sa.Column("folder", sa.Text(), nullable=True),
        sa.Column("example", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=False, server_default="manual"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "part_of_speech in ('noun', 'verb', 'adjective', 'adverb')",
            name="words_part_of_speech_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "words_user_word_pos_unique",
        "words",
        ["user_id", sa.text("lower(word)"), "part_of_speech"],
        unique=True,
        schema="public",
    )
    op.create_index(
        "words_user_created_idx",
        "words",
        ["user_id", sa.text("created_at desc")],
        schema="public",
    )

    op.create_table(
        "progress",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quiz_type", sa.Text(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("words_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "details", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "progress_user_created_idx",
        "progress",
        ["user_id", sa.text("created_at desc")],
        schema="public",
    )

    op.create_table(
        "usage_daily",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "usage_date",
            sa.Date(),
            primary_key=True,
            server_default=sa.text("current_date"),
        ),
        sa.Column("ai_requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("daily_limit", sa.Integer(), nullable=False, server_default="50"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "usage_daily_user_date_idx",
        "usage_daily",
        ["user_id", sa.text("usage_date desc")],
        schema="public",
    )


def downgrade() -> None:
    op.drop_table("usage_daily", schema="public")
    op.drop_table("progress", schema="public")
    op.drop_table("words", schema="public")
    op.drop_table("profiles", schema="public")
