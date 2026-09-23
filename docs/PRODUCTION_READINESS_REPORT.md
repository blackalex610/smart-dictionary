# Production readiness report

Audit and hardening against `PRODUCTIONREADY.md`, on branch
`worktree-production-readiness`. The first commit is a verbatim snapshot of the
uncommitted work that was in the main checkout (chat actions, import pipeline,
OpenRouter switch); the second contains every change described here.

## Executive summary

The app is a React 18 + Vite SPA on Supabase (Postgres + RLS, Google OAuth, one
Edge Function `ai-chat` calling OpenRouter). The `backend/` folder has no source
(only a venv and caches, all gitignored) and is not part of the running system.

Security holes were found and fixed in the database, the Edge Function and the
client. The weakest area had been the database: any signed-in user could reset
their own AI quota or spend another user's. Beyond that, AI output was trusted
without validation, and imports wrote to the dictionary with no preview or
de-duplication. Several data-loss paths were closed. Guest mode had no mobile
navigation and several dialogs lacked keyboard support; both are fixed. Tests
went from 65 to 151, including a suite that applies every migration to a real
Postgres (PGlite) and attacks it.

## Architecture

```
browser ──(anon key + user JWT)──► PostgREST ──► Postgres (RLS on every table)
   └──(user JWT)──► Edge Function ai-chat ──► consume_ai_request_quota() ──► OpenRouter
```

Guests stay entirely in the browser (`localStorage`, local quiz generation).

## Security

| Issue found                                                                                                                           | Fix                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `usage_update_own` / `usage_insert_own` policies survived 0006 — any user could `update usage_daily set ai_requests = 0` (reproduced) | Migration 0008 drops them; writes only via SECURITY DEFINER functions                           |
| Quota RPCs took any `p_user_id` and were executable by all users — A could burn/read B's quota (reproduced)                           | Bound to `auth.uid()`; legacy `increment_ai_usage*` dropped; `get_user_tier` revoked            |
| Tier guard read a JWT setting PostgREST no longer sets: admins could not change tiers (reproduced); inserts unguarded                 | `is_privileged_context()`; inserts forced to `free`                                             |
| No per-minute limit; premium unbounded                                                                                                | 40 req/min for everyone, premium safety cap 1,000/day                                           |
| Free word cap was a count-then-insert race                                                                                            | Per-user advisory lock                                                                          |
| Unbounded text columns                                                                                                                | Length / size CHECK constraints (NOT VALID, existing rows untouched)                            |
| Edge Function returned raw provider and DB error text                                                                                 | Generic codes to the client; structured metadata-only logs server-side                          |
| User data interpolated straight into prompts; imported text could carry instructions                                                  | Data in delimited tags, explicit "data not instructions" rule, directive brackets defused       |
| AI JSON trusted without validation                                                                                                    | `supabase/functions/_shared/aiValidation.ts`, enforced server-side and again in the client      |
| Chat `add-word` action applied silently                                                                                               | Same validator as imports + an Undo toast                                                       |
| CSV export open to formula injection                                                                                                  | Cells starting `= + - @` are neutralised; round-trip import strips the guard                    |
| No security headers / CSP; inline script                                                                                              | `vercel.json`, `public/_headers`: strict CSP (`script-src 'self'`), HSTS, nosniff, DENY framing |
| Uploads unbounded (size, zip bomb), binary files decoded as text                                                                      | 5 MB file cap, 20 MB inflate cap, magic-byte rejection, parser crashes mapped to "corrupt"      |
| Legacy `supabase/schema.sql` + `rls.sql` (invalid SQL, would re-create the bypass)                                                    | Deleted; `migrations/` is the single source of truth                                            |
| CORS `*`                                                                                                                              | `ALLOWED_ORIGINS` secret                                                                        |

Verified: no secrets in `dist/` (the local OpenRouter key is absent, no
`sk-`/service-role tokens); no `innerHTML`/`dangerouslySetInnerHTML`/`eval`
anywhere; all user and AI text renders through React escaping.

**Remaining risks:** react-router 6 open-redirect advisory (moderate; not
reachable, since the app only navigates to fixed routes; fix is the v7 major);
vite/esbuild dev-server advisories (dev only). The local root `.env` holds
`OPENROUTER_API_KEY`; Vite does not bundle it, but it belongs in
`supabase/functions/.env`.

## Reliability

- Supabase `list()` silently stopped at 1,000 rows → paginated.
- "Clear dictionary" sent every id in one `in (...)` built from that capped
  list → single owner-scoped delete.
- Guest `localStorage` write failures were swallowed (word "saved", gone on
  refresh) → surfaced as an error; corrupt data is backed up before overwrite;
  guest tabs sync via `storage` events.
- Denied/failed Google sign-in left `/auth/callback` spinning forever → error
  detection + 15 s timeout back to login with a message; sign-in start failures
  shown; sign-out always clears the UI and the query cache (also on account
  switch); sign-out is now local-scope (no longer logs out other devices).
