"""ai_requests, ai_cache, import_jobs -- backend-only tables, per §E/§J.

RLS is enabled with no policies on all three: nothing in the client should
ever read or write them directly (no select/insert/update/delete policy at
all -- the FastAPI service connects with a role that bypasses RLS).

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.create_table(
        "ai_requests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(10, 6), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status in ('ok','invalid_output','provider_error','timeout',"
            "'rate_limited','quota_denied')",
            name="ai_requests_status_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="SET NULL"),
        schema="public",
    )
    op.create_index(
        "ai_requests_user_created_idx",
        "ai_requests",
        ["user_id", sa.text("created_at desc")],
        schema="public",
    )
    op.create_index(
        "ai_requests_created_idx",
        "ai_requests",
        [sa.text("created_at desc")],
        schema="public",
    )

    op.create_table(
        "ai_cache",
        sa.Column("cache_key", sa.Text(), primary_key=True),
        sa.Column("response", postgresql.JSONB(), nullable=False),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        schema="public",
    )
    op.create_index("ai_cache_expires_idx", "ai_cache", ["expires_at"], schema="public")

    op.create_table(
        "import_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dictionary_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("rows", postgresql.JSONB(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now() + interval '1 hour'"),
        ),
        sa.CheckConstraint(
            "status in ('parsing','ready','confirmed','failed','expired')",
            name="import_jobs_status_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dictionary_id"], ["public.dictionaries.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index("import_jobs_expires_idx", "import_jobs", ["expires_at"], schema="public")

    for table in ("ai_requests", "ai_cache", "import_jobs"):
        op.execute(f"alter table public.{table} enable row level security")


def downgrade() -> None:
    op.drop_table("import_jobs", schema="public")
    op.drop_table("ai_cache", schema="public")
    op.drop_table("ai_requests", schema="public")
