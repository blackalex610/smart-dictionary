"""Dictionaries + words.dictionary_id, per docs/architecture/v2-plan.md §E.

Expand-only: the live frontend still inserts words with `folder` and no
`dictionary_id` until the Phase 4 cut-over. A BEFORE INSERT/UPDATE trigger
(sync_word_dictionary) derives dictionary_id from folder (creating the
dictionary on first use) so the live app keeps working unmodified. words.folder
itself is dropped in a later migration, after Phase 4, never in the same one
as the read it replaces (expand/contract).

Also drops `enforce_words_limit` (a per-row `count(*)` trigger -- O(n) per
row on bulk import, and the free/premium tier it enforces is being retired
per the plan's "one tier, hard limits enforced server-side" decision). No
replacement trigger is added: the global word cap becomes a service-layer
check once the words API exists (Phase 4).

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.execute("create extension if not exists pg_trgm")

    # ── dictionaries ──────────────────────────────────────────────────
    op.create_table(
        "dictionaries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("language_code", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(name) between 1 and 60", name="dictionaries_name_length_check"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "dictionaries_user_name_unique",
        "dictionaries",
        ["user_id", sa.text("lower(name)")],
        unique=True,
        schema="public",
        postgresql_where=sa.text("deleted_at is null"),
    )
    op.create_index(
        "dictionaries_user_default_unique",
        "dictionaries",
        ["user_id"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("is_default and deleted_at is null"),
    )
    op.create_index(
        "dictionaries_user_idx",
        "dictionaries",
        ["user_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at is null"),
    )

    # ── backfill: one dictionary per distinct (user_id, folder) ─────────
    op.execute(
        """
        insert into public.dictionaries (user_id, name)
        select distinct on (user_id, lower(coalesce(folder, 'General')))
          user_id, coalesce(folder, 'General')
        from public.words
        order by user_id, lower(coalesce(folder, 'General')), coalesce(folder, 'General')
        """
    )
    op.execute(
        """
        with ranked as (
          select id, row_number() over (
            partition by user_id
            order by (lower(name) = 'general') desc, lower(name)
          ) as rn
          from public.dictionaries
        )
        update public.dictionaries d
        set is_default = true
        from ranked r
        where d.id = r.id and r.rn = 1
        """
    )

    # ── words: new columns ────────────────────────────────────────────
    op.add_column(
        "words",
        sa.Column("dictionary_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="public",
    )
    op.add_column("words", sa.Column("translation", sa.Text(), nullable=True), schema="public")
    op.add_column("words", sa.Column("notes", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "words", sa.Column("difficulty", sa.SmallInteger(), nullable=True), schema="public"
    )
    op.add_column("words", sa.Column("language_code", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "words", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True), schema="public"
    )

    op.execute(
        """
        update public.words w
        set dictionary_id = d.id
        from public.dictionaries d
        where d.user_id = w.user_id
          and lower(d.name) = lower(coalesce(w.folder, 'General'))
        """
    )
    op.alter_column("words", "dictionary_id", nullable=False, schema="public")
    op.create_foreign_key(
        "words_dictionary_id_fkey",
        "words",
        "dictionaries",
        ["dictionary_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    op.drop_constraint("words_part_of_speech_check", "words", schema="public", type_="check")
    op.alter_column("words", "part_of_speech", nullable=True, schema="public")
    op.create_check_constraint(
        "words_part_of_speech_check",
        "words",
        "part_of_speech in ('noun','verb','adjective','adverb','pronoun',"
        "'preposition','conjunction','interjection','phrase')",
        schema="public",
    )

    op.drop_index("words_user_word_pos_unique", table_name="words", schema="public")
    op.drop_index("words_user_created_idx", table_name="words", schema="public")
    op.create_index(
        "words_dictionary_word_pos_unique",
        "words",
        ["dictionary_id", sa.text("lower(word)"), sa.text("coalesce(part_of_speech, '')")],
        unique=True,
        schema="public",
        postgresql_where=sa.text("deleted_at is null"),
    )
    op.create_index(
        "words_dictionary_created_idx",
        "words",
        ["dictionary_id", sa.text("created_at desc"), "id"],
        schema="public",
        postgresql_where=sa.text("deleted_at is null"),
    )
    op.create_index(
        "words_search_tsv_idx",
        "words",
        [sa.text("to_tsvector('simple', word || ' ' || definition)")],
        schema="public",
        postgresql_using="gin",
    )
    op.create_index(
        "words_word_trgm_idx",
        "words",
        ["word"],
        schema="public",
        postgresql_using="gin",
        postgresql_ops={"word": "gin_trgm_ops"},
    )

    # ── keep dictionary_id/user_id consistent for pre-cutover writers ──
    op.execute(
        """
        create or replace function public.sync_word_dictionary()
        returns trigger
        language plpgsql
        security definer
        set search_path = public
        as $$
        declare
          v_dict_id uuid;
          v_folder_name text;
        begin
          if new.dictionary_id is null then
            v_folder_name := coalesce(new.folder, 'General');

            select id into v_dict_id
            from public.dictionaries
            where user_id = new.user_id
              and lower(name) = lower(v_folder_name)
              and deleted_at is null;

            if v_dict_id is null then
              insert into public.dictionaries (user_id, name)
              values (new.user_id, v_folder_name)
              returning id into v_dict_id;
            end if;

            new.dictionary_id := v_dict_id;
          end if;

          select user_id into new.user_id
          from public.dictionaries
          where id = new.dictionary_id;

          return new;
        end;
        $$
        """
    )
    op.execute("drop trigger if exists trg_words_sync_dictionary on public.words")
    op.execute(
        """
        create trigger trg_words_sync_dictionary
        before insert or update on public.words
        for each row execute function public.sync_word_dictionary()
        """
    )
    op.execute(
        "revoke execute on function public.sync_word_dictionary() from public, anon, authenticated"
    )

    # ── retire the per-row tier cap trigger (see module docstring) ─────
    op.execute("drop trigger if exists trg_words_limit on public.words")
    op.execute("drop function if exists public.enforce_words_limit()")

    # ── RLS on the new table, same pattern as every other user-owned one ─
    op.execute("alter table public.dictionaries enable row level security")
    op.execute(
        "create policy dictionaries_select_own on public.dictionaries "
        "for select using (auth.uid() = user_id)"
    )
    op.execute(
        "create policy dictionaries_insert_own on public.dictionaries "
        "for insert with check (auth.uid() = user_id)"
    )
    op.execute(
        "create policy dictionaries_update_own on public.dictionaries "
        "for update using (auth.uid() = user_id)"
    )
    op.execute(
        "create policy dictionaries_delete_own on public.dictionaries "
        "for delete using (auth.uid() = user_id)"
    )
    op.execute("grant select, insert, update, delete on public.dictionaries to authenticated")


def downgrade() -> None:
    # Best-effort: rows written with a widened part_of_speech value (e.g.
    # 'pronoun') or spread across multiple dictionaries for the same word
    # will violate the constraints/index recreated below. Acceptable for an
    # emergency rollback path that CI only exercises immediately after
    # upgrade, before any such data can exist.
    op.execute("drop trigger if exists trg_words_sync_dictionary on public.words")
    op.execute("drop function if exists public.sync_word_dictionary()")

    op.execute(
        """
        create or replace function public.enforce_words_limit()
        returns trigger
        language plpgsql
        security definer
        set search_path = public
        as $$
        declare
          v_tier text;
          v_count integer;
        begin
          select coalesce(tier, 'free') into v_tier
          from public.profiles
          where user_id = new.user_id;

          if coalesce(v_tier, 'free') = 'free' then
            select count(*) into v_count
            from public.words
            where user_id = new.user_id;

            if v_count >= 300 then
              raise exception
                'FREE_WORD_LIMIT_REACHED: Free users can store up to 300 words.'
                ' Upgrade to Premium for unlimited words.'
                using errcode = 'P0001';
            end if;
          end if;

          return new;
        end;
        $$
        """
    )
    op.execute(
        """
        create trigger trg_words_limit
        before insert on public.words
        for each row execute function public.enforce_words_limit()
        """
    )

    op.drop_index("words_word_trgm_idx", table_name="words", schema="public")
    op.drop_index("words_search_tsv_idx", table_name="words", schema="public")
    op.drop_index("words_dictionary_created_idx", table_name="words", schema="public")
    op.drop_index("words_dictionary_word_pos_unique", table_name="words", schema="public")
    op.create_index(
        "words_user_created_idx",
        "words",
        ["user_id", sa.text("created_at desc")],
        schema="public",
    )
    op.create_index(
        "words_user_word_pos_unique",
        "words",
        ["user_id", sa.text("lower(word)"), "part_of_speech"],
        unique=True,
        schema="public",
    )

    op.drop_constraint("words_part_of_speech_check", "words", schema="public", type_="check")
    op.execute("update public.words set part_of_speech = 'noun' where part_of_speech is null")
    op.alter_column("words", "part_of_speech", nullable=False, schema="public")
    op.create_check_constraint(
        "words_part_of_speech_check",
        "words",
        "part_of_speech in ('noun', 'verb', 'adjective', 'adverb')",
        schema="public",
    )

    op.drop_constraint("words_dictionary_id_fkey", "words", schema="public", type_="foreignkey")
    op.drop_column("words", "deleted_at", schema="public")
    op.drop_column("words", "language_code", schema="public")
    op.drop_column("words", "difficulty", schema="public")
    op.drop_column("words", "notes", schema="public")
    op.drop_column("words", "translation", schema="public")
    op.drop_column("words", "dictionary_id", schema="public")

    op.drop_table("dictionaries", schema="public")
    op.execute("drop extension if exists pg_trgm")
