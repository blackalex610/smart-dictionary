# Words/Dictionaries API + Spaced-Repetition System — scoped design

## Context

The app has no memory model: nothing tracks when a word was last seen, how
well it went, or when it's due again. Word selection for flashcards and
quizzes is manual checkbox picking plus a shuffle. `word_reviews` and
`review_log` (migration `0003`) exist in the database — a trigger even
creates a `word_reviews` row for every word — but nothing reads or writes
them.

This is Phase 4 ("Dictionary API and frontend cut-over") + Phase 5 ("The
learning system") of `docs/architecture/v2-plan.md`, combined into one work
order because Phase 5 depends on Phase 4's words API. That document is the
approved architecture and stays authoritative for anything this spec doesn't
override; this file exists to pin a bounded, buildable slice of it so an
implementation plan has a fixed target instead of the whole nine-phase
roadmap.

## Goal

A user can open the app and get a real answer to "what should I study
today?": a due-aware review queue driven by an SM-2 scheduler, fed by
flashcard review ratings, with the words/dictionaries data it depends on
served by the FastAPI backend instead of directly from Supabase.

## Current state (verified in the repo, 2026-09-15)

- **Backend**: `app/api/v1/router.py` mounts only `me.py`. `DictionaryRepository`
  and `WordRepository` exist but have no router/schemas above them.
  `WordReview` and `ReviewLog` SQLAlchemy models exist and match the DB exactly.
  No `services/` package exists yet. `backend/tests/integration/` already has
  repo-level tests and RLS tests for dictionaries/words to build on.
- **Database**: migrations `0001`-`0006` are applied: baseline, `dictionaries`
  - `words.dictionary_id` (expand-only, `folder` still written by the live
    frontend via a sync trigger), `word_reviews` + `review_log` + creation
    trigger, `quiz_attempts`/`quiz_answers`, `ai_requests`/`ai_cache`/`import_jobs`,
    `usage_daily` reshape. **Not yet migrated**: `profiles` has no `locale`,
    `timezone`, `daily_new_limit`, or `daily_review_limit` columns — §E of the
    plan specs these but no migration has written them yet, and the review
    queue's caps and day-boundary math need them.
- **Frontend**: fully pre-cutover. `src/lib/supabase/words.ts` etc. talk to
  Supabase directly. `WordsBackend` (`src/types/domain.ts:27`) is already the
  seam Phase 4 swaps an implementation into. `FlashcardsPage.tsx` does
  checkbox selection + `shuffle()`, no due-date concept anywhere.

## Scope

**In scope** (per user decision: full Phase 4 as written, then Phase 5):

- Backend: `dictionaries`, `words`, `reviews` routers, schemas, services,
  repository extensions; `services/srs.py` (pure SM-2); a new migration
  adding the four `profiles` columns above.
- Frontend: `api/client.ts` + `dictionaries.ts`/`words.ts`/`reviews.ts` +
  generated types; `httpWords` adapter behind the existing `WordsBackend`
  port; deletion of `src/lib/guest/` and `src/lib/supabase/{words,progress,usage,profiles}.ts`;
  one-time guest-data import prompt on first login; a seeded demo account;
  new `useReviewQueue` hook and `ReviewPage`; `FlashcardsPage` becomes the
  entry point into it; `domain/srs.ts` client-side interval preview.
- A later migration drops `words.folder` once this deploy is live and the
  frontend no longer writes it (expand/contract, separate deploy — matches
  the pattern already used in migrations `0002`/`0004`/`0006`).

**Explicitly out of scope** (later phases in v2-plan.md, untouched here):

- AI service (`/ai/*`), quiz generation and server-side grading, quiz
  answers feeding the SRS (that's Phase 6 — quizzes aren't cut over yet).
- Import/export pipeline, analytics dashboard.
- A11y/perf/polish pass (§ Phase 8), `body { zoom }` removal, `Dialog`/
  `Skeleton`/`EmptyState` consolidation — real problems, but unrelated to
  the memory model and not touched incidentally.
- Dropping `profiles.tier` and its protection trigger. §E of the plan groups
  this with the `profiles` changes, but tier removal is a billing/quota
  concern with its own blast radius (RPC functions, `useAiUsage`, `/me`
  response shape) and isn't required for review scheduling to work. Deferred
  to whichever work order does the tier retirement.

## Backend architecture

New files, following the existing layering (`api/v1` parses/serialises,
`services/` holds rules, `repositories/` holds SQL — see `app/repositories/words.py`'s
own docstring):

```
app/api/v1/dictionaries.py   CRUD + word_count/due_count per dictionary
app/api/v1/words.py          list (keyset, search, filters), get, create, patch, delete, bulk-create, move
app/api/v1/reviews.py        GET /queue, POST / (submit rating), GET /forecast
app/schemas/dictionaries.py
app/schemas/words.py
app/schemas/reviews.py
app/services/dictionaries.py service-layer rules: default-dictionary invariant, name collisions
app/services/words.py        service-layer rules: global word cap (replaces enforce_words_limit)
app/services/srs.py          PURE: next_state(state, rating, now) -> state. No DB imports.
app/repositories/reviews.py  word_reviews + review_log queries
```

### Endpoints (subset of §F needed here)

```
GET    /api/v1/dictionaries
POST   /api/v1/dictionaries
GET    /api/v1/dictionaries/{id}
PATCH  /api/v1/dictionaries/{id}
DELETE /api/v1/dictionaries/{id}          soft delete

GET    /api/v1/dictionaries/{id}/words    ?cursor=&limit=50&q=&pos=&difficulty=&state=&sort=
POST   /api/v1/dictionaries/{id}/words
POST   /api/v1/dictionaries/{id}/words:bulk
GET    /api/v1/words/{id}
PATCH  /api/v1/words/{id}
DELETE /api/v1/words/{id}
POST   /api/v1/words/{id}:move            { dictionary_id }

GET    /api/v1/reviews/queue              ?dictionary_id=&limit=
POST   /api/v1/reviews                    { word_id, rating: 1-4, elapsed_ms, source: 'flashcard' }
GET    /api/v1/reviews/forecast           ?days=14
```

`source` is constrained to `'flashcard'` for this work order — `'quiz'` stays
valid in the DB check constraint (already there from migration `0003`) but
nothing emits it until Phase 6 wires quiz submission to reviews.

Errors follow the existing `AppError` → RFC 9457 pattern in `app/errors.py`
(`NotFoundError`, `ValidationFailedError`, plus new `DUPLICATE_WORD` and
`WORD_LIMIT_REACHED` subclasses). Ownership failures are always `NOT_FOUND`,
never `FORBIDDEN`, matching the existing convention.

### The SRS algorithm

Ported verbatim from v2-plan.md §H — this is the one piece of this feature
with a precise, already-agreed-on spec, so it is not re-derived here:

```python
AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4
LEARNING_STEPS_MIN = (1, 10)
GRADUATING_INTERVAL_DAYS = 1
EASY_INTERVAL_DAYS = 4
MIN_EASE, EASE_FLOOR_STEP = 1.30, 0.20

def next_state(s: ReviewState, rating: int, now: datetime) -> ReviewState:
    if s.state in ("new", "learning", "relearning"):
        if rating == AGAIN:
            return s.at_step(0, due=now + timedelta(minutes=LEARNING_STEPS_MIN[0]))
        if rating == EASY:
            return s.graduate(interval=EASY_INTERVAL_DAYS, due=now + timedelta(days=EASY_INTERVAL_DAYS))
        nxt = s.step + 1
        if nxt >= len(LEARNING_STEPS_MIN):
            return s.graduate(interval=GRADUATING_INTERVAL_DAYS,
                              due=now + timedelta(days=GRADUATING_INTERVAL_DAYS))
        return s.at_step(nxt, due=now + timedelta(minutes=LEARNING_STEPS_MIN[nxt]))

    if rating == AGAIN:
        ease = max(MIN_EASE, s.ease - EASE_FLOOR_STEP)
        return s.lapse(ease=ease, interval=1, due=now + timedelta(days=1))

    ease = max(MIN_EASE, s.ease + {HARD: -0.15, GOOD: 0.0, EASY: +0.10}[rating])
    mult = {HARD: 1.2, GOOD: ease, EASY: ease * 1.3}[rating]
    interval = max(1, round(s.interval * mult * fuzz(s.word_id)))
    return s.advance(ease=ease, interval=interval, due=now + timedelta(days=interval))
```

`fuzz(word_id)` is a deterministic ±5% derived from the word id. `now` is
injected (never `datetime.now()` inside the pure function), so tests are
reproducible. Not implemented, on purpose: FSRS, per-user parameter tuning,
load balancing, sibling burying — same reasoning as v2-plan.md §H.

`POST /reviews` writes both tables in one transaction: updates the
`word_reviews` row via `next_state`, and appends a `review_log` row with the
before/after interval and ease (columns already exist).

### Migration: profiles columns

New migration adds `locale text not null default 'bg'`, `timezone text not
null default 'Europe/Sofia'`, `daily_new_limit smallint not null default 10
check (between 0 and 100)`, `daily_review_limit smallint not null default
100 check (between 10 and 500)` to `profiles`. Additive only — no existing
column touched, `tier` stays untouched per the deferral above.

### Daily queue query

One query, served by the existing `word_reviews_due_idx` partial index
(migration `0003`):

```sql
(select w.*, r.* from word_reviews r join words w on w.id = r.word_id
 where r.user_id = :uid and r.state <> 'new' and r.due_at <= :now
   and w.deleted_at is null and (:dict_id is null or w.dictionary_id = :dict_id)
 order by r.due_at limit :review_cap)
union all
(select ... where r.state = 'new' ... order by w.created_at limit :new_cap)
```

Caps come from the new `profiles.daily_new_limit`/`daily_review_limit`,
reduced by `usage_daily.reviews_done` for the user's local day (computed
using `profiles.timezone`, not UTC).

