# Deployment and operations

Smart Dictionary is a static React SPA (Vite) backed by Supabase: Postgres with
row-level security, Google OAuth, and one Edge Function (`ai-chat`) that is the
only component holding the AI provider key.

```
browser ──(anon key + user JWT)──► Supabase PostgREST ──► Postgres (RLS)
   │                                                        ▲
   └──(user JWT)──► Edge Function ai-chat ──► consume_ai_request_quota()
                         │
                         └──(OPENROUTER_API_KEY)──► OpenRouter
```

Guests never reach the backend: their dictionary lives in `localStorage` and
quizzes use locally generated questions.

## Environment variables

### Frontend (build time, public)

| Variable                  | Required | Notes                                    |
| ------------------------- | -------- | ---------------------------------------- |
| `VITE_SUPABASE_URL`       | yes      | `https://<ref>.supabase.co`              |
| `VITE_SUPABASE_ANON_KEY`  | yes      | Public by design; RLS protects the data. |
| `VITE_OAUTH_REDIRECT_URL` | no       | Defaults to `<origin>/auth/callback`.    |

Anything prefixed `VITE_` is compiled into the JavaScript bundle. **No secret
may use that prefix.** Keep server secrets out of the root `.env` entirely.

### Edge Function (runtime, secret)

| Secret                                                  | Required    | Notes                                                      |
| ------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| `OPENROUTER_API_KEY`                                    | yes         | The only AI credential. Rotate if it ever leaves Supabase. |
| `ALLOWED_ORIGINS`                                       | recommended | Comma-separated, e.g. `https://umenrechnik.app`.           |
| `AI_MODEL_CHAT` / `_QUIZ` / `_EXTRACTION` / `_FALLBACK` | no          | Override the model routing without a redeploy.             |
| `AI_TIMEOUT_MS`                                         | no          | Per provider call, default 25 000.                         |
| `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`            | no          | Attribution headers sent to OpenRouter.                    |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to functions automatically.

## First deployment

1. **Supabase project.** Create it, then `supabase link --project-ref <ref>`.
2. **Schema.** `supabase db push` (applies `supabase/migrations/` in order).
3. **Google OAuth.** Authentication → Providers → Google: add the client ID and
   secret from Google Cloud Console. In Google Cloud, the authorised redirect
   URI is `https://<ref>.supabase.co/auth/v1/callback`.
4. **Redirect allow-list.** Authentication → URL Configuration: set _Site URL_
   to the production origin and add `https://<your-domain>/auth/callback`
   (plus `http://localhost:5173/auth/callback` for development) to _Redirect
   URLs_. Nothing else — an over-broad wildcard allows open redirects.
5. **Edge Function.**
   ```bash
   supabase secrets set OPENROUTER_API_KEY=... ALLOWED_ORIGINS=https://<your-domain>
   supabase functions deploy ai-chat
   ```
6. **Frontend.** Set the three `VITE_` variables in the host, then build with
   `npm ci && npm run build` and publish `dist/`.
   - **Vercel:** `vercel.json` is picked up automatically (SPA rewrites,
     security headers, caching).
   - **Netlify / Cloudflare Pages:** `public/_headers` and `public/_redirects`
     are copied into `dist/` and applied automatically.
   - **Anything else (nginx, S3 + CDN):** serve `index.html` for unknown
     paths, and copy the headers from `public/_headers`.
   - Source maps are generated as `dist/**/*.map` but not referenced. Delete
     them before upload if the source should stay private.
7. **Smoke test.** Sign in with Google, add a word, run a multiple-choice test,
   send a chat message, import a small `.txt`, sign out and back in.

## Security headers

Served by `vercel.json` / `public/_headers` (and by `npm run preview` for local
checks): a strict Content-Security-Policy (`script-src 'self'`, connections
only to `*.supabase.co`, `frame-ancestors 'none'`), HSTS, `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and COOP. If
Supabase is moved to a custom domain, add it to `connect-src`.

## Routine deploys

- CI (`.github/workflows/ci.yml`) must be green: lint, format, typecheck,
  unit/integration/database tests, build, `deno check` of the function, and
  the production dependency audit.
- Apply new migrations **before** deploying code that depends on them.
  Migrations are additive and re-runnable; the client degrades gracefully for
  columns that are not there yet (see `words.example`).
- Deploy the Edge Function before the frontend when the AI contract changes;
  the frontend accepts both the old and the new response shapes.

## Rollback

- **Frontend:** redeploy the previous build (Vercel/Netlify keep them). The
  PWA service worker picks up the rollback on the next visit.
- **Edge Function:** `git checkout <good-sha> -- supabase/functions && supabase functions deploy ai-chat`.
- **Database:** migrations are forward-only. To undo one, write a new
  migration that reverses it; do not edit an applied file. For data loss,
  restore from backup (below).

## Backups and recovery

Supabase takes daily backups on paid plans (7 days on Pro); enable
**Point-in-Time Recovery** for anything beyond a hobby deployment. On the free
plan there are **no automatic backups** — schedule a dump instead:

```bash
supabase db dump --data-only -f backup-$(date +%F).sql   # data
supabase db dump -f schema-$(date +%F).sql               # schema
```

Store dumps off-platform (encrypted). Test a restore into a scratch project at
least once. Users can also export their own dictionary (JSON/CSV/TXT) and
re-import it; the import de-duplicates, so a re-import is safe.

## Observability

- **Edge Function logs** (Supabase dashboard → Functions → ai-chat → Logs):
  one JSON line per event — `ai_request` (task, model, attempt, latency,
  token counts, validation pass/fail), `quota_denied`, `ai_failed`,
  `auth_failed`, `unhandled_error` with a `requestId`. Prompts, replies,
  dictionary contents and tokens are never logged.
- **Cost:** `select usage_date, sum(ai_requests) from usage_daily group by 1 order by 1 desc;`
  plus the OpenRouter dashboard. Set a spend limit on the OpenRouter key.
- **Client errors:** the router error boundary logs a `route_error` JSON line
  to the browser console. There is no error-tracking service; add one (e.g.
  Sentry) if production visibility into client crashes is needed.

## Privacy

| Data                         | Where                        | Why                     | Retention                     | Sent to AI provider                                                       |
| ---------------------------- | ---------------------------- | ----------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Google name, email, avatar   | Supabase Auth, `profiles`    | Account, display        | Until the account is deleted  | No                                                                        |
| Words, definitions, examples | `words` (RLS: owner only)    | The dictionary          | Until deleted by the user     | Words/definitions for quizzes; up to 150 as chat context                  |
| Quiz results                 | `progress` (RLS: owner only) | History                 | Until the account is deleted  | No                                                                        |
| AI request counts            | `usage_daily`                | Quota and cost control  | Indefinite (small)            | No                                                                        |
| Chat messages                | Browser memory only          | Conversation            | Until the page is closed      | Yes (last 12 turns)                                                       |
| Imported file text           | Browser memory only          | Structuring             | Not stored                    | Yes, first 8 000 characters, only when the file is not already structured |
| Guest dictionary, settings   | `localStorage`               | Guest mode, preferences | Until browser data is cleared | No                                                                        |

Deleting a user in Supabase Auth cascades to `profiles`, `words`, `progress`
and `usage_daily`. OpenRouter's own retention depends on the routed provider;
review it before launch and mention it in the privacy policy.
