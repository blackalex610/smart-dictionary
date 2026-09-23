# Supabase backend

Postgres (with row-level security), Google OAuth and one Edge Function
(`ai-chat`) that is the only place the AI provider key is used.

Full deployment steps, environment variables, backups and rollback are in
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md). This file is the quick reference.

## Layout

| Path                                | What it is                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `migrations/`                       | The **only** schema source of truth. Apply in filename order.             |
| `functions/ai-chat/`                | Edge Function: auth check → request validation → quota → AI → validation. |
| `functions/_shared/aiValidation.ts` | Validators for model output; also imported by the React app (`@shared`).  |
| `functions/_shared/cors.ts`         | CORS, restricted by the `ALLOWED_ORIGINS` secret.                         |
| `tests/security.test.ts`            | Applies every migration to PGlite and checks RLS, quota and tier rules.   |

## Apply the schema

```bash
supabase link --project-ref <project-ref>
supabase db push            # applies migrations/ in order
```

Without the CLI, paste each file from `migrations/` into the SQL editor in
order. Every migration is safe to re-run.

## Deploy the function

```bash
supabase secrets set OPENROUTER_API_KEY=... ALLOWED_ORIGINS=https://your-domain
supabase functions deploy ai-chat
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform. Optional
secrets: `AI_MODEL_CHAT`, `AI_MODEL_QUIZ`, `AI_MODEL_EXTRACTION`,
`AI_MODEL_FALLBACK`, `AI_TIMEOUT_MS`, `OPENROUTER_SITE_URL`,
`OPENROUTER_APP_NAME`.

## Limits enforced in the database

- Free plan: 300 words, 10 AI requests per day.
- Premium: unlimited words; AI capped at 1,000 requests per day as a cost
  safety net (shown to users as unlimited).
- Everyone: 40 AI requests per minute.
- Tiers can only be changed by the service role or from the SQL editor:
  `update public.profiles set tier = 'premium' where user_id = '<uuid>';`

## Check it

```bash
npm test -- supabase/tests                                  # RLS / quota regression suite
npx deno check supabase/functions/ai-chat/index.ts          # type-check the function
```
