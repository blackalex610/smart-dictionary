"""word_reviews (SRS state) + review_log (append-only), per §E.

A trigger creates a word_reviews row whenever a word is inserted, so every
word has review state from day one -- including ones inserted by the
pre-cutover frontend, which knows nothing about this table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.create_table(
        "word_reviews",
        sa.Column("word_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "state",
            sa.Text(),
            nullable=False,
            server_default="new",
        ),
        sa.Column("ease_factor", sa.Numeric(4, 2), nullable=False, server_default="2.50"),
        sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repetitions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
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
            "state in ('new', 'learning', 'review', 'relearning')",
            name="word_reviews_state_check",
        ),
        sa.CheckConstraint("ease_factor >= 1.30", name="word_reviews_ease_floor_check"),
        sa.CheckConstraint("interval_days >= 0", name="word_reviews_interval_check"),
        sa.ForeignKeyConstraint(["word_id"], ["public.words.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "word_reviews_due_idx",
        "word_reviews",
        ["user_id", "due_at"],
        schema="public",
        postgresql_where=sa.text("state <> 'new'"),
    )

    op.create_table(
        "review_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("word_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("interval_before", sa.Integer(), nullable=True),
        sa.Column("interval_after", sa.Integer(), nullable=True),
        sa.Column("ease_before", sa.Numeric(4, 2), nullable=True),
        sa.Column("ease_after", sa.Numeric(4, 2), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("source", sa.Text(), nullable=False),
        sa.CheckConstraint("rating between 1 and 4", name="review_log_rating_check"),
        sa.CheckConstraint(
            "elapsed_ms is null or elapsed_ms between 0 and 600000",
            name="review_log_elapsed_check",
        ),
        sa.CheckConstraint("source in ('flashcard', 'quiz')", name="review_log_source_check"),
        sa.ForeignKeyConstraint(["word_id"], ["public.words.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "review_log_user_reviewed_idx",
        "review_log",
        ["user_id", sa.text("reviewed_at desc")],
        schema="public",
    )

    op.execute(
        """
        create or replace function public.create_word_review()
        returns trigger
        language plpgsql
        security definer
        set search_path = public
        as $$
        begin
          insert into public.word_reviews (word_id, user_id)
          values (new.id, new.user_id)
          on conflict (word_id) do nothing;
          return new;
        end;
        $$
        """
    )
    op.execute("drop trigger if exists trg_words_create_review on public.words")
    op.execute(
        """
        create trigger trg_words_create_review
        after insert on public.words
        for each row execute function public.create_word_review()
        """
    )
    op.execute(
        "revoke execute on function public.create_word_review() from public, anon, authenticated"
    )

    # Backfill: every word that exists today gets review state too.
    op.execute(
        """
        insert into public.word_reviews (word_id, user_id)
        select id, user_id from public.words
        on conflict (word_id) do nothing
        """
    )

    for table in ("word_reviews", "review_log"):
        op.execute(f"alter table public.{table} enable row level security")
        op.execute(
            f"create policy {table}_select_own on public.{table} "
            "for select using (auth.uid() = user_id)"
        )
        op.execute(f"grant select on public.{table} to authenticated")


def downgrade() -> None:
    for table in ("word_reviews", "review_log"):
        op.execute(f"drop policy if exists {table}_select_own on public.{table}")

    op.execute("drop trigger if exists trg_words_create_review on public.words")
    op.execute("drop function if exists public.create_word_review()")

    op.drop_table("review_log", schema="public")
    op.drop_table("word_reviews", schema="public")