## Frontend architecture

```
src/api/client.ts          fetch wrapper: bearer token, X-Request-ID, timeout, problem+json -> AppError
src/api/errors.ts          code -> i18n key, single mapping point
src/api/generated.ts        openapi-typescript output, not hand-edited
src/api/dictionaries.ts
src/api/words.ts
src/api/reviews.ts
src/domain/srs.ts          next-interval preview, tested against the same fixture table as services/srs.py
src/hooks/useDictionaries.ts
src/hooks/useReviewQueue.ts
src/pages/ReviewPage.tsx   NEW
```

- `httpWords` becomes the third `WordsBackend` implementation; `useWords.ts`'s
  `useWordsBackend()` returns it. `WordCard`, `WordList`, `AddWordForm`,
  `SearchBar`, `FolderSidebar` are not modified — that's the payoff of
  `WordsBackend` already existing as a seam.
- Delete `src/lib/guest/` (both files) and `src/lib/supabase/words.ts` (the only Supabase-direct
  file this work order's backend replaces). `src/lib/supabase/{progress,usage,profiles}.ts` are
  **not** deleted here despite v2-plan.md §G grouping them together — those back quiz history,
  AI usage display, and profile upsert respectively, none of which this work order cuts over
  (quiz generation/grading is Phase 6, per the explicit scope deferral above). Deleting them now
  would break `useQuizHistory`, `useAiUsage`, and `AuthContext` with no replacement built here.
  `src/lib/supabase/client.ts` and `auth.ts` stay regardless — Supabase remains the auth SDK.
- One-time guest-data import prompt on first login (reads whatever the guest
  path had locally, offers to import into the new default dictionary, then
  never shows again).
- Demo account seeded (fixture data + a dictionary + some words already in
  various review states, for demoing/testing the queue without manual data entry).
- `ReviewPage`: full-viewport card, four rating buttons showing next-interval
  previews (via `domain/srs.ts`), swipe left/right, keyboard 1-4,
  `prefers-reduced-motion` honoured. `FlashcardsPage` becomes the entry point
  (dictionary/scope picker) into `ReviewPage`, replacing today's raw
  checkbox-and-shuffle flow.
- Components never import from `api/` directly, only `hooks/` do — same rule
  already implied by the current `WordsBackend` boundary, made mechanical
  later via ESLint (not part of this work order).

## Rollout ordering

1. Migration for `profiles` columns (additive, safe to deploy alone).
2. Backend: dictionaries + words routers/services (Phase 4 slice), deployed
   and covered by integration tests, **before** any frontend change ships —
   two data planes (Supabase-direct and HTTP) briefly coexist, matching the
   pattern already used for `words.folder`.
3. Backend: reviews router + `srs.py`, deployed once dictionaries/words are live.
4. Frontend cut-over: `httpWords` behind `WordsBackend`, then `ReviewPage`/
   `useReviewQueue`, then guest-mode deletion + import prompt + demo seed,
   in that order so there's always a working app at each step.
5. Follow-up migration drops `words.folder` after step 4 is deployed and the
   sync trigger has nothing left to reconcile — separate deploy, not bundled.

## Testing strategy

- `services/srs.py`: unit tests written first (TDD) against an enumerable
  fixture table — every `(state, rating)` combination from `new` through
  multiple `review` cycles including a lapse. Pure function, no DB, no mocks.
- Every new endpoint: integration test with `httpx.AsyncClient` against real
  Postgres (existing `backend/tests/integration/conftest.py` pattern), each
  with an authz case (`NOT_FOUND` for another user's resource) alongside the
  happy path — following `test_dictionaries_repository.py`'s existing shape.
- `domain/srs.ts`: unit tests against the _same_ fixture table as
  `services/srs.py` (kept as a shared JSON/data file so the two can't drift).
- `useReviewQueue`, `ReviewPage`: Vitest + Testing Library, MSW for the API layer.
- No new E2E flow is required by this work order; the existing Playwright
  suite (once it exists, per v2-plan.md §K) picks up "review a due word"
  in Phase 9.

## Definition of done

- A user with due words sees them in `ReviewPage`, rates them 1-4, and the
  next due date visibly moves per SM-2.
- `word_reviews`/`review_log` are the only place review state lives — no
  client-side shadow state.
- All words/dictionaries CRUD goes through the FastAPI backend; Supabase is
  used only for auth.
- `backend/tests/integration` covers every new endpoint's happy path + one
  authz case; `services/srs.py` has full branch coverage of the state machine.
- CI (lint, typecheck, backend tests, frontend tests, `alembic check`) is green.

## Explicitly deferred (tracked, not forgotten)

- `profiles.tier` removal and the billing/quota rework it implies.
- Quiz answers feeding the SRS (`source='quiz'`) — Phase 6.
- AI-assisted review features (e.g. AI-generated examples inside `ReviewPage`) — Phase 6+.
- Analytics/forecast dashboard visualisation beyond the raw `/reviews/forecast` endpoint — Phase 7.
