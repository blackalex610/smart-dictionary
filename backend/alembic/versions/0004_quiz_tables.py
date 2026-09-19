"""quiz_attempts + quiz_answers, replacing `progress` per §E.

`progress` rows are copied into `quiz_attempts` for continuity, but the
`progress` table itself is NOT dropped here -- the live frontend still
writes to it until Phase 6 replaces quiz submission with the new API. Same
expand/contract reasoning as `words.folder` (migration 0002).

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.create_table(
        "quiz_attempts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dictionary_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("question_count", sa.SmallInteger(), nullable=False),
        sa.Column("correct_count", sa.SmallInteger(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dictionary_id"], ["public.dictionaries.id"], ondelete="SET NULL"),
        schema="public",
    )
    op.create_index(
        "quiz_attempts_user_started_idx",
        "quiz_attempts",
        ["user_id", sa.text("started_at desc")],
        schema="public",
    )

    op.create_table(
        "quiz_answers",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("attempt_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("word_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("question_type", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=False),
        sa.Column("given", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["attempt_id"], ["public.quiz_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["word_id"], ["public.words.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("attempt_id", "position", name="quiz_answers_attempt_position_unique"),
        schema="public",
    )
    op.create_index(
        "quiz_answers_incorrect_word_idx",
        "quiz_answers",
        ["word_id"],
        schema="public",
        postgresql_where=sa.text("is_correct = false"),
    )

    op.execute(
        """
        insert into public.quiz_attempts
          (user_id, dictionary_id, config, question_count, correct_count,
           started_at, completed_at, ai_generated)
        select
          user_id,
          null,
          jsonb_build_object('quiz_type', quiz_type, 'words_count', words_count),
          total_questions,
          score,
          created_at,
          created_at,
          false
        from public.progress
        """
    )

    op.execute("alter table public.quiz_attempts enable row level security")
    op.execute("alter table public.quiz_answers enable row level security")

    op.execute(
        "create policy quiz_attempts_select_own on public.quiz_attempts "
        "for select using (auth.uid() = user_id)"
    )
    op.execute(
        "create policy quiz_attempts_insert_own on public.quiz_attempts "
        "for insert with check (auth.uid() = user_id)"
    )
    op.execute(
        "create policy quiz_attempts_update_own on public.quiz_attempts "
        "for update using (auth.uid() = user_id)"
    )
    op.execute("grant select, insert, update on public.quiz_attempts to authenticated")

    op.execute(
        """
        create policy quiz_answers_select_own on public.quiz_answers
        for select using (
          exists (
            select 1 from public.quiz_attempts qa
            where qa.id = quiz_answers.attempt_id and qa.user_id = auth.uid()
          )
        )
        """
    )
    op.execute("grant select on public.quiz_answers to authenticated")


def downgrade() -> None:
    op.execute("drop policy if exists quiz_answers_select_own on public.quiz_answers")
    op.execute("drop policy if exists quiz_attempts_update_own on public.quiz_attempts")
    op.execute("drop policy if exists quiz_attempts_insert_own on public.quiz_attempts")
    op.execute("drop policy if exists quiz_attempts_select_own on public.quiz_attempts")

    op.drop_table("quiz_answers", schema="public")
    op.drop_table("quiz_attempts", schema="public")
