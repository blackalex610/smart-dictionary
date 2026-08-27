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
  currently never be changed by anyone, including `service_role`. Not fixed
  here because the `tier` column itself is dropped in Phase 3 (single-tier
  model).
- `enforce_words_limit()` runs a `count(*)` per inserted row — O(n) per row
  on bulk import. Replaced by a service-layer check in Phase 3.
- Authorization lives entirely in RLS today. It gets a second, independently
  testable layer once the FastAPI backend lands (Phase 2+); see the plan.
