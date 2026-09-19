# Supabase

Backend for the Smart Dictionary app: Postgres (via Supabase), Google OAuth
(Supabase Auth), and one Edge Function for AI features.

## Schema

`supabase/migrations/` is the single source of truth for the database schema.
There is no `schema.sql` or `rls.sql` — both existed in an earlier iteration
of this project, disagreed with the migrations, and `rls.sql` used
`create policy if not exists`, which is not valid PostgreSQL and never ran
successfully. They have been removed.

Apply migrations in order via the Supabase SQL editor, or with the Supabase
CLI:

```bash
supabase db push
```

Everything in `public` is owned by exactly one user (`user_id`) and RLS
enforces `auth.uid() = user_id` on every table. `usage_daily` is the one
exception: it has no client-facing insert/update/delete policy and its
table-level DML grants are revoked, because all writes to it must go through
the `SECURITY DEFINER` RPCs in the baseline migration — each of which checks
`p_user_id = auth.uid()` before touching anything.

## Auth

Google OAuth via Supabase Auth, PKCE flow. In the Supabase dashboard, under
Auth → URL Configuration, the redirect URLs must include:

- `http://localhost:5173/auth/callback` (dev)
- the production origin's `/auth/callback`

(This project has no `config.toml`, so these settings are not version
controlled — they live only in the dashboard. Keep this file updated if they
change.)

## Edge Functions

`ai-chat` verifies the caller's JWT, checks their AI quota via
`consume_ai_request_quota`, then calls OpenAI.

```bash
supabase functions deploy ai-chat
supabase secrets set OPENAI_API_KEY=YOUR_KEY
supabase secrets set OPENAI_MODEL=gpt-4o-mini
```

## Known gaps (tracked in docs/architecture/v2-plan.md)

- `protect_profile_tier_update()` checks the legacy PostgREST GUC
  (`request.jwt.claim.role`), which current PostgREST does not set. Tier can
  currently never be changed by anyone, including `service_role`. **Not
  dropped in Phase 3 after all**: `src/lib/supabase/profiles.ts:14` still
  does `select('user_id, display_name, avatar_url, tier')` against the live
  table, so removing the column now (before the Phase 4 frontend cut-over
  stops selecting it) would 400 every profile fetch in production. Deferred
  to Phase 4, alongside that query's update — same expand/contract reasoning
  as `words.folder`, `progress`, and `usage_daily.daily_limit` below.
- `enforce_words_limit()` (the O(n)-per-row 300-word cap trigger) was
  dropped in migration 0002 — it has no live reader outside the trigger
  itself, so no frontend dependency blocked it. The global word cap becomes
  a service-layer check once the words API exists (Phase 4).
- Authorization lives entirely in RLS today. It gets a second, independently
  testable layer once the FastAPI backend lands (Phase 2+); see the plan.
- Migrations 0002–0006 (Phase 3) add `dictionaries`, `word_reviews`,
  `review_log`, `quiz_attempts`/`quiz_answers`, `ai_requests`, `ai_cache` and
  `import_jobs`, and reshape `usage_daily` with new counters. `words.folder`,
  `progress`, and `usage_daily.daily_limit` are intentionally _not_ dropped
  yet — each still has a live reader/writer that the Phase 4 (frontend) and
  Phase 6 (AI service) cut-overs replace. Alembic (`backend/alembic/`) is now
  the single lineage; new schema changes belong there, not as new files in
  this directory.