- One unavailable/rate-limited AI call now stops further calls for that quiz
  (previously 20 questions could each wait for a timeout); client timeout 100 s,
  offline detected before calling.
- Router error boundary replaces React Router's developer error page.
- `Modal` re-ran its focus effect on every render (focus jumped to the first
  field when toggling an option) → fixed via a shared `useDialogFocus` hook.
- Every insert made an auth-server round trip (`getUser`) → local session.

## AI

| Task                     | Default model (env override)                     | Validation                                                |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| chat                     | `deepseek/deepseek-v4.1-flash` (`AI_MODEL_CHAT`) | text, NFC, control chars removed, ≤ 4,000 chars           |
| wrong answers            | `z-ai/glm-5.3-flash` (`AI_MODEL_QUIZ`)           | 1 correct + exactly 3 distinct, non-empty distractors     |
| open / gap / verb gap    | same                                             | answer not visible in the prompt; exactly one `____`      |
| reading                  | same (now JSON)                                  | per question: 2–4 unique options, integer answer index    |
| structure-words (import) | `z-ai/glm-5.3-flash` (`AI_MODEL_EXTRACTION`)     | JSON entries, known part of speech (EN/BG), length limits |
| fallback                 | `z-ai/glm-5.3` (`AI_MODEL_FALLBACK`)             | one retry only, on retryable errors or invalid output     |

Timeouts 25 s (45 s for reading/import), `max_tokens` per task, request body
≤ 64 KB, validation before quota is spent. Chat now receives its history and a
system prompt that actually describes the action allowlist the client parses
(`start-quiz`, `start-flashcards`, `open`, `add-word`, nothing else). Local quiz
fallback no longer produces duplicate options or the `"<answer> (1)"` padding
that gave the answer away; reading questions without an answer key are dropped
instead of defaulting to A.

## Import

Validate → extract → sanitise → (AI) → schema validation → de-duplicate →
**preview → confirm** → save with progress. The app's own JSON, CSV and TXT
exports now round-trip without AI (guests previously could not re-import CSV/TXT).
Found in the browser pass and fixed: with the default "split by paragraph", a
`word,definition,pos` file was glued into one entry.

## Testing

151 tests (was 65), all passing: AI validators, quiz generation, import parsing
and de-duplication, CSV escaping, guest storage, AI client error mapping, the
import flow rendered in React, and `supabase/tests/security.test.ts` (12 tests
running all migrations on PGlite: quota reset, cross-user RPCs, tier changes,
RLS isolation, constraints, free cap).

Also run: ESLint, Prettier, `tsc`, production build, `deno check` of the
function, production dependency audit, and a Playwright pass against the
production build under the production CSP. That pass covered guest mode:
add, import with preview and de-duplication, a multiple-choice test with
grading and history, keyboard flashcards, a deep-link reload, the chat guest
notice, and a 390 px mobile layout. No console errors or CSP violations.

**Not exercised live:** Google sign-in, Supabase CRUD as a signed-in user, and
real OpenRouter calls (no credentials in this environment). The default model
IDs are unverified against OpenRouter's catalogue.

## Performance

Vendor code split into cached chunks (app 152 kB, react 207 kB, supabase 220 kB,
query 41 kB); Flashcards/Tests/Settings load on demand. "View all words" no
longer renders the whole dictionary at once (batches of 60).

## Accessibility

Dialog semantics, focus trap and focus restore for the quiz and flashcards;
Escape does not discard a quiz in progress; labelled radio groups and progress
bar; `role="log"` for chat, `role="alert"` for error toasts; visible
`:focus-visible` ring; `prefers-reduced-motion`; `fg-subtle` contrast raised
from 2.5:1 to 4.8:1; mobile navigation (sections were unreachable below 768 px);
long words wrap; inert notifications bell removed.

## Deployment and environment

See `docs/DEPLOYMENT.md`: environment variables, first deployment, OAuth
redirect allow-list, headers, rollback, backups, observability, privacy table.
Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional
`VITE_OAUTH_REDIRECT_URL`. Function: `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS`,
optional model/timeouts. CI now also type-checks the Edge Function.

## Before public release

1. Apply migration `202609220008_security_hardening.sql` to the production
   database (the quota bypass is live until then).
2. Deploy `ai-chat` and set `ALLOWED_ORIGINS`.
3. Run the authenticated smoke test in `docs/DEPLOYMENT.md` (sign-in, AI quiz,
   chat, AI import) and confirm the model IDs resolve on OpenRouter.
4. Enable backups (PITR on a paid plan, or scheduled `supabase db dump`) and set
   a spend limit on the OpenRouter key.

Non-blocking: react-router v7 upgrade, a client error-tracking service, and
OpenRouter's data-retention terms for the privacy policy.

## Final status

`NOT READY FOR PRODUCTION`. No known blocking defects remain in the code, but
the four gates above are required before real users arrive, and the
authenticated/AI paths have not yet been exercised against the live services.
