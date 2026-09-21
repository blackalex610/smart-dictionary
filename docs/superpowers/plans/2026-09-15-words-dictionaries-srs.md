# Words/Dictionaries API + SRS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual flashcard/quiz word selection with a due-aware spaced-repetition system, backed by a FastAPI dictionaries/words/reviews API instead of direct Supabase access from the frontend.

**Architecture:** FastAPI routers (`dictionaries`, `words`, `reviews`) over existing SQLAlchemy models, with a pure `services/srs.py` implementing SM-2 and repositories doing all SQL. The frontend gets a new `httpWords` implementation of the existing `WordsBackend` port (so `WordCard`/`WordList`/`AddWordForm` need no changes), plus a new `ReviewPage` fed by a `useReviewQueue` hook.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, pytest + pytest-asyncio (backend); React, TanStack Query, react-router-dom, Vitest + Testing Library + MSW (frontend).

**Spec:** `docs/architecture/v2-plan.md` (authoritative for anything not overridden below) and `docs/superpowers/specs/2026-09-15-words-dictionaries-srs-design.md` (the bounded scope for this plan).

## Global Constraints

- Ownership failures are always `404 NOT_FOUND`, never `403` (v2-plan.md §F — never confirm another user's resource exists).
- Errors are RFC 9457 problem+json via the existing `AppError` hierarchy in `app/errors.py`; every new error type is a subclass with a fixed `code`/`status`, never an ad-hoc `HTTPException`.
- Every repository method filters `deleted_at is null` and scopes to `user_id` — no raw query bypasses this (existing convention in `app/repositories/words.py`/`dictionaries.py`).
- Pagination is keyset-only: cursor `(sort_value, id)`, no `OFFSET`, opaque base64 cursor (v2-plan.md §E "no OFFSET anywhere").
- The SRS function `next_state(state, rating, now)` is pure — no DB import, `now` always injected, never `datetime.now()` inside it (v2-plan.md §H).
- Components (`WordCard`, `WordList`, `AddWordForm`, `SearchBar`, `FolderSidebar`) are not modified — `httpWords` adapts to the existing `WordsBackend` interface in `src/types/domain.ts` instead (design spec §Frontend architecture).
- New translation keys are added to `src/i18n/locales/en.ts` (source of the `Dict` type) and `src/i18n/locales/bg.ts` (primary market language); other locales inherit via the existing `en` fallback in `translate()` — full translation to es/zh/fr/de is out of scope here.
- Backend tests: integration tests run against real Postgres via `db_session` (rolled back per test); unit tests (pure functions) take no fixtures. Frontend tests: Vitest + Testing Library, MSW for anything hitting `src/api/*`.

---

## Task 1: Migration — `profiles` review-scheduling columns

**Files:**

- Create: `backend/alembic/versions/0007_profile_review_settings.py`
- Test: `backend/tests/integration/test_profiles_migration.py`

**Interfaces:**

- Produces: `profiles.locale` (text, default `'bg'`), `profiles.timezone` (text, default `'Europe/Sofia'`), `profiles.daily_new_limit` (smallint, default `10`, check 0-100), `profiles.daily_review_limit` (smallint, default `100`, check 10-500). No model change needed yet — `Profile` (`backend/app/models/profile.py`) gets the new columns in Task 10 when the dictionaries service needs them; this task is DB-only plus a migration test.

- [ ] **Step 1: Write the failing migration test**

```python
# backend/tests/integration/test_profiles_migration.py
from sqlalchemy import text

from tests.factories import create_user


async def test_profile_gets_default_review_settings(db_session):
    user_id = await create_user(db_session)
    await db_session.execute(
        text("insert into public.profiles (user_id) values (:user_id)"), {"user_id": user_id}
    )

    row = (
        await db_session.execute(
            text(
                "select locale, timezone, daily_new_limit, daily_review_limit "
                "from public.profiles where user_id = :user_id"
            ),
            {"user_id": user_id},
        )
    ).one()

    assert row.locale == "bg"
    assert row.timezone == "Europe/Sofia"
    assert row.daily_new_limit == 10
    assert row.daily_review_limit == 100


async def test_daily_new_limit_check_constraint(db_session):
    from sqlalchemy.exc import IntegrityError

    import pytest

    user_id = await create_user(db_session)
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "insert into public.profiles (user_id, daily_new_limit) "
                "values (:user_id, 101)"
            ),
            {"user_id": user_id},
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_profiles_migration.py -v`
Expected: FAIL — `column "locale" does not exist` (migration `0007` doesn't exist yet, so `alembic upgrade head` in the `_migrated_database` fixture stops at `0006`).

- [ ] **Step 3: Write the migration**

```python
# backend/alembic/versions/0007_profile_review_settings.py
"""profiles: locale, timezone, daily review/new limits, per §E.

Additive only. `timezone` is needed to compute the user's local "today" for
the review queue's daily caps and streaks -- a UTC day boundary is wrong
for a study streak. `tier` is untouched; its retirement is a separate,
deferred work order (see docs/superpowers/specs/2026-09-15-*.md).

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("locale", sa.Text(), nullable=False, server_default="bg"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("timezone", sa.Text(), nullable=False, server_default="Europe/Sofia"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("daily_new_limit", sa.SmallInteger(), nullable=False, server_default="10"),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("daily_review_limit", sa.SmallInteger(), nullable=False, server_default="100"),
        schema="public",
    )
    op.create_check_constraint(
        "profiles_daily_new_limit_check",
        "profiles",
        "daily_new_limit between 0 and 100",
        schema="public",
    )
    op.create_check_constraint(
        "profiles_daily_review_limit_check",
        "profiles",
        "daily_review_limit between 10 and 500",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("profiles_daily_review_limit_check", "profiles", schema="public")
    op.drop_constraint("profiles_daily_new_limit_check", "profiles", schema="public")
    op.drop_column("profiles", "daily_review_limit", schema="public")
    op.drop_column("profiles", "daily_new_limit", schema="public")
    op.drop_column("profiles", "timezone", schema="public")
    op.drop_column("profiles", "locale", schema="public")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_profiles_migration.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run `alembic check` to confirm the model/migration drift check the CI job runs is still clean**

Run: `cd backend && alembic check`
Expected: no output (no model changes yet, so nothing to compare against — this just confirms the migration applies cleanly to `head`)

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/0007_profile_review_settings.py backend/tests/integration/test_profiles_migration.py
git commit -m "feat: add profiles.locale/timezone/daily_new_limit/daily_review_limit"
```

---

## Task 2: Pagination cursor helpers

**Files:**

- Create: `backend/app/pagination.py`
- Test: `backend/tests/unit/test_pagination.py`

**Interfaces:**

- Produces: `encode_cursor(value: str, id_: str) -> str`, `decode_cursor(cursor: str) -> Cursor` where `Cursor` is a frozen dataclass with `.value: str` and `.id: str`. `decode_cursor` raises `ValueError` on malformed input (callers translate this to `ValidationFailedError`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_pagination.py
import pytest

from app.pagination import Cursor, decode_cursor, encode_cursor


def test_round_trip():
    cursor = encode_cursor("2026-09-15T10:00:00+00:00", "11111111-1111-1111-1111-111111111111")
    decoded = decode_cursor(cursor)
    assert decoded == Cursor(
        value="2026-09-15T10:00:00+00:00", id="11111111-1111-1111-1111-111111111111"
    )


def test_cursor_is_url_safe():
    cursor = encode_cursor("has/slashes+plus", "id")
    assert "/" not in cursor
    assert "+" not in cursor


def test_decode_rejects_garbage():
    with pytest.raises(ValueError):
        decode_cursor("not-a-real-cursor")


def test_decode_rejects_missing_fields():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"v": "only-value"}).encode()).decode()
    with pytest.raises(ValueError):
        decode_cursor(bad)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_pagination.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.pagination'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/pagination.py
"""Opaque keyset-pagination cursors. No OFFSET anywhere in this codebase --
see docs/architecture/v2-plan.md §E -- so every paginated list encodes its
last row's (sort_value, id) into this cursor instead."""

import base64
import binascii
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Cursor:
    value: str
    id: str


def encode_cursor(value: str, id_: str) -> str:
    raw = json.dumps({"v": value, "i": id_}).encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str) -> Cursor:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode())
        data = json.loads(raw)
        return Cursor(value=data["v"], id=data["i"])
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_pagination.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/pagination.py backend/tests/unit/test_pagination.py
git commit -m "feat: add keyset pagination cursor helpers"
```

---

## Task 3: SRS scheduler — pure SM-2 (`services/srs.py`)

**Files:**

- Create: `backend/app/services/__init__.py`, `backend/app/services/srs.py`, `src/domain/srs-fixtures.json` (shared with `src/domain/srs.test.ts` in Task 16 — kept under `src/` rather than `docs/` so it stays inside `tsconfig.json`'s `include`, which only covers `src`)
- Test: `backend/tests/unit/test_srs.py`

**Interfaces:**

- Produces: `ReviewState` (frozen dataclass: `word_id: str`, `state: Literal["new","learning","relearning","review"]`, `step: int`, `ease: Decimal`, `interval: int`), and `next_state(state: ReviewState, rating: int, now: datetime) -> tuple[ReviewState, datetime]` returning the new state plus the computed `due_at`. Constants `AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4` are re-exported for callers (the reviews router and repository use these instead of magic numbers).
- Consumes: nothing (pure, stdlib only).

This is the one piece of this feature with an already-fully-specified algorithm (v2-plan.md §H), so the test table below enumerates it exhaustively rather than deriving it from scratch.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_srs.py
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.services.srs import AGAIN, EASY, GOOD, HARD, ReviewState, next_state

NOW = datetime(2026, 9, 15, 10, 0, 0, tzinfo=UTC)
WORD_ID = "11111111-1111-1111-1111-111111111111"


def _new_state(**overrides: object) -> ReviewState:
    base = dict(word_id=WORD_ID, state="new", step=0, ease=Decimal("2.50"), interval=0)
    base.update(overrides)
    return ReviewState(**base)  # type: ignore[arg-type]


def test_new_card_again_stays_at_step_zero_due_in_one_minute():
    new_state, due_at = next_state(_new_state(), AGAIN, NOW)
    assert new_state.state == "learning"
    assert new_state.step == 0
    assert due_at == NOW + timedelta(minutes=1)


def test_new_card_good_advances_to_step_one_due_in_ten_minutes():
    new_state, due_at = next_state(_new_state(), GOOD, NOW)
    assert new_state.state == "learning"
    assert new_state.step == 1
    assert due_at == NOW + timedelta(minutes=10)


def test_learning_card_good_at_last_step_graduates_to_review():
    learning = _new_state(state="learning", step=1)
    new_state, due_at = next_state(learning, GOOD, NOW)
    assert new_state.state == "review"
    assert new_state.interval == 1
    assert due_at == NOW + timedelta(days=1)


def test_new_card_easy_graduates_immediately_with_four_day_interval():
    new_state, due_at = next_state(_new_state(), EASY, NOW)
    assert new_state.state == "review"
    assert new_state.interval == 4
    assert due_at == NOW + timedelta(days=4)


def test_learning_card_again_resets_to_step_zero():
    learning = _new_state(state="learning", step=1)
    new_state, due_at = next_state(learning, AGAIN, NOW)
    assert new_state.state == "learning"
    assert new_state.step == 0
    assert due_at == NOW + timedelta(minutes=1)


def test_review_card_again_lapses_to_relearning_with_eased_floor():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    new_state, due_at = next_state(review, AGAIN, NOW)
    assert new_state.state == "relearning"
    assert new_state.ease == Decimal("2.30")
    assert new_state.interval == 1
    assert due_at == NOW + timedelta(days=1)


def test_review_card_ease_floor_does_not_go_below_1_30():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("1.40"), interval=5)
    new_state, _due = next_state(review, AGAIN, NOW)
    assert new_state.ease == Decimal("1.30")


def test_review_card_hard_reduces_ease_and_uses_1_2_multiplier():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    new_state, due_at = next_state(review, HARD, NOW)
    assert new_state.ease == Decimal("2.35")
    assert new_state.interval == 12  # round(10 * 1.2), fuzz applied but bounded
    assert due_at.date() == (NOW + timedelta(days=new_state.interval)).date()


def test_review_card_good_uses_ease_as_multiplier_and_keeps_ease_flat():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    new_state, _due = next_state(review, GOOD, NOW)
    assert new_state.ease == Decimal("2.50")
    assert new_state.interval == 25  # round(10 * 2.50), fuzz ±5%


def test_review_card_easy_increases_ease_and_uses_1_3x_ease_multiplier():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    new_state, _due = next_state(review, EASY, NOW)
    assert new_state.ease == Decimal("2.60")
    # round(10 * 2.60 * 1.3) == 34, fuzz applied but must land within ±5%
    assert 32 <= new_state.interval <= 36


def test_relearning_card_behaves_like_learning():
    relearning = _new_state(state="relearning", step=0)
    new_state, due_at = next_state(relearning, GOOD, NOW)
    assert new_state.state == "learning"
    assert new_state.step == 1
    assert due_at == NOW + timedelta(minutes=10)


def test_interval_never_drops_below_one_day_in_review_state():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("1.30"), interval=1)
    new_state, _due = next_state(review, HARD, NOW)
    assert new_state.interval >= 1


def test_fuzz_is_deterministic_for_the_same_word_id():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    first, _ = next_state(review, GOOD, NOW)
    second, _ = next_state(review, GOOD, NOW)
    assert first.interval == second.interval


def test_invalid_rating_raises():
    with pytest.raises(ValueError):
        next_state(_new_state(), 5, NOW)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_srs.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/services/__init__.py
```

```python
# backend/app/services/srs.py
"""SM-2, simplified and deliberately not more. Pure -- no DB, no clock reads.
`now` is always injected by the caller. See docs/architecture/v2-plan.md §H
for the algorithm and the rationale for not implementing FSRS.

Not implemented, on purpose: FSRS, per-user parameter optimisation, load
balancing, sibling burying.
"""

import hashlib
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4
_VALID_RATINGS = {AGAIN, HARD, GOOD, EASY}

_LEARNING_STEPS_MIN: tuple[int, ...] = (1, 10)
_GRADUATING_INTERVAL_DAYS = 1
_EASY_INTERVAL_DAYS = 4
_MIN_EASE = Decimal("1.30")
_EASE_FLOOR_STEP = Decimal("0.20")

State = Literal["new", "learning", "relearning", "review"]


@dataclass(frozen=True)
class ReviewState:
    word_id: str
    state: State
    step: int
    ease: Decimal
    interval: int


def _fuzz(word_id: str) -> float:
    """Deterministic +/-5% derived from the word id -- spreads review load
    without making tests non-reproducible."""
    digest = hashlib.sha256(word_id.encode()).digest()
    unit = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF  # 0.0 .. 1.0
    return 0.95 + unit * 0.10  # 0.95 .. 1.05


def next_state(state: ReviewState, rating: int, now: datetime) -> tuple[ReviewState, datetime]:
    if rating not in _VALID_RATINGS:
        raise ValueError(f"rating must be one of {sorted(_VALID_RATINGS)}, got {rating}")

    if state.state in ("new", "learning", "relearning"):
        if rating == AGAIN:
            due = now + timedelta(minutes=_LEARNING_STEPS_MIN[0])
            return replace(state, state="learning", step=0), due
        if rating == EASY:
            due = now + timedelta(days=_EASY_INTERVAL_DAYS)
            return (
                replace(state, state="review", step=0, interval=_EASY_INTERVAL_DAYS),
                due,
            )
        next_step = state.step + 1
        if next_step >= len(_LEARNING_STEPS_MIN):
            due = now + timedelta(days=_GRADUATING_INTERVAL_DAYS)
            return (
                replace(state, state="review", step=0, interval=_GRADUATING_INTERVAL_DAYS),
                due,
            )
        due = now + timedelta(minutes=_LEARNING_STEPS_MIN[next_step])
        return replace(state, state="learning", step=next_step), due

    # state.state == "review"
    if rating == AGAIN:
        ease = max(_MIN_EASE, state.ease - _EASE_FLOOR_STEP)
        due = now + timedelta(days=1)
        return replace(state, state="relearning", step=0, ease=ease, interval=1), due

    ease_delta = {HARD: Decimal("-0.15"), GOOD: Decimal("0.0"), EASY: Decimal("0.10")}[rating]
    ease = max(_MIN_EASE, state.ease + ease_delta)
    multiplier = {HARD: Decimal("1.2"), GOOD: ease, EASY: ease * Decimal("1.3")}[rating]
    interval = max(1, round(state.interval * float(multiplier) * _fuzz(state.word_id)))
    due = now + timedelta(days=interval)
    return replace(state, state="review", step=0, ease=ease, interval=interval), due
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_srs.py -v`
Expected: PASS (14 tests). If the `GOOD`/`EASY`/`HARD` interval assertions fail by ±1 due to rounding order, adjust the _test's_ expected range, not the multiplier table — the multiplier values themselves are fixed by the spec.

- [ ] **Step 4a: Write the shared cross-language fixture and a parity test against it**

This JSON file is read by both this test (below) and `src/domain/srs.test.ts` (Task 16) so the Python and TypeScript state machines can't silently drift apart. It only covers fuzz-independent assertions (state/step/ease/due-offset, never a fuzzed `interval`) since the two languages don't share a fuzz implementation — see Task 16.

```json
// src/domain/srs-fixtures.json
[
  {
    "description": "new+again",
    "input": { "state": "new", "step": 0, "ease": "2.50", "interval": 0 },
    "rating": 1,
    "expectState": "learning",
    "expectStep": 0,
    "expectDueMinutes": 1
  },
  {
    "description": "new+good",
    "input": { "state": "new", "step": 0, "ease": "2.50", "interval": 0 },
    "rating": 3,
    "expectState": "learning",
    "expectStep": 1,
    "expectDueMinutes": 10
  },
  {
    "description": "learning_step1+good_graduates",
    "input": { "state": "learning", "step": 1, "ease": "2.50", "interval": 0 },
    "rating": 3,
    "expectState": "review",
    "expectStep": 0,
    "expectInterval": 1,
    "expectDueDays": 1
  },
  {
    "description": "new+easy",
    "input": { "state": "new", "step": 0, "ease": "2.50", "interval": 0 },
    "rating": 4,
    "expectState": "review",
    "expectStep": 0,
    "expectInterval": 4,
    "expectDueDays": 4
  },
  {
    "description": "review+again_lapses",
    "input": { "state": "review", "step": 0, "ease": "2.50", "interval": 10 },
    "rating": 1,
    "expectState": "relearning",
    "expectStep": 0,
    "expectEase": "2.30",
    "expectInterval": 1,
    "expectDueDays": 1
  },
  {
    "description": "review+hard_ease",
    "input": { "state": "review", "step": 0, "ease": "2.50", "interval": 10 },
    "rating": 2,
    "expectEase": "2.35"
  },
  {
    "description": "review+good_ease_unchanged",
    "input": { "state": "review", "step": 0, "ease": "2.50", "interval": 10 },
    "rating": 3,
    "expectEase": "2.50"
  },
  {
    "description": "review+easy_ease",
    "input": { "state": "review", "step": 0, "ease": "2.50", "interval": 10 },
    "rating": 4,
    "expectEase": "2.60"
  }
]
```

```python
# backend/tests/unit/test_srs.py — append
import json
import pathlib

FIXTURE_PATH = pathlib.Path(__file__).parents[3] / "src" / "domain" / "srs-fixtures.json"


def test_matches_shared_cross_language_fixture():
    cases = json.loads(FIXTURE_PATH.read_text())
    for case in cases:
        state = ReviewState(
            word_id=WORD_ID,
            state=case["input"]["state"],
            step=case["input"]["step"],
            ease=Decimal(case["input"]["ease"]),
            interval=case["input"]["interval"],
        )
        new_state, due_at = next_state(state, case["rating"], NOW)

        if "expectState" in case:
            assert new_state.state == case["expectState"], case["description"]
        if "expectStep" in case:
            assert new_state.step == case["expectStep"], case["description"]
        if "expectInterval" in case:
            assert new_state.interval == case["expectInterval"], case["description"]
        if "expectEase" in case:
            assert new_state.ease == Decimal(case["expectEase"]), case["description"]
        if "expectDueMinutes" in case:
            assert due_at == NOW + timedelta(minutes=case["expectDueMinutes"]), case["description"]
        if "expectDueDays" in case:
            assert due_at == NOW + timedelta(days=case["expectDueDays"]), case["description"]
```

Run: `cd backend && pytest tests/unit/test_srs.py -v -k shared_cross_language`
Expected: PASS (8 cases, all assertions inline)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/__init__.py backend/app/services/srs.py backend/tests/unit/test_srs.py src/domain/srs-fixtures.json
git commit -m "feat: add pure SM-2 scheduler (services/srs.py)"
```

---

## Task 4: New error types and shared constants

**Files:**

- Modify: `backend/app/errors.py`
- Create: `backend/app/constants.py`
- Test: `backend/tests/unit/test_errors.py`

**Interfaces:**

- Produces: `DuplicateWordError` (409, `DUPLICATE_WORD`), `WordLimitReachedError` (409, `WORD_LIMIT_REACHED`), `ValidationFailedError` reused as-is. `app.constants.MAX_WORDS_PER_USER = 5000` (v2-plan.md §F's own error example: "This account is limited to 5000 words").

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_errors.py
from app.errors import DuplicateWordError, WordLimitReachedError


def test_duplicate_word_error_shape():
    err = DuplicateWordError("cat already exists in this dictionary")
    assert err.status == 409
    assert err.code == "DUPLICATE_WORD"


def test_word_limit_reached_error_shape():
    err = WordLimitReachedError("This account is limited to 5000 words.")
    assert err.status == 409
    assert err.code == "WORD_LIMIT_REACHED"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_errors.py -v`
Expected: FAIL — `ImportError: cannot import name 'DuplicateWordError'`

- [ ] **Step 3: Add the error classes and constants**

```python
# backend/app/errors.py — add after ValidationFailedError
class DuplicateWordError(AppError):
    status = 409
    code = "DUPLICATE_WORD"
    title = "Word already exists"


class WordLimitReachedError(AppError):
    status = 409
    code = "WORD_LIMIT_REACHED"
    title = "Word limit reached"
```

```python
# backend/app/constants.py
"""Every request-shape limit, once, per docs/architecture/v2-plan.md §F."""

MAX_WORDS_PER_USER = 5000
WORDS_LIST_MAX_LIMIT = 100
WORDS_LIST_DEFAULT_LIMIT = 50
WORDS_BULK_MAX_ROWS = 500
WORD_MAX_LENGTH = 100
DEFINITION_MAX_LENGTH = 500
EXAMPLE_MAX_LENGTH = 250
TRANSLATION_MAX_LENGTH = 200
NOTES_MAX_LENGTH = 1000
DICTIONARY_NAME_MAX_LENGTH = 60
REVIEWS_FORECAST_MAX_DAYS = 60
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_errors.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/errors.py backend/app/constants.py backend/tests/unit/test_errors.py
git commit -m "feat: add DuplicateWordError/WordLimitReachedError and shared constants"
```

---

## Task 5: Session commit-on-success lifecycle

**Files:**

- Modify: `backend/app/deps.py`
- Test: `backend/tests/integration/test_session_lifecycle.py`

**Interfaces:**

- Produces: `get_session` now commits on clean exit and rolls back on exception. This is a prerequisite for every write endpoint in this plan (Task 7 onward) — today's only endpoint, `GET /me`, is read-only, so this gap has never mattered until now.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/integration/test_session_lifecycle.py
"""get_session must commit on success -- every write endpoint from here on
depends on it. Uses the real session_factory (not the rolled-back
db_session fixture) so the commit is actually exercised against Postgres."""

import uuid

import pytest
from sqlalchemy import select, text

from app.deps import get_session
from app.models import Dictionary


async def test_get_session_commits_on_success(_migrated_database):
    from app.config import Settings
    from app.db import make_engine, make_session_factory

    settings = Settings(database_url=_migrated_database, supabase_url="https://example.supabase.co")  # type: ignore[arg-type]
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)

    class _FakeApp:
        class state:  # noqa: N801 - mirrors request.app.state
            pass

    _FakeApp.state.session_factory = session_factory

    class _FakeRequest:
        app = _FakeApp

    user_id = uuid.uuid4()
    async with session_factory() as setup_session:
        await setup_session.execute(
            text("insert into auth.users (id) values (:id)"),
            {"id": user_id},
        )
        await setup_session.commit()

    gen = get_session(_FakeRequest())  # type: ignore[arg-type]
    session = await gen.__anext__()
    session.add(Dictionary(user_id=user_id, name="Committed"))
    with pytest.raises(StopAsyncIteration):
        await gen.__anext__()

    async with session_factory() as verify_session:
        found = await verify_session.scalar(select(Dictionary).where(Dictionary.name == "Committed"))
        assert found is not None

    await engine.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_session_lifecycle.py -v`
Expected: FAIL — `found is not None` assertion fails (nothing was committed)

- [ ] **Step 3: Fix `get_session`**

```python
# backend/app/deps.py — replace the existing get_session
async def get_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_session_lifecycle.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite to confirm nothing that relied on the old no-commit behaviour broke**

Run: `cd backend && pytest -v`
Expected: PASS (the `db_session` fixture used by every other integration test wraps its own connection in a transaction that's always rolled back regardless of what the session does, so this change is invisible to them)

- [ ] **Step 6: Commit**

```bash
git add backend/app/deps.py backend/tests/integration/test_session_lifecycle.py
git commit -m "fix: commit the request session on success, roll back on exception"
```

---

## Task 6: Reviews repository (`word_reviews` + `review_log`)

**Files:**

- Create: `backend/app/repositories/reviews.py`
- Modify: `backend/app/repositories/__init__.py`
- Modify: `backend/tests/factories.py` (add `create_word_review_state` helper)
- Test: `backend/tests/integration/test_reviews_repository.py`

**Interfaces:**

- Consumes: `app.services.srs.ReviewState`, `app.models.WordReview`, `app.models.ReviewLog`.
- Produces: `ReviewRepository(session)` with:
  - `async def get_state(word_id: UUID, user_id: UUID) -> ReviewState | None`
  - `async def apply_rating(word_id: UUID, user_id: UUID, rating: int, now: datetime, source: str, elapsed_ms: int | None) -> tuple[ReviewState, datetime]` — reads current `WordReview`, calls `next_state`, writes both `word_reviews` and `review_log` in the same session, returns the new `ReviewState` plus its `due_at`. Raises `LookupError` if no `word_reviews` row exists for that `(word_id, user_id)`.
  - `async def queue(user_id: UUID, *, dictionary_id: UUID | None, new_cap: int, review_cap: int, now: datetime) -> list[tuple[Word, WordReview]]`
  - `async def forecast(user_id: UUID, *, days: int, now: datetime) -> dict[date, int]` — due count per day for the next `days` days.

- [ ] **Step 1: Add the test factory helper**

```python
# backend/tests/factories.py — add at the end
from datetime import datetime
from decimal import Decimal

from app.models import WordReview


async def set_review_state(
    session: AsyncSession,
    word_id: uuid.UUID,
    *,
    state: str = "review",
    ease_factor: str = "2.50",
    interval_days: int = 10,
    due_at: datetime | None = None,
) -> WordReview:
    review = await session.get(WordReview, word_id)
    assert review is not None, "word_reviews row should exist via the create_word_review trigger"
    review.state = state
    review.ease_factor = Decimal(ease_factor)
    review.interval_days = interval_days
    review.due_at = due_at
    await session.flush()
    return review
```

- [ ] **Step 2: Write the failing repository tests**

```python
# backend/tests/integration/test_reviews_repository.py
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ReviewLog, WordReview
from app.repositories.reviews import ReviewRepository
from app.services.srs import AGAIN, GOOD
from tests.factories import create_dictionary, create_user, create_word, set_review_state


async def test_get_state_for_new_word(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    repo = ReviewRepository(db_session)
    state = await repo.get_state(word.id, user_id)

    assert state is not None
    assert state.state == "new"
    assert state.interval == 0


async def test_get_state_returns_none_for_unowned_word(db_session):
    owner = await create_user(db_session, email="owner@example.com")
    other = await create_user(db_session, email="other@example.com")
    dictionary = await create_dictionary(db_session, owner)
    word = await create_word(db_session, dictionary.id, owner)

    repo = ReviewRepository(db_session)
    assert await repo.get_state(word.id, other) is None


async def test_apply_rating_updates_word_reviews_and_appends_review_log(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    repo = ReviewRepository(db_session)
    new_state, due_at = await repo.apply_rating(
        word.id, user_id, GOOD, now, source="flashcard", elapsed_ms=3200
    )

    assert new_state.state == "learning"
    assert new_state.step == 1
    assert due_at == now + timedelta(minutes=10)

    log = await db_session.scalar(select(ReviewLog).where(ReviewLog.word_id == word.id))
    assert log is not None
    assert log.rating == GOOD
    assert log.source == "flashcard"
    assert log.elapsed_ms == 3200
    assert log.interval_before == 0


async def test_apply_rating_raises_for_word_with_no_review_row(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)
    existing_review = await db_session.get(WordReview, word.id)
    await db_session.delete(existing_review)
    await db_session.flush()

    repo = ReviewRepository(db_session)
    with pytest.raises(LookupError):
        await repo.apply_rating(word.id, user_id, GOOD, datetime.now(UTC), source="flashcard", elapsed_ms=None)


async def test_queue_returns_due_review_words_before_new_words(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    due_word = await create_word(db_session, dictionary.id, user_id, word="due")
    await set_review_state(db_session, due_word.id, due_at=now - timedelta(hours=1))

    not_due_word = await create_word(db_session, dictionary.id, user_id, word="notdue")
    await set_review_state(db_session, not_due_word.id, due_at=now + timedelta(days=5))

    new_word = await create_word(db_session, dictionary.id, user_id, word="brandnew")

    repo = ReviewRepository(db_session)
    rows = await repo.queue(user_id, dictionary_id=None, new_cap=10, review_cap=10, now=now)

    words_in_order = [w.word for w, _review in rows]
    assert words_in_order == ["due", "brandnew"]


async def test_queue_respects_caps(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    for i in range(3):
        word = await create_word(db_session, dictionary.id, user_id, word=f"due{i}")
        await set_review_state(db_session, word.id, due_at=now - timedelta(hours=1))

    repo = ReviewRepository(db_session)
    rows = await repo.queue(user_id, dictionary_id=None, new_cap=0, review_cap=2, now=now)
    assert len(rows) == 2


async def test_queue_filters_by_dictionary(db_session):
    user_id = await create_user(db_session)
    dict_a = await create_dictionary(db_session, user_id, name="A")
    dict_b = await create_dictionary(db_session, user_id, name="B")
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    word_a = await create_word(db_session, dict_a.id, user_id, word="ina")
    await set_review_state(db_session, word_a.id, due_at=now - timedelta(hours=1))
    word_b = await create_word(db_session, dict_b.id, user_id, word="inb")
    await set_review_state(db_session, word_b.id, due_at=now - timedelta(hours=1))

    repo = ReviewRepository(db_session)
    rows = await repo.queue(user_id, dictionary_id=dict_a.id, new_cap=10, review_cap=10, now=now)
    assert [w.word for w, _r in rows] == ["ina"]


async def test_forecast_counts_due_per_day(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    tomorrow_word = await create_word(db_session, dictionary.id, user_id, word="tomorrow")
    await set_review_state(db_session, tomorrow_word.id, due_at=now + timedelta(days=1))
    also_tomorrow = await create_word(db_session, dictionary.id, user_id, word="alsotomorrow")
    await set_review_state(db_session, also_tomorrow.id, due_at=now + timedelta(days=1, hours=2))

    repo = ReviewRepository(db_session)
    forecast = await repo.forecast(user_id, days=7, now=now)

    assert forecast[(now + timedelta(days=1)).date()] == 2
    assert forecast[(now + timedelta(days=2)).date()] == 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_reviews_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.repositories.reviews'`

- [ ] **Step 4: Implement the repository**

```python
# backend/app/repositories/reviews.py
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReviewLog, Word, WordReview
from app.services.srs import ReviewState, next_state


def _to_domain(review: WordReview) -> ReviewState:
    return ReviewState(
        word_id=str(review.word_id),
        state=review.state,  # type: ignore[arg-type]
        step=review.repetitions if review.state != "review" else 0,
        ease=review.ease_factor,
        interval=review.interval_days,
    )


class ReviewRepository:
    """The only place word_reviews/review_log SQL is written -- see
    docs/architecture/v2-plan.md §H."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_state(self, word_id: uuid.UUID, user_id: uuid.UUID) -> ReviewState | None:
        review = await self._session.scalar(
            select(WordReview).where(WordReview.word_id == word_id, WordReview.user_id == user_id)
        )
        return _to_domain(review) if review is not None else None

    async def apply_rating(
        self,
        word_id: uuid.UUID,
        user_id: uuid.UUID,
        rating: int,
        now: datetime,
        *,
        source: str,
        elapsed_ms: int | None,
    ) -> tuple[ReviewState, datetime]:
        review = await self._session.scalar(
            select(WordReview).where(WordReview.word_id == word_id, WordReview.user_id == user_id)
        )
        if review is None:
            raise LookupError(f"No word_reviews row for word_id={word_id}, user_id={user_id}")

        before = _to_domain(review)
        after, due_at = next_state(before, rating, now)

        self._session.add(
            ReviewLog(
                word_id=word_id,
                user_id=user_id,
                rating=rating,
                reviewed_at=now,
                interval_before=before.interval,
                interval_after=after.interval,
                ease_before=before.ease,
                ease_after=after.ease,
                elapsed_ms=elapsed_ms,
                source=source,
            )
        )

        review.state = after.state
        review.ease_factor = after.ease
        review.interval_days = after.interval
        review.repetitions = after.step
        if rating == 1:  # AGAIN
            review.lapses += 1 if before.state == "review" else 0
        review.due_at = due_at
        review.last_reviewed_at = now
        await self._session.flush()
        return after, due_at

    async def queue(
        self,
        user_id: uuid.UUID,
        *,
        dictionary_id: uuid.UUID | None,
        new_cap: int,
        review_cap: int,
        now: datetime,
    ) -> list[tuple[Word, WordReview]]:
        due_stmt = (
            select(Word, WordReview)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state != "new",
                WordReview.due_at <= now,
                Word.deleted_at.is_(None),
            )
            .order_by(WordReview.due_at)
            .limit(review_cap)
        )
        new_stmt = (
            select(Word, WordReview)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state == "new",
                Word.deleted_at.is_(None),
            )
            .order_by(Word.created_at)
            .limit(new_cap)
        )
        if dictionary_id is not None:
            due_stmt = due_stmt.where(Word.dictionary_id == dictionary_id)
            new_stmt = new_stmt.where(Word.dictionary_id == dictionary_id)

        due_rows = list(await self._session.execute(due_stmt))
        new_rows = list(await self._session.execute(new_stmt))
        return [(w, r) for w, r in due_rows] + [(w, r) for w, r in new_rows]

    async def forecast(self, user_id: uuid.UUID, *, days: int, now: datetime) -> dict[date, int]:
        horizon = now + timedelta(days=days)
        rows = await self._session.execute(
            select(func.date(WordReview.due_at), func.count())
            .join(Word, Word.id == WordReview.word_id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state != "new",
                WordReview.due_at >= now,
                WordReview.due_at <= horizon,
                Word.deleted_at.is_(None),
            )
            .group_by(func.date(WordReview.due_at))
        )
        counts = {row[0]: row[1] for row in rows}
        return {(now + timedelta(days=i)).date(): counts.get((now + timedelta(days=i)).date(), 0) for i in range(days + 1)}
```

```python
# backend/app/repositories/__init__.py
from app.repositories.dictionaries import DictionaryRepository
from app.repositories.reviews import ReviewRepository
from app.repositories.words import WordRepository

__all__ = ["DictionaryRepository", "WordRepository", "ReviewRepository"]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_reviews_repository.py -v`
Expected: PASS (8 tests). If `test_apply_rating_updates_word_reviews_and_appends_review_log` fails on `new_state.step == 1`, check that `WordReview.repetitions` is being read back correctly by `_to_domain` — it's only meaningful while `state != "review"`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/repositories/reviews.py backend/app/repositories/__init__.py backend/tests/factories.py backend/tests/integration/test_reviews_repository.py
git commit -m "feat: add ReviewRepository (queue, apply_rating, forecast)"
```

---

## Task 7: Local-day helper + usage-daily repository

**Files:**

- Create: `backend/app/services/daytime.py`, `backend/app/repositories/usage.py`
- Modify: `backend/app/repositories/__init__.py`
- Test: `backend/tests/unit/test_daytime.py`, `backend/tests/integration/test_usage_repository.py`

**Interfaces:**

- Produces: `local_today(tz_name: str, now: datetime) -> date` (pure). `UsageRepository(session)` with `async def get_reviews_done(user_id: UUID, usage_date: date) -> int` and `async def increment_reviews_done(user_id: UUID, usage_date: date) -> None`.
- Consumes: `app.models.UsageDaily`.

- [ ] **Step 1: Write the failing daytime test**

```python
# backend/tests/unit/test_daytime.py
from datetime import UTC, datetime

from app.services.daytime import local_today


def test_local_today_matches_utc_when_timezone_is_utc():
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)
    assert local_today("UTC", now) == now.date()


def test_local_today_rolls_over_before_midnight_utc_for_eastern_timezone():
    # 23:30 UTC on the 15th is already 02:30 on the 16th in Sofia (UTC+3)
    now = datetime(2026, 9, 15, 23, 30, tzinfo=UTC)
    assert local_today("Europe/Sofia", now).day == 16


def test_local_today_stays_on_previous_day_for_western_timezone():
    # 02:00 UTC is still 21:00 the previous day in New York (UTC-5)
    now = datetime(2026, 9, 15, 2, 0, tzinfo=UTC)
    assert local_today("America/New_York", now).day == 14
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/unit/test_daytime.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.daytime'`

- [ ] **Step 3: Implement `local_today`**

```python
# backend/app/services/daytime.py
"""A UTC day boundary is wrong for a study streak or a daily review cap --
see docs/architecture/v2-plan.md §E. Pure, stdlib only."""

from datetime import date, datetime
from zoneinfo import ZoneInfo


def local_today(tz_name: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(tz_name)).date()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/unit/test_daytime.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing usage repository test**

```python
# backend/tests/integration/test_usage_repository.py
from datetime import date

from app.repositories.usage import UsageRepository
from tests.factories import create_user


async def test_get_reviews_done_defaults_to_zero(db_session):
    user_id = await create_user(db_session)
    repo = UsageRepository(db_session)
    assert await repo.get_reviews_done(user_id, date(2026, 9, 15)) == 0


async def test_increment_creates_row_on_first_call(db_session):
    user_id = await create_user(db_session)
    repo = UsageRepository(db_session)

    await repo.increment_reviews_done(user_id, date(2026, 9, 15))

    assert await repo.get_reviews_done(user_id, date(2026, 9, 15)) == 1


async def test_increment_accumulates_across_calls(db_session):
    user_id = await create_user(db_session)
    repo = UsageRepository(db_session)

    await repo.increment_reviews_done(user_id, date(2026, 9, 15))
    await repo.increment_reviews_done(user_id, date(2026, 9, 15))
    await repo.increment_reviews_done(user_id, date(2026, 9, 15))

    assert await repo.get_reviews_done(user_id, date(2026, 9, 15)) == 3


async def test_increment_is_scoped_to_the_given_date(db_session):
    user_id = await create_user(db_session)
    repo = UsageRepository(db_session)

    await repo.increment_reviews_done(user_id, date(2026, 9, 15))
    await repo.increment_reviews_done(user_id, date(2026, 9, 16))

    assert await repo.get_reviews_done(user_id, date(2026, 9, 15)) == 1
    assert await repo.get_reviews_done(user_id, date(2026, 9, 16)) == 1
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_usage_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.repositories.usage'`

- [ ] **Step 7: Implement `UsageRepository`**

```python
# backend/app/repositories/usage.py
import uuid
from datetime import date

from app.models import UsageDaily
from sqlalchemy.ext.asyncio import AsyncSession


class UsageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_reviews_done(self, user_id: uuid.UUID, usage_date: date) -> int:
        row = await self._session.get(UsageDaily, {"user_id": user_id, "usage_date": usage_date})
        return row.reviews_done if row is not None else 0

    async def increment_reviews_done(self, user_id: uuid.UUID, usage_date: date) -> None:
        row = await self._session.get(UsageDaily, {"user_id": user_id, "usage_date": usage_date})
        if row is None:
            self._session.add(UsageDaily(user_id=user_id, usage_date=usage_date, reviews_done=1))
        else:
            row.reviews_done += 1
        await self._session.flush()
```

```python
# backend/app/repositories/__init__.py
from app.repositories.dictionaries import DictionaryRepository
from app.repositories.reviews import ReviewRepository
from app.repositories.usage import UsageRepository
from app.repositories.words import WordRepository

__all__ = ["DictionaryRepository", "WordRepository", "ReviewRepository", "UsageRepository"]
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_usage_repository.py -v`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/daytime.py backend/app/repositories/usage.py backend/app/repositories/__init__.py backend/tests/unit/test_daytime.py backend/tests/integration/test_usage_repository.py
git commit -m "feat: add local_today helper and UsageRepository"
```

---

## Task 8: Authenticated API test client fixture

**Files:**

- Modify: `backend/tests/integration/conftest.py`

**Interfaces:**

- Produces: an `api_client` pytest fixture — a factory `(user_id: uuid.UUID, *, email: str | None = "test@example.com") -> httpx.AsyncClient` — usable by every router integration test from Task 9 onward. Overrides `get_session` to reuse the test's own rolled-back `db_session` and `get_current_user` to return a fixed `VerifiedUser`, so no real JWT or lifespan startup is needed.

No production code changes in this task — it's test infrastructure, proven by a smoke test against the one endpoint that already exists (`GET /me`).

- [ ] **Step 1: Write the failing smoke test**

```python
# backend/tests/integration/test_api_client_fixture.py
from sqlalchemy import text

from tests.factories import create_user


async def test_api_client_hits_me_endpoint_as_the_given_user(db_session, api_client):
    user_id = await create_user(db_session, email="fixture@example.com")
    await db_session.execute(
        text("insert into public.profiles (user_id) values (:id)"),
        {"id": user_id},
    )
    await db_session.flush()

    client = api_client(user_id, email="fixture@example.com")
    response = await client.get("/api/v1/me")

    assert response.status_code == 200
    assert response.json()["email"] == "fixture@example.com"
    await client.aclose()


async def test_api_client_without_a_profile_row_gets_404(db_session, api_client):
    user_id = await create_user(db_session, email="noprofile@example.com")

    client = api_client(user_id)
    response = await client.get("/api/v1/me")

    assert response.status_code == 404
    await client.aclose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_api_client_fixture.py -v`
Expected: FAIL — `fixture 'api_client' not found`

- [ ] **Step 3: Add the fixture**

```python
# backend/tests/integration/conftest.py — add at the end
import uuid
from collections.abc import AsyncGenerator, Callable

import httpx

from app.deps import get_current_user, get_session
from app.main import create_app
from app.security.jwt import VerifiedUser


@pytest.fixture
def api_client(
    db_session: AsyncSession,
) -> Callable[..., httpx.AsyncClient]:
    """Returns a factory building an httpx.AsyncClient authenticated as the
    given user, sharing this test's rolled-back db_session so nothing it
    writes leaks into another test."""
    app = create_app()

    async def _use_test_session() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_session] = _use_test_session

    def _make(user_id: uuid.UUID, *, email: str | None = "test@example.com") -> httpx.AsyncClient:
        app.dependency_overrides[get_current_user] = lambda: VerifiedUser(
            user_id=str(user_id), email=email
        )
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    yield _make
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_api_client_fixture.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/tests/integration/conftest.py backend/tests/integration/test_api_client_fixture.py
git commit -m "test: add authenticated api_client fixture for endpoint tests"
```

---

## Task 9: Reviews router — `GET /queue`, `POST /reviews`, `GET /forecast`

**Files:**

- Create: `backend/app/schemas/reviews.py`, `backend/app/api/v1/reviews.py`
- Test: `backend/tests/integration/test_reviews_api.py`

**Interfaces:**

- Consumes: `ReviewRepository`, `UsageRepository`, `local_today`, `app.models.Profile`, the `api_client` fixture from Task 8.
- Produces: `router` (an `APIRouter`) mounted at `/reviews` in Task 12's `api/v1/router.py`. Daily caps: `review_cap = max(0, profile.daily_review_limit - reviews_done_today)`, `new_cap = profile.daily_new_limit` (new-word exposure isn't reduced by `reviews_done` — that counter is the total-volume cap, `daily_new_limit` is a separate "don't overwhelm with new material" cap), both additionally clamped by the request's `limit` query param.

- [ ] **Step 1: Write the failing integration tests**

```python
# backend/tests/integration/test_reviews_api.py
from datetime import UTC, datetime, timedelta

from tests.factories import create_dictionary, create_user, create_word, set_review_state


async def _seed_profile(db_session, user_id, **overrides):
    import sqlalchemy as sa

    columns = {"user_id": user_id, **overrides}
    keys = ", ".join(columns.keys())
    placeholders = ", ".join(f":{k}" for k in columns)
    await db_session.execute(
        sa.text(f"insert into public.profiles ({keys}) values ({placeholders})"), columns
    )
    await db_session.flush()


async def test_queue_returns_due_and_new_words(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime.now(UTC)

    due = await create_word(db_session, dictionary.id, user_id, word="overdue")
    await set_review_state(db_session, due.id, due_at=now - timedelta(hours=2))
    await create_word(db_session, dictionary.id, user_id, word="fresh")

    client = api_client(user_id)
    response = await client.get("/api/v1/reviews/queue")
    body = response.json()

    assert response.status_code == 200
    words = [item["word"] for item in body["items"]]
    assert words == ["overdue", "fresh"]
    await client.aclose()


async def test_queue_excludes_another_users_words(db_session, api_client):
    owner = await create_user(db_session, email="owner2@example.com")
    other = await create_user(db_session, email="other2@example.com")
    await _seed_profile(db_session, other)
    dictionary = await create_dictionary(db_session, owner)
    await create_word(db_session, dictionary.id, owner)

    client = api_client(other)
    response = await client.get("/api/v1/reviews/queue")

    assert response.status_code == 200
    assert response.json()["items"] == []
    await client.aclose()


async def test_submit_review_advances_schedule_and_returns_due_at(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        "/api/v1/reviews",
        json={"word_id": str(word.id), "rating": 3, "elapsed_ms": 1500, "source": "flashcard"},
    )
    body = response.json()

    assert response.status_code == 201
    assert body["state"] == "learning"
    assert body["due_at"] is not None
    await client.aclose()


async def test_submit_review_for_unowned_word_is_404(db_session, api_client):
    owner = await create_user(db_session, email="owner3@example.com")
    other = await create_user(db_session, email="other3@example.com")
    await _seed_profile(db_session, other)
    dictionary = await create_dictionary(db_session, owner)
    word = await create_word(db_session, dictionary.id, owner)

    client = api_client(other)
    response = await client.post(
        "/api/v1/reviews", json={"word_id": str(word.id), "rating": 3, "source": "flashcard"}
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    await client.aclose()


async def test_submit_review_rejects_out_of_range_rating(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        "/api/v1/reviews", json={"word_id": str(word.id), "rating": 9, "source": "flashcard"}
    )

    assert response.status_code == 422
    await client.aclose()


async def test_submit_review_increments_reviews_done_and_reduces_queue_cap(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id, daily_review_limit=1)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime.now(UTC)

    first = await create_word(db_session, dictionary.id, user_id, word="first")
    await set_review_state(db_session, first.id, due_at=now - timedelta(hours=1))
    second = await create_word(db_session, dictionary.id, user_id, word="second")
    await set_review_state(db_session, second.id, due_at=now - timedelta(hours=1))

    client = api_client(user_id)
    await client.post(
        "/api/v1/reviews", json={"word_id": str(first.id), "rating": 3, "source": "flashcard"}
    )

    response = await client.get("/api/v1/reviews/queue")
    words = [item["word"] for item in response.json()["items"]]
    assert "second" not in words  # daily_review_limit=1 already spent
    await client.aclose()


async def test_forecast_returns_requested_number_of_days(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)

    client = api_client(user_id)
    response = await client.get("/api/v1/reviews/forecast", params={"days": 7})
    body = response.json()

    assert response.status_code == 200
    assert len(body["days"]) == 8  # today plus 7 days ahead, inclusive
    await client.aclose()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_reviews_api.py -v`
Expected: FAIL — `404 Not Found` for every request (no `/reviews` router mounted yet)

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/reviews.py
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReviewQueueItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    word: str
    definition: str
    part_of_speech: str | None
    example: str | None
    state: str
    due_at: datetime | None


class ReviewQueueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ReviewQueueItem]


class SubmitReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    rating: int = Field(ge=1, le=4)
    elapsed_ms: int | None = Field(default=None, ge=0, le=600_000)
    source: Literal["flashcard"] = "flashcard"


class SubmitReviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    state: str
    ease_factor: Decimal
    interval_days: int
    due_at: datetime


class ForecastDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    due_count: int


class ForecastResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: list[ForecastDay]
```

- [ ] **Step 4: Write the router**

```python
# backend/app/api/v1/reviews.py
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REVIEWS_FORECAST_MAX_DAYS
from app.deps import get_current_user, get_session
from app.errors import NotFoundError, UnauthenticatedError
from app.models import Profile
from app.repositories.reviews import ReviewRepository
from app.repositories.usage import UsageRepository
from app.schemas.reviews import (
    ForecastDay,
    ForecastResponse,
    ReviewQueueItem,
    ReviewQueueResponse,
    SubmitReviewRequest,
    SubmitReviewResponse,
)
from app.security.jwt import VerifiedUser
from app.services.daytime import local_today

router = APIRouter(prefix="/reviews", tags=["reviews"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    try:
        return uuid.UUID(user.user_id)
    except ValueError as exc:
        raise UnauthenticatedError("Token subject is not a valid user id") from exc


async def _get_profile_or_404(session: AsyncSession, user_id: uuid.UUID) -> Profile:
    profile = await session.scalar(select(Profile).where(Profile.user_id == user_id))
    if profile is None:
        raise NotFoundError("Profile not found")
    return profile


@router.get("/queue", response_model=ReviewQueueResponse)
async def get_queue(
    dictionary_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewQueueResponse:
    user_id = _parse_user_id(user)
    profile = await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)
    today = local_today(profile.timezone, now)

    reviews_done = await UsageRepository(session).get_reviews_done(user_id, today)
    review_cap = min(max(0, profile.daily_review_limit - reviews_done), limit)
    new_cap = min(profile.daily_new_limit, limit)

    rows = await ReviewRepository(session).queue(
        user_id, dictionary_id=dictionary_id, new_cap=new_cap, review_cap=review_cap, now=now
    )
    return ReviewQueueResponse(
        items=[
            ReviewQueueItem(
                word_id=word.id,
                word=word.word,
                definition=word.definition,
                part_of_speech=word.part_of_speech,
                example=word.example,
                state=review.state,
                due_at=review.due_at,
            )
            for word, review in rows
        ]
    )


@router.post("", response_model=SubmitReviewResponse, status_code=201)
async def submit_review(
    body: SubmitReviewRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmitReviewResponse:
    user_id = _parse_user_id(user)
    profile = await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)

    try:
        new_state, due_at = await ReviewRepository(session).apply_rating(
            body.word_id,
            user_id,
            body.rating,
            now,
            source=body.source,
            elapsed_ms=body.elapsed_ms,
        )
    except LookupError as exc:
        raise NotFoundError("Word not found") from exc

    today = local_today(profile.timezone, now)
    await UsageRepository(session).increment_reviews_done(user_id, today)

    return SubmitReviewResponse(
        word_id=body.word_id,
        state=new_state.state,
        ease_factor=new_state.ease,
        interval_days=new_state.interval,
        due_at=due_at,
    )


@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast(
    days: int = Query(default=14, ge=1, le=REVIEWS_FORECAST_MAX_DAYS),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ForecastResponse:
    user_id = _parse_user_id(user)
    await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)

    counts = await ReviewRepository(session).forecast(user_id, days=days, now=now)
    return ForecastResponse(
        days=[ForecastDay(date=d, due_count=c) for d, c in sorted(counts.items())]
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_reviews_api.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/reviews.py backend/app/api/v1/reviews.py backend/tests/integration/test_reviews_api.py
git commit -m "feat: add /api/v1/reviews queue, submit and forecast endpoints"
```

---

## Task 10: Words repository — pagination, search, filters, bulk create, move

**Files:**

- Modify: `backend/app/repositories/words.py`
- Test: `backend/tests/integration/test_words_repository.py` (extend the existing file)

**Interfaces:**

- Produces (added to the existing `WordRepository`):
  - `async def list_page(dictionary_id, *, cursor=None, limit=50, q=None, part_of_speech=None, difficulty=None, state=None, sort="created") -> tuple[list[Word], str | None, bool]` — `sort` is `"created"` (default, keyset on `created_at desc, id desc`) or `"alpha"` (keyset on `lower(word) asc, id asc`). Due-ordering deliberately isn't a sort option here — that's what `/reviews/queue` is for; duplicating it in the words list would be dead code with no caller.
  - `async def bulk_create(dictionary_id, user_id, rows: list[dict]) -> list[dict]` — each result dict is `{"word": Word | None, "error": str | None}`, one per input row, in order. A duplicate in row 3 doesn't abort rows 1-2 or 4+ (each row runs in its own `SAVEPOINT`).
  - `async def move(word_id, user_id, dictionary_id) -> Word | None`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/integration/test_words_repository.py — append to the existing file
from app.repositories.dictionaries import DictionaryRepository


async def test_list_page_first_page_created_sort(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("alpha", "beta", "gamma"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    page, next_cursor, has_more = await repo.list_page(dictionary.id, limit=2)

    assert [w.word for w in page] == ["gamma", "beta"]
    assert has_more is True
    assert next_cursor is not None


async def test_list_page_second_page_continues_from_cursor(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("alpha", "beta", "gamma"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    first_page, cursor, _ = await repo.list_page(dictionary.id, limit=2)
    second_page, _cursor2, has_more2 = await repo.list_page(dictionary.id, limit=2, cursor=cursor)

    assert [w.word for w in second_page] == ["alpha"]
    assert has_more2 is False


async def test_list_page_alpha_sort(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("zebra", "apple", "mango"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    page, _cursor, _has_more = await repo.list_page(dictionary.id, sort="alpha", limit=10)
    assert [w.word for w in page] == ["apple", "mango", "zebra"]


async def test_list_page_filters_by_search_term(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "cat", "a small animal")
    await repo.create(dictionary.id, user_id, "dog", "a loyal animal")
    await repo.create(dictionary.id, user_id, "car", "a vehicle")

    page, _c, _h = await repo.list_page(dictionary.id, q="animal", limit=10)
    assert {w.word for w in page} == {"cat", "dog"}


async def test_list_page_filters_by_part_of_speech(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "run", "to move fast", part_of_speech="verb")
    await repo.create(dictionary.id, user_id, "fast", "quick", part_of_speech="adjective")

    page, _c, _h = await repo.list_page(dictionary.id, part_of_speech="verb", limit=10)
    assert [w.word for w in page] == ["run"]


async def test_list_page_filters_by_review_state(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, user_id, "learned", "already reviewed")
    await repo.create(dictionary.id, user_id, "brandnew", "never reviewed")
    await set_review_state(db_session, word.id, state="review")

    page, _c, _h = await repo.list_page(dictionary.id, state="review", limit=10)
    assert [w.word for w in page] == ["learned"]


async def test_bulk_create_reports_per_row_result(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "existing", "already here", part_of_speech="noun")

    results = await repo.bulk_create(
        dictionary.id,
        user_id,
        [
            {"word": "new1", "definition": "d1"},
            {"word": "existing", "definition": "dup", "part_of_speech": "noun"},
            {"word": "new2", "definition": "d2"},
        ],
    )

    assert results[0]["word"] is not None and results[0]["error"] is None
    assert results[1]["word"] is None and results[1]["error"] == "DUPLICATE_WORD"
    assert results[2]["word"] is not None and results[2]["error"] is None


async def test_move_changes_dictionary(db_session):
    user_id = await create_user(db_session)
    dict_repo = DictionaryRepository(db_session)
    source = await dict_repo.create(user_id, "Source")
    target = await dict_repo.create(user_id, "Target")
    repo = WordRepository(db_session)
    word = await repo.create(source.id, user_id, "movable", "can be moved")

    moved = await repo.move(word.id, user_id, target.id)

    assert moved is not None
    assert moved.dictionary_id == target.id


async def test_move_returns_none_for_unowned_word(db_session):
    owner = await create_user(db_session, email="owner4@example.com")
    other = await create_user(db_session, email="other4@example.com")
    dictionary = await create_dictionary(db_session, owner)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, owner, "x", "y")

    other_dict = await DictionaryRepository(db_session).create(other, "Other's dict")
    assert await repo.move(word.id, other, other_dict.id) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_words_repository.py -v`
Expected: FAIL — `AttributeError: 'WordRepository' object has no attribute 'list_page'` (and similarly for `bulk_create`/`move`)

- [ ] **Step 3: Implement the new repository methods**

```python
# backend/app/repositories/words.py — replace the file's imports and add these methods
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import WORDS_LIST_DEFAULT_LIMIT, WORDS_LIST_MAX_LIMIT
from app.models import Word, WordReview
from app.pagination import decode_cursor, encode_cursor

# ... keep the existing WordRepository class and its existing methods, adding:

    async def list_page(
        self,
        dictionary_id: uuid.UUID,
        *,
        cursor: str | None = None,
        limit: int = WORDS_LIST_DEFAULT_LIMIT,
        q: str | None = None,
        part_of_speech: str | None = None,
        difficulty: int | None = None,
        state: str | None = None,
        sort: str = "created",
    ) -> tuple[list[Word], str | None, bool]:
        limit = min(limit, WORDS_LIST_MAX_LIMIT)
        stmt = select(Word).where(Word.dictionary_id == dictionary_id, Word.deleted_at.is_(None))

        if q:
            pattern = f"%{q.lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Word.word).like(pattern),
                    func.lower(Word.definition).like(pattern),
                )
            )
        if part_of_speech:
            stmt = stmt.where(Word.part_of_speech == part_of_speech)
        if difficulty is not None:
            stmt = stmt.where(Word.difficulty == difficulty)
        if state:
            stmt = stmt.join(WordReview, WordReview.word_id == Word.id).where(
                WordReview.state == state
            )

        if sort == "alpha":
            order_col, tiebreak_col = func.lower(Word.word), Word.id
            stmt = stmt.order_by(order_col.asc(), tiebreak_col.asc())
        else:
            order_col, tiebreak_col = Word.created_at, Word.id
            stmt = stmt.order_by(order_col.desc(), tiebreak_col.desc())

        if cursor is not None:
            decoded = decode_cursor(cursor)
            cursor_id = uuid.UUID(decoded.id)
            if sort == "alpha":
                stmt = stmt.where(tuple_(order_col, tiebreak_col) > tuple_(decoded.value, cursor_id))
            else:
                cursor_value = datetime.fromisoformat(decoded.value)
                stmt = stmt.where(tuple_(order_col, tiebreak_col) < tuple_(cursor_value, cursor_id))

        rows = list(await self._session.scalars(stmt.limit(limit + 1)))
        has_more = len(rows) > limit
        page = rows[:limit]

        next_cursor = None
        if has_more and page:
            last = page[-1]
            value = last.word.lower() if sort == "alpha" else last.created_at.isoformat()
            next_cursor = encode_cursor(value, str(last.id))

        return page, next_cursor, has_more

    async def bulk_create(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, rows: list[dict[str, object]]
    ) -> list[dict[str, object]]:
        results: list[dict[str, object]] = []
        for row in rows:
            try:
                async with self._session.begin_nested():
                    word = Word(dictionary_id=dictionary_id, user_id=user_id, **row)
                    self._session.add(word)
                    await self._session.flush()
                results.append({"word": word, "error": None})
            except IntegrityError:
                results.append({"word": None, "error": "DUPLICATE_WORD"})
        return results

    async def move(
        self, word_id: uuid.UUID, user_id: uuid.UUID, dictionary_id: uuid.UUID
    ) -> Word | None:
        word = await self.get(word_id, user_id)
        if word is None:
            return None
        word.dictionary_id = dictionary_id
        await self._session.flush()
        return word
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_words_repository.py -v`
Expected: PASS (all tests, existing + new). If `test_bulk_create_reports_per_row_result` fails with the whole session aborted, confirm `begin_nested()` is actually opening a `SAVEPOINT` — check the SQL log (`echo=True` on the engine, temporarily) rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/repositories/words.py backend/tests/integration/test_words_repository.py
git commit -m "feat: add words list_page pagination, bulk_create and move"
```

---

## Task 11: Words service + `/api/v1/words` and `/api/v1/dictionaries/{id}/words` router

**Files:**

- Modify: `backend/app/repositories/words.py` (add `update`, `count_for_user`)
- Create: `backend/app/services/words.py`, `backend/app/schemas/words.py`, `backend/app/api/v1/words.py`
- Test: `backend/tests/integration/test_words_repository.py` (extend), `backend/tests/integration/test_words_api.py`

**Interfaces:**

- Produces: `WordRepository.update(word_id, user_id, **fields) -> Word | None`, `WordRepository.count_for_user(user_id) -> int`. `WordService(session)` with `async def create_word(dictionary_id, user_id, **fields) -> Word` (raises `WordLimitReachedError` / `DuplicateWordError`) and `async def update_word(word_id, user_id, **fields) -> Word | None` (raises `DuplicateWordError`). `router` mounted in Task 13.
- Consumes: `DictionaryRepository.get` (Task 12 hasn't extended it yet, but `get`/`create` already exist from the current codebase) to check dictionary ownership before creating/listing words in it.

- [ ] **Step 1: Write the failing repository tests for `update`/`count_for_user`**

```python
# backend/tests/integration/test_words_repository.py — append
async def test_update_changes_fields(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, user_id, "old", "old definition")

    updated = await repo.update(word.id, user_id, word="new", definition="new definition")

    assert updated is not None
    assert updated.word == "new"
    assert updated.definition == "new definition"


async def test_update_returns_none_for_unowned_word(db_session):
    owner = await create_user(db_session, email="owner5@example.com")
    other = await create_user(db_session, email="other5@example.com")
    dictionary = await create_dictionary(db_session, owner)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, owner, "x", "y")

    assert await repo.update(word.id, other, word="z") is None


async def test_count_for_user_excludes_soft_deleted(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    kept = await repo.create(dictionary.id, user_id, "kept", "d")
    removed = await repo.create(dictionary.id, user_id, "removed", "d")
    await repo.soft_delete(removed.id, user_id)

    assert await repo.count_for_user(user_id) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_words_repository.py -v -k "update_changes or update_returns_none or count_for_user"`
Expected: FAIL — `AttributeError: 'WordRepository' object has no attribute 'update'`

- [ ] **Step 3: Add `update` and `count_for_user` to `WordRepository`**

```python
# backend/app/repositories/words.py — add to WordRepository
    async def update(self, word_id: uuid.UUID, user_id: uuid.UUID, **fields: object) -> Word | None:
        word = await self.get(word_id, user_id)
        if word is None:
            return None
        for key, value in fields.items():
            setattr(word, key, value)
        await self._session.flush()
        return word

    async def count_for_user(self, user_id: uuid.UUID) -> int:
        from sqlalchemy import func

        result = await self._session.scalar(
            select(func.count()).select_from(Word).where(
                Word.user_id == user_id, Word.deleted_at.is_(None)
            )
        )
        return result or 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_words_repository.py -v`
Expected: PASS (full file, existing + new)

- [ ] **Step 5: Write the failing service+API tests**

```python
# backend/tests/integration/test_words_api.py
from tests.factories import create_dictionary, create_user, create_word


async def test_create_word_in_dictionary(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "ubiquitous", "definition": "everywhere", "part_of_speech": "adjective"},
    )
    body = response.json()

    assert response.status_code == 201
    assert body["word"] == "ubiquitous"
    assert body["dictionary_id"] == str(dictionary.id)
    await client.aclose()


async def test_create_word_in_unowned_dictionary_is_404(db_session, api_client):
    owner = await create_user(db_session, email="ownerw1@example.com")
    other = await create_user(db_session, email="otherw1@example.com")
    dictionary = await create_dictionary(db_session, owner)

    client = api_client(other)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "x", "definition": "y"},
    )

    assert response.status_code == 404
    await client.aclose()


async def test_create_duplicate_word_returns_409(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    await create_word(db_session, dictionary.id, user_id, word="cat", part_of_speech="noun")

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "cat", "definition": "an animal", "part_of_speech": "noun"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "DUPLICATE_WORD"
    await client.aclose()


async def test_list_words_paginates(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    for i in range(3):
        await create_word(db_session, dictionary.id, user_id, word=f"w{i}")

    client = api_client(user_id)
    response = await client.get(f"/api/v1/dictionaries/{dictionary.id}/words", params={"limit": 2})
    body = response.json()

    assert response.status_code == 200
    assert len(body["items"]) == 2
    assert body["has_more"] is True
    assert body["next_cursor"] is not None
    await client.aclose()


async def test_get_word_by_id(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.get(f"/api/v1/words/{word.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(word.id)
    await client.aclose()


async def test_patch_word(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.patch(f"/api/v1/words/{word.id}", json={"definition": "updated"})

    assert response.status_code == 200
    assert response.json()["definition"] == "updated"
    await client.aclose()


async def test_delete_word_soft_deletes(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.delete(f"/api/v1/words/{word.id}")
    assert response.status_code == 204

    follow_up = await client.get(f"/api/v1/words/{word.id}")
    assert follow_up.status_code == 404
    await client.aclose()


async def test_bulk_create_words(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words:bulk",
        json={"rows": [{"word": "one", "definition": "1"}, {"word": "two", "definition": "2"}]},
    )
    body = response.json()

    assert response.status_code == 200
    assert len(body["results"]) == 2
    assert all(r["error"] is None for r in body["results"])
    await client.aclose()


async def test_bulk_create_rejects_more_than_max_rows(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    rows = [{"word": f"w{i}", "definition": "d"} for i in range(501)]
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words:bulk", json={"rows": rows}
    )

    assert response.status_code == 422
    await client.aclose()


async def test_move_word_to_another_dictionary(db_session, api_client):
    user_id = await create_user(db_session)
    source = await create_dictionary(db_session, user_id, name="Source")
    target = await create_dictionary(db_session, user_id, name="Target")
    word = await create_word(db_session, source.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/words/{word.id}:move", json={"dictionary_id": str(target.id)}
    )

    assert response.status_code == 200
    assert response.json()["dictionary_id"] == str(target.id)
    await client.aclose()
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_words_api.py -v`
Expected: FAIL — 404 for every request, no `words` router mounted

- [ ] **Step 7: Write the service**

```python
# backend/app/services/words.py
"""Word cap enforcement -- replaces the old `enforce_words_limit` trigger,
which ran count(*) per inserted row (O(n) per row on bulk import). See
docs/architecture/v2-plan.md §E."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import MAX_WORDS_PER_USER
from app.errors import DuplicateWordError, WordLimitReachedError
from app.models import Word
from app.repositories.words import WordRepository


class WordService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = WordRepository(session)

    async def create_word(self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object) -> Word:
        count = await self._repo.count_for_user(user_id)
        if count >= MAX_WORDS_PER_USER:
            raise WordLimitReachedError(f"This account is limited to {MAX_WORDS_PER_USER} words.")
        try:
            return await self._repo.create(dictionary_id, user_id, **fields)  # type: ignore[arg-type]
        except IntegrityError as exc:
            raise DuplicateWordError("This word already exists in this dictionary.") from exc

    async def update_word(self, word_id: uuid.UUID, user_id: uuid.UUID, **fields: object) -> Word | None:
        try:
            return await self._repo.update(word_id, user_id, **fields)
        except IntegrityError as exc:
            raise DuplicateWordError("This word already exists in this dictionary.") from exc
```

- [ ] **Step 8: Write the schemas**

```python
# backend/app/schemas/words.py
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import (
    DEFINITION_MAX_LENGTH,
    EXAMPLE_MAX_LENGTH,
    NOTES_MAX_LENGTH,
    TRANSLATION_MAX_LENGTH,
    WORD_MAX_LENGTH,
    WORDS_BULK_MAX_ROWS,
)

_PARTS_OF_SPEECH = (
    "noun", "verb", "adjective", "adverb", "pronoun",
    "preposition", "conjunction", "interjection", "phrase",
)


class WordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=WORD_MAX_LENGTH)
    definition: str = Field(min_length=1, max_length=DEFINITION_MAX_LENGTH)
    part_of_speech: str | None = Field(default=None)
    example: str | None = Field(default=None, max_length=EXAMPLE_MAX_LENGTH)
    translation: str | None = Field(default=None, max_length=TRANSLATION_MAX_LENGTH)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class WordUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str | None = Field(default=None, min_length=1, max_length=WORD_MAX_LENGTH)
    definition: str | None = Field(default=None, min_length=1, max_length=DEFINITION_MAX_LENGTH)
    part_of_speech: str | None = None
    example: str | None = Field(default=None, max_length=EXAMPLE_MAX_LENGTH)
    translation: str | None = Field(default=None, max_length=TRANSLATION_MAX_LENGTH)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class WordOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    dictionary_id: uuid.UUID
    word: str
    definition: str
    part_of_speech: str | None
    example: str | None
    translation: str | None
    notes: str | None
    difficulty: int | None
    created_at: datetime
    updated_at: datetime


class WordListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[WordOut]
    next_cursor: str | None
    has_more: bool


class BulkCreateWordsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[WordCreate] = Field(min_length=1, max_length=WORDS_BULK_MAX_ROWS)


class BulkCreateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: WordOut | None
    error: str | None


class BulkCreateWordsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[BulkCreateResult]


class MoveWordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dictionary_id: uuid.UUID
```

- [ ] **Step 9: Write the router**

```python
# backend/app/api/v1/words.py
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_session
from app.errors import NotFoundError
from app.repositories.dictionaries import DictionaryRepository
from app.repositories.words import WordRepository
from app.schemas.words import (
    BulkCreateResult,
    BulkCreateWordsRequest,
    BulkCreateWordsResponse,
    MoveWordRequest,
    WordCreate,
    WordListResponse,
    WordOut,
    WordUpdate,
)
from app.security.jwt import VerifiedUser
from app.services.words import WordService

router = APIRouter(tags=["words"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    return uuid.UUID(user.user_id)


async def _dictionary_or_404(session: AsyncSession, dictionary_id: uuid.UUID, user_id: uuid.UUID):
    dictionary = await DictionaryRepository(session).get(dictionary_id, user_id)
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return dictionary


@router.get("/dictionaries/{dictionary_id}/words", response_model=WordListResponse)
async def list_words(
    dictionary_id: uuid.UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    q: str | None = None,
    pos: str | None = None,
    difficulty: int | None = Query(default=None, ge=1, le=5),
    state: str | None = None,
    sort: str = Query(default="created", pattern="^(created|alpha)$"),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordListResponse:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    items, next_cursor, has_more = await WordRepository(session).list_page(
        dictionary_id,
        cursor=cursor,
        limit=limit,
        q=q,
        part_of_speech=pos,
        difficulty=difficulty,
        state=state,
        sort=sort,
    )
    return WordListResponse(
        items=[WordOut.model_validate(w, from_attributes=True) for w in items],
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.post(
    "/dictionaries/{dictionary_id}/words", response_model=WordOut, status_code=status.HTTP_201_CREATED
)
async def create_word(
    dictionary_id: uuid.UUID,
    body: WordCreate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    word = await WordService(session).create_word(dictionary_id, user_id, **body.model_dump())
    return WordOut.model_validate(word, from_attributes=True)


@router.post(
    "/dictionaries/{dictionary_id}/words:bulk",
    response_model=BulkCreateWordsResponse,
)
async def bulk_create_words(
    dictionary_id: uuid.UUID,
    body: BulkCreateWordsRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BulkCreateWordsResponse:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    rows = [row.model_dump() for row in body.rows]
    results = await WordRepository(session).bulk_create(dictionary_id, user_id, rows)
    return BulkCreateWordsResponse(
        results=[
            BulkCreateResult(
                word=WordOut.model_validate(r["word"], from_attributes=True) if r["word"] else None,
                error=r["error"],  # type: ignore[arg-type]
            )
            for r in results
        ]
    )


@router.get("/words/{word_id}", response_model=WordOut)
async def get_word(
    word_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    word = await WordRepository(session).get(word_id, user_id)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)


@router.patch("/words/{word_id}", response_model=WordOut)
async def update_word(
    word_id: uuid.UUID,
    body: WordUpdate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    word = await WordService(session).update_word(word_id, user_id, **fields)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)


@router.delete("/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word(
    word_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    user_id = _parse_user_id(user)
    deleted = await WordRepository(session).soft_delete(word_id, user_id)
    if not deleted:
        raise NotFoundError("Word not found")


@router.post("/words/{word_id}:move", response_model=WordOut)
async def move_word(
    word_id: uuid.UUID,
    body: MoveWordRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, body.dictionary_id, user_id)

    word = await WordRepository(session).move(word_id, user_id, body.dictionary_id)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_words_api.py -v`
Expected: PASS (10 tests). If `test_bulk_create_rejects_more_than_max_rows` fails with a 500 instead of 422, confirm FastAPI is validating the request body against `WordCreate` for every row before the handler runs — it should reject at the Pydantic layer, never reaching `WordService`.

- [ ] **Step 11: Commit**

```bash
git add backend/app/repositories/words.py backend/app/services/words.py backend/app/schemas/words.py backend/app/api/v1/words.py backend/tests/integration/test_words_repository.py backend/tests/integration/test_words_api.py
git commit -m "feat: add words service and /api/v1/words + dictionary-scoped words endpoints"
```

---

## Task 12: Dictionaries service + `/api/v1/dictionaries` router

**Files:**

- Modify: `backend/app/repositories/dictionaries.py`
- Create: `backend/app/services/dictionaries.py`, `backend/app/schemas/dictionaries.py`, `backend/app/api/v1/dictionaries.py`
- Test: `backend/tests/integration/test_dictionaries_repository.py` (extend), `backend/tests/integration/test_dictionaries_api.py`

**Interfaces:**

- Produces: `DictionaryRepository.update(dictionary_id, user_id, **fields) -> Dictionary | None`, `.set_default(dictionary_id, user_id) -> Dictionary | None` (unsets any existing default first, in the same transaction), `.counts_for(dictionary_id) -> tuple[int, int]` (word_count, due_count). `DictionaryRepository.create` gains an `is_default: bool = False` keyword. `DictionaryService(session)` with `create_dictionary`/`update_dictionary`, translating the existing `unique(user_id, lower(name))` constraint into `ValidationFailedError` with a `DUPLICATE_NAME` field error (there's no dedicated top-level error code for this in v2-plan.md §F's list, so it uses the existing `errors` array mechanism the RFC 9457 format already supports).

- [ ] **Step 1: Write the failing repository tests**

```python
# backend/tests/integration/test_dictionaries_repository.py — append to the existing file
async def test_update_changes_name(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    dictionary = await repo.create(user_id, "Old Name")

    updated = await repo.update(dictionary.id, user_id, name="New Name")
    assert updated is not None
    assert updated.name == "New Name"


async def test_set_default_unsets_previous_default(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    first = await repo.create(user_id, "First", is_default=True)
    second = await repo.create(user_id, "Second")

    result = await repo.set_default(second.id, user_id)

    assert result is not None
    assert result.is_default is True
    refreshed_first = await repo.get(first.id, user_id)
    assert refreshed_first is not None
    assert refreshed_first.is_default is False


async def test_counts_for_reports_word_and_due_counts(db_session):
    from datetime import UTC, datetime, timedelta

    from tests.factories import create_word, set_review_state

    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    dictionary = await repo.create(user_id, "Counted")

    due = await create_word(db_session, dictionary.id, user_id, word="due")
    await set_review_state(db_session, due.id, due_at=datetime.now(UTC) - timedelta(hours=1))
    await create_word(db_session, dictionary.id, user_id, word="notdue")

    word_count, due_count = await repo.counts_for(dictionary.id)
    assert word_count == 2
    assert due_count == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_dictionaries_repository.py -v -k "update_changes_name or set_default or counts_for"`
Expected: FAIL — `AttributeError: 'DictionaryRepository' object has no attribute 'update'`

- [ ] **Step 3: Extend `DictionaryRepository`**

```python
# backend/app/repositories/dictionaries.py — replace the file
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Dictionary, Word, WordReview


class DictionaryRepository:
    """The only place dictionaries SQL is written -- every query filters out
    soft-deleted rows and scopes to the owning user -- see
    docs/architecture/v2-plan.md §H."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        user_id: uuid.UUID,
        name: str,
        *,
        language_code: str | None = None,
        description: str | None = None,
        is_default: bool = False,
    ) -> Dictionary:
        dictionary = Dictionary(
            user_id=user_id,
            name=name,
            language_code=language_code,
            description=description,
            is_default=is_default,
        )
        self._session.add(dictionary)
        await self._session.flush()
        return dictionary

    async def get(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> Dictionary | None:
        result: Dictionary | None = await self._session.scalar(
            select(Dictionary).where(
                Dictionary.id == dictionary_id,
                Dictionary.user_id == user_id,
                Dictionary.deleted_at.is_(None),
            )
        )
        return result

    async def list_for_user(self, user_id: uuid.UUID) -> list[Dictionary]:
        result = await self._session.scalars(
            select(Dictionary)
            .where(Dictionary.user_id == user_id, Dictionary.deleted_at.is_(None))
            .order_by(Dictionary.created_at)
        )
        return list(result)

    async def soft_delete(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        dictionary = await self.get(dictionary_id, user_id)
        if dictionary is None:
            return False
        dictionary.deleted_at = datetime.now(UTC)
        await self._session.flush()
        return True

    async def update(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Dictionary | None:
        dictionary = await self.get(dictionary_id, user_id)
        if dictionary is None:
            return None
        for key, value in fields.items():
            setattr(dictionary, key, value)
        await self._session.flush()
        return dictionary

    async def set_default(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> Dictionary | None:
        target = await self.get(dictionary_id, user_id)
        if target is None:
            return None

        current_default = await self._session.scalar(
            select(Dictionary).where(
                Dictionary.user_id == user_id,
                Dictionary.is_default.is_(True),
                Dictionary.deleted_at.is_(None),
            )
        )
        if current_default is not None and current_default.id != target.id:
            current_default.is_default = False
            await self._session.flush()

        target.is_default = True
        await self._session.flush()
        return target

    async def counts_for(self, dictionary_id: uuid.UUID) -> tuple[int, int]:
        word_count = await self._session.scalar(
            select(func.count())
            .select_from(Word)
            .where(Word.dictionary_id == dictionary_id, Word.deleted_at.is_(None))
        )
        due_count = await self._session.scalar(
            select(func.count())
            .select_from(Word)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                Word.dictionary_id == dictionary_id,
                Word.deleted_at.is_(None),
                WordReview.state != "new",
                WordReview.due_at <= func.now(),
            )
        )
        return word_count or 0, due_count or 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_dictionaries_repository.py -v`
Expected: PASS (full file, existing + new)

- [ ] **Step 5: Write the failing service+API tests**

```python
# backend/tests/integration/test_dictionaries_api.py
from tests.factories import create_dictionary, create_user


async def test_create_first_dictionary_is_default(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)

    response = await client.post("/api/v1/dictionaries", json={"name": "My Words"})
    body = response.json()

    assert response.status_code == 201
    assert body["is_default"] is True
    await client.aclose()


async def test_create_second_dictionary_is_not_default(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)
    await client.post("/api/v1/dictionaries", json={"name": "First"})

    response = await client.post("/api/v1/dictionaries", json={"name": "Second"})
    assert response.json()["is_default"] is False
    await client.aclose()


async def test_create_duplicate_name_returns_validation_error(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)
    await client.post("/api/v1/dictionaries", json={"name": "IELTS"})

    response = await client.post("/api/v1/dictionaries", json={"name": "ielts"})

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"
    assert response.json()["errors"][0]["field"] == "name"
    await client.aclose()


async def test_list_dictionaries_includes_counts(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id, name="Has Words")
    from tests.factories import create_word

    await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.get("/api/v1/dictionaries")
    items = response.json()["items"]

    assert response.status_code == 200
    match = next(i for i in items if i["id"] == str(dictionary.id))
    assert match["word_count"] == 1
    assert match["due_count"] == 0
    await client.aclose()


async def test_patch_dictionary_sets_new_default(db_session, api_client):
    user_id = await create_user(db_session)
    first = await create_dictionary(db_session, user_id, name="First", is_default=True)
    second = await create_dictionary(db_session, user_id, name="Second")

    client = api_client(user_id)
    response = await client.patch(f"/api/v1/dictionaries/{second.id}", json={"is_default": True})

    assert response.status_code == 200
    assert response.json()["is_default"] is True
    await client.aclose()


async def test_delete_dictionary_soft_deletes(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.delete(f"/api/v1/dictionaries/{dictionary.id}")
    assert response.status_code == 204

    follow_up = await client.get(f"/api/v1/dictionaries/{dictionary.id}")
    assert follow_up.status_code == 404
    await client.aclose()


async def test_get_unowned_dictionary_is_404(db_session, api_client):
    owner = await create_user(db_session, email="ownerd1@example.com")
    other = await create_user(db_session, email="otherd1@example.com")
    dictionary = await create_dictionary(db_session, owner)

    client = api_client(other)
    response = await client.get(f"/api/v1/dictionaries/{dictionary.id}")
    assert response.status_code == 404
    await client.aclose()
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_dictionaries_api.py -v`
Expected: FAIL — 404 for every request, no `dictionaries` router mounted

- [ ] **Step 7: Write the service**

```python
# backend/app/services/dictionaries.py
"""Enforces the single-default invariant on create (first dictionary for a
user is always the default) and translates the name-uniqueness constraint
into a field-level validation error. See docs/architecture/v2-plan.md §E."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ValidationFailedError
from app.models import Dictionary
from app.repositories.dictionaries import DictionaryRepository


class DictionaryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = DictionaryRepository(session)

    async def create_dictionary(self, user_id: uuid.UUID, name: str, **fields: object) -> Dictionary:
        existing = await self._repo.list_for_user(user_id)
        try:
            return await self._repo.create(
                user_id, name, is_default=(len(existing) == 0), **fields  # type: ignore[arg-type]
            )
        except IntegrityError as exc:
            raise ValidationFailedError(
                "A dictionary with this name already exists.",
                errors=[{"field": "name", "code": "DUPLICATE_NAME"}],
            ) from exc

    async def update_dictionary(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Dictionary | None:
        make_default = fields.pop("is_default", None)
        dictionary: Dictionary | None = None

        if make_default:
            dictionary = await self._repo.set_default(dictionary_id, user_id)
            if dictionary is None:
                return None

        remaining = {k: v for k, v in fields.items() if v is not None}
        if remaining:
            try:
                dictionary = await self._repo.update(dictionary_id, user_id, **remaining)
            except IntegrityError as exc:
                raise ValidationFailedError(
                    "A dictionary with this name already exists.",
                    errors=[{"field": "name", "code": "DUPLICATE_NAME"}],
                ) from exc

        return dictionary if dictionary is not None else await self._repo.get(dictionary_id, user_id)
```

- [ ] **Step 8: Write the schemas**

```python
# backend/app/schemas/dictionaries.py
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import DICTIONARY_NAME_MAX_LENGTH


class DictionaryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=DICTIONARY_NAME_MAX_LENGTH)
    language_code: str | None = None
    description: str | None = None


class DictionaryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=DICTIONARY_NAME_MAX_LENGTH)
    language_code: str | None = None
    description: str | None = None
    is_default: bool | None = None


class DictionaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    language_code: str | None
    description: str | None
    is_default: bool
    word_count: int
    due_count: int
    created_at: datetime
    updated_at: datetime


class DictionaryListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DictionaryOut]
```

- [ ] **Step 9: Write the router**

```python
# backend/app/api/v1/dictionaries.py
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_session
from app.errors import NotFoundError
from app.repositories.dictionaries import DictionaryRepository
from app.schemas.dictionaries import (
    DictionaryCreate,
    DictionaryListResponse,
    DictionaryOut,
    DictionaryUpdate,
)
from app.security.jwt import VerifiedUser
from app.services.dictionaries import DictionaryService

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    return uuid.UUID(user.user_id)


async def _to_out(repo: DictionaryRepository, dictionary) -> DictionaryOut:
    word_count, due_count = await repo.counts_for(dictionary.id)
    return DictionaryOut(
        id=dictionary.id,
        name=dictionary.name,
        language_code=dictionary.language_code,
        description=dictionary.description,
        is_default=dictionary.is_default,
        word_count=word_count,
        due_count=due_count,
        created_at=dictionary.created_at,
        updated_at=dictionary.updated_at,
    )


@router.get("", response_model=DictionaryListResponse)
async def list_dictionaries(
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryListResponse:
    user_id = _parse_user_id(user)
    repo = DictionaryRepository(session)
    dictionaries = await repo.list_for_user(user_id)
    return DictionaryListResponse(items=[await _to_out(repo, d) for d in dictionaries])


@router.post("", response_model=DictionaryOut, status_code=status.HTTP_201_CREATED)
async def create_dictionary(
    body: DictionaryCreate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    dictionary = await DictionaryService(session).create_dictionary(user_id, **body.model_dump())
    return await _to_out(DictionaryRepository(session), dictionary)


@router.get("/{dictionary_id}", response_model=DictionaryOut)
async def get_dictionary(
    dictionary_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    repo = DictionaryRepository(session)
    dictionary = await repo.get(dictionary_id, user_id)
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return await _to_out(repo, dictionary)


@router.patch("/{dictionary_id}", response_model=DictionaryOut)
async def update_dictionary(
    dictionary_id: uuid.UUID,
    body: DictionaryUpdate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    dictionary = await DictionaryService(session).update_dictionary(
        dictionary_id, user_id, **body.model_dump(exclude_unset=True)
    )
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return await _to_out(DictionaryRepository(session), dictionary)


@router.delete("/{dictionary_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dictionary(
    dictionary_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    user_id = _parse_user_id(user)
    deleted = await DictionaryRepository(session).soft_delete(dictionary_id, user_id)
    if not deleted:
        raise NotFoundError("Dictionary not found")
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd backend && pytest tests/integration/test_dictionaries_api.py -v`
Expected: PASS (7 tests)

- [ ] **Step 11: Commit**

```bash
git add backend/app/repositories/dictionaries.py backend/app/services/dictionaries.py backend/app/schemas/dictionaries.py backend/app/api/v1/dictionaries.py backend/tests/integration/test_dictionaries_repository.py backend/tests/integration/test_dictionaries_api.py
git commit -m "feat: add dictionaries service and /api/v1/dictionaries endpoints"
```

---

## Task 13: Wire the new routers into `/api/v1`

**Files:**

- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/integration/test_router_wiring.py`

**Interfaces:**

- Produces: `/api/v1/dictionaries*`, `/api/v1/dictionaries/*/words*`, `/api/v1/words*`, `/api/v1/reviews*` all reachable through the same `router` that `app/main.py` already mounts — no change to `main.py` needed.

- [ ] **Step 1: Write the failing smoke test**

```python
# backend/tests/integration/test_router_wiring.py
from tests.factories import create_user


async def test_full_flow_across_all_new_routers(db_session, api_client):
    user_id = await create_user(db_session)
    import sqlalchemy as sa

    await db_session.execute(
        sa.text("insert into public.profiles (user_id) values (:id)"), {"id": user_id}
    )
    await db_session.flush()

    client = api_client(user_id)

    dict_response = await client.post("/api/v1/dictionaries", json={"name": "Smoke Test"})
    assert dict_response.status_code == 201
    dictionary_id = dict_response.json()["id"]

    word_response = await client.post(
        f"/api/v1/dictionaries/{dictionary_id}/words",
        json={"word": "smoke", "definition": "a test word"},
    )
    assert word_response.status_code == 201
    word_id = word_response.json()["id"]

    queue_response = await client.get("/api/v1/reviews/queue")
    assert queue_response.status_code == 200
    assert any(item["word_id"] == word_id for item in queue_response.json()["items"])

    review_response = await client.post(
        "/api/v1/reviews", json={"word_id": word_id, "rating": 3, "source": "flashcard"}
    )
    assert review_response.status_code == 201

    forecast_response = await client.get("/api/v1/reviews/forecast")
    assert forecast_response.status_code == 200

    await client.aclose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_router_wiring.py -v`
Expected: FAIL — 404 on `POST /api/v1/dictionaries`

- [ ] **Step 3: Wire the routers**

```python
# backend/app/api/v1/router.py
from fastapi import APIRouter

from app.api.v1 import dictionaries, me, reviews, words

router = APIRouter(prefix="/api/v1")
router.include_router(me.router)
router.include_router(dictionaries.router)
router.include_router(words.router)
router.include_router(reviews.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_router_wiring.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && pytest -v`
Expected: PASS (every test from Tasks 1-13)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/router.py backend/tests/integration/test_router_wiring.py
git commit -m "feat: mount dictionaries, words and reviews routers"
```

---

## Task 14: Frontend API client (`src/api/client.ts` + `src/api/errors.ts`)

**Files:**

- Create: `src/api/client.ts`, `src/api/errors.ts`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/bg.ts`
- Test: `src/api/client.test.ts`, `src/api/errors.test.ts`

**Interfaces:**

- Produces: `class AppError extends Error { code: string; status: number; detail: string; errors?: {field: string; code: string}[] }`; `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — attaches `Authorization: Bearer <token>` from the current Supabase session, a random `X-Request-ID`, a 10s timeout, and throws `AppError` for both HTTP error responses and network/timeout failures. `errorMessageKey(error: AppError): TranslationKey` maps `error.code` to a translation key, defaulting to `'err-generic'`.
- Consumes: `supabase.auth.getSession()` from `src/lib/supabase/client.ts` (kept per the design spec — Supabase remains the auth SDK).

- [ ] **Step 1: Write the failing client tests**

```typescript
// src/api/client.test.ts
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppError, apiFetch } from './client'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('apiFetch', () => {
  it('attaches the bearer token and returns the parsed body', async () => {
    let seenAuth: string | null = null
    server.use(
      http.get(`${BASE_URL}/api/v1/me`, ({ request }) => {
        seenAuth = request.headers.get('authorization')
        return HttpResponse.json({ user_id: '1', email: 'a@b.com' })
      }),
    )

    const result = await apiFetch<{ user_id: string }>('/api/v1/me')

    expect(seenAuth).toBe('Bearer test-token')
    expect(result.user_id).toBe('1')
  })

  it('attaches a unique X-Request-ID header per call', async () => {
    const seen: string[] = []
    server.use(
      http.get(`${BASE_URL}/api/v1/me`, ({ request }) => {
        seen.push(request.headers.get('x-request-id') ?? '')
        return HttpResponse.json({})
      }),
    )

    await apiFetch('/api/v1/me')
    await apiFetch('/api/v1/me')

    expect(seen[0]).not.toBe('')
    expect(seen[0]).not.toBe(seen[1])
  })

  it('throws AppError with the problem+json fields on a non-2xx response', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/words/123`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', status: 404, detail: 'Word not found' },
          { status: 404 },
        ),
      ),
    )

    await expect(apiFetch('/api/v1/words/123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      detail: 'Word not found',
    })
  })

  it('returns undefined for a 204 response', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(apiFetch('/api/v1/words/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('wraps a network failure in an AppError', async () => {
    server.use(http.get(`${BASE_URL}/api/v1/me`, () => HttpResponse.error()))
    await expect(apiFetch('/api/v1/me')).rejects.toBeInstanceOf(AppError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 3: Implement `client.ts`**

```typescript
// src/api/client.ts
import { supabase } from '@/lib/supabase/client'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail: string,
    public readonly errors?: { field: string; code: string }[],
  ) {
    super(detail)
    this.name = 'AppError'
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const REQUEST_TIMEOUT_MS = 10_000

interface ProblemBody {
  code?: string
  detail?: string
  errors?: { field: string; code: string }[]
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in')
  return { Authorization: `Bearer ${token}` }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      ...(await authHeaders()),
      ...(init.headers as Record<string, string> | undefined),
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })

    if (response.status === 204) return undefined as T

    const body = (await response.json().catch(() => null)) as ProblemBody | null

    if (!response.ok) {
      throw new AppError(
        body?.code ?? 'INTERNAL',
        response.status,
        body?.detail ?? 'Request failed',
        body?.errors,
      )
    }

    return body as T
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AppError('TIMEOUT', 408, 'The request took too long')
    }
    throw new AppError('NETWORK_ERROR', 0, 'Could not reach the server')
  } finally {
    clearTimeout(timeoutId)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/client.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing errors test**

```typescript
// src/api/errors.test.ts
import { describe, expect, it } from 'vitest'
import { AppError } from './client'
import { errorMessageKey } from './errors'

describe('errorMessageKey', () => {
  it('maps known codes to their translation key', () => {
    expect(errorMessageKey(new AppError('NOT_FOUND', 404, 'x'))).toBe('err-not-found')
    expect(errorMessageKey(new AppError('DUPLICATE_WORD', 409, 'x'))).toBe('err-duplicate-word')
    expect(errorMessageKey(new AppError('WORD_LIMIT_REACHED', 409, 'x'))).toBe(
      'err-word-limit-reached',
    )
  })

  it('falls back to a generic key for an unknown code', () => {
    expect(errorMessageKey(new AppError('SOMETHING_NEW', 500, 'x'))).toBe('err-generic')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- src/api/errors.test.ts`
Expected: FAIL — `Cannot find module './errors'`

- [ ] **Step 7: Implement `errors.ts` and add the translation keys**

```typescript
// src/api/errors.ts
import type { AppError } from './client'
import type { TranslationKey } from '@/i18n'

const CODE_TO_KEY: Partial<Record<string, TranslationKey>> = {
  UNAUTHENTICATED: 'err-unauthenticated',
  NOT_FOUND: 'err-not-found',
  VALIDATION_FAILED: 'err-validation-failed',
  DUPLICATE_WORD: 'err-duplicate-word',
  WORD_LIMIT_REACHED: 'err-word-limit-reached',
  RATE_LIMITED: 'err-rate-limited',
  TIMEOUT: 'err-timeout',
  NETWORK_ERROR: 'err-network',
}

export function errorMessageKey(error: AppError): TranslationKey {
  return CODE_TO_KEY[error.code] ?? 'err-generic'
}
```

```typescript
// src/i18n/locales/en.ts — add near the other 'err-*' keys
  'err-unauthenticated': 'Please sign in again.',
  'err-not-found': "That item doesn't exist or was removed.",
  'err-validation-failed': 'Please check the highlighted fields.',
  'err-duplicate-word': 'This word already exists in this dictionary.',
  'err-word-limit-reached': "You've reached the word limit for this account.",
  'err-rate-limited': 'Too many requests — try again in a moment.',
  'err-timeout': 'The request took too long. Try again.',
  'err-network': 'Could not reach the server. Check your connection.',
  'err-generic': 'Something went wrong. Try again.',
```

```typescript
// src/i18n/locales/bg.ts — add near the other 'err-*' keys
  'err-unauthenticated': 'Моля, влез отново.',
  'err-not-found': 'Този елемент не съществува или е премахнат.',
  'err-validation-failed': 'Провери маркираните полета.',
  'err-duplicate-word': 'Тази дума вече съществува в този речник.',
  'err-word-limit-reached': 'Достигнат е лимитът от думи за този акаунт.',
  'err-rate-limited': 'Твърде много заявки — опитай отново след малко.',
  'err-timeout': 'Заявката отне твърде дълго. Опитай отново.',
  'err-network': 'Няма връзка със сървъра. Провери интернет връзката си.',
  'err-generic': 'Нещо се обърка. Опитай отново.',
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- src/api/errors.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/api/client.ts src/api/errors.ts src/api/client.test.ts src/api/errors.test.ts src/i18n/locales/en.ts src/i18n/locales/bg.ts
git commit -m "feat: add typed API client with problem+json error mapping"
```

---

## Task 15: Typed API modules — `dictionaries.ts`, `words.ts`, `reviews.ts`

**Files:**

- Create: `src/api/dictionaries.ts`, `src/api/words.ts`, `src/api/reviews.ts`
- Test: `src/api/dictionaries.test.ts`, `src/api/words.test.ts`, `src/api/reviews.test.ts`

**Interfaces:**

- Consumes: `apiFetch` from Task 14.
- Produces: `DictionaryDto`, `listDictionaries/createDictionary/updateDictionary/deleteDictionary`; `WordDto`, `NewWordDto`, `WordListResponse`, `listWords/createWord/bulkCreateWords/getWord/updateWord/deleteWord/moveWord`; `ReviewQueueItemDto`, `SubmitReviewResponseDto`, `getReviewQueue/submitReview/getReviewForecast`. These are hand-written to match the Pydantic schemas from Tasks 9/11/12 exactly (no `openapi-typescript` codegen pipeline — that's CI infrastructure with no bearing on this feature, deliberately out of scope here).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/api/dictionaries.test.ts
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createDictionary,
  deleteDictionary,
  listDictionaries,
  updateDictionary,
} from './dictionaries'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('dictionaries api', () => {
  it('listDictionaries returns items', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({ items: [{ id: '1', name: 'A' }] }),
      ),
    )
    const result = await listDictionaries()
    expect(result.items).toHaveLength(1)
  })

  it('createDictionary posts the name', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: '1', name: 'New' }, { status: 201 })
      }),
    )
    await createDictionary({ name: 'New' })
    expect(body).toEqual({ name: 'New' })
  })

  it('updateDictionary PATCHes only the given fields', async () => {
    let method = ''
    server.use(
      http.patch(`${BASE_URL}/api/v1/dictionaries/1`, ({ request }) => {
        method = request.method
        return HttpResponse.json({ id: '1', name: 'Renamed' })
      }),
    )
    await updateDictionary('1', { name: 'Renamed' })
    expect(method).toBe('PATCH')
  })

  it('deleteDictionary DELETEs the resource', async () => {
    server.use(
      http.delete(
        `${BASE_URL}/api/v1/dictionaries/1`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    await expect(deleteDictionary('1')).resolves.toBeUndefined()
  })
})
```

```typescript
// src/api/words.test.ts
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bulkCreateWords, createWord, deleteWord, listWords, moveWord } from './words'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('words api', () => {
  it('listWords builds the query string from the given params', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ items: [], next_cursor: null, has_more: false })
      }),
    )
    await listWords('d1', { limit: 10, q: 'cat', sort: 'alpha' })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('limit')).toBe('10')
    expect(parsed.searchParams.get('q')).toBe('cat')
    expect(parsed.searchParams.get('sort')).toBe('alpha')
  })

  it('createWord posts to the dictionary-scoped endpoint', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({ id: 'w1', word: 'cat' }, { status: 201 }),
      ),
    )
    const word = await createWord('d1', { word: 'cat', definition: 'an animal' })
    expect(word.id).toBe('w1')
  })

  it('bulkCreateWords posts the rows array', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words:bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ results: [] })
      }),
    )
    await bulkCreateWords('d1', [{ word: 'a', definition: 'b' }])
    expect(body).toEqual({ rows: [{ word: 'a', definition: 'b' }] })
  })

  it('deleteWord DELETEs by id', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/w1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(deleteWord('w1')).resolves.toBeUndefined()
  })

  it('moveWord posts the target dictionary_id', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/words/w1:move`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'w1', dictionary_id: 'd2' })
      }),
    )
    await moveWord('w1', 'd2')
    expect(body).toEqual({ dictionary_id: 'd2' })
  })
})
```

```typescript
// src/api/reviews.test.ts
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getReviewForecast, getReviewQueue, submitReview } from './reviews'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('reviews api', () => {
  it('getReviewQueue includes dictionary_id when given', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ items: [] })
      }),
    )
    await getReviewQueue({ dictionaryId: 'd1' })
    expect(new URL(url).searchParams.get('dictionary_id')).toBe('d1')
  })

  it('submitReview sends rating and source=flashcard', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/reviews`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            word_id: 'w1',
            state: 'learning',
            ease_factor: '2.50',
            interval_days: 0,
            due_at: '2026-09-16T00:00:00Z',
          },
          { status: 201 },
        )
      }),
    )
    await submitReview({ wordId: 'w1', rating: 3, elapsedMs: 1200 })
    expect(body).toEqual({ word_id: 'w1', rating: 3, elapsed_ms: 1200, source: 'flashcard' })
  })

  it('getReviewForecast requests the given number of days', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/forecast`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ days: [] })
      }),
    )
    await getReviewForecast(7)
    expect(new URL(url).searchParams.get('days')).toBe('7')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/dictionaries.test.ts src/api/words.test.ts src/api/reviews.test.ts`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Implement `dictionaries.ts`**

```typescript
// src/api/dictionaries.ts
import { apiFetch } from './client'

export interface DictionaryDto {
  id: string
  name: string
  language_code: string | null
  description: string | null
  is_default: boolean
  word_count: number
  due_count: number
  created_at: string
  updated_at: string
}

export interface NewDictionaryDto {
  name: string
  language_code?: string | null
  description?: string | null
}

export function listDictionaries(): Promise<{ items: DictionaryDto[] }> {
  return apiFetch('/api/v1/dictionaries')
}

export function createDictionary(input: NewDictionaryDto): Promise<DictionaryDto> {
  return apiFetch('/api/v1/dictionaries', { method: 'POST', body: JSON.stringify(input) })
}

export function updateDictionary(
  id: string,
  patch: Partial<NewDictionaryDto & { is_default: boolean }>,
): Promise<DictionaryDto> {
  return apiFetch(`/api/v1/dictionaries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteDictionary(id: string): Promise<void> {
  return apiFetch(`/api/v1/dictionaries/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 4: Implement `words.ts`**

```typescript
// src/api/words.ts
import { apiFetch } from './client'

export interface WordDto {
  id: string
  dictionary_id: string
  word: string
  definition: string
  part_of_speech: string | null
  example: string | null
  translation: string | null
  notes: string | null
  difficulty: number | null
  created_at: string
  updated_at: string
}

export interface NewWordDto {
  word: string
  definition: string
  part_of_speech?: string | null
  example?: string | null
  translation?: string | null
  notes?: string | null
  difficulty?: number | null
}

export interface WordListResponse {
  items: WordDto[]
  next_cursor: string | null
  has_more: boolean
}

export interface ListWordsParams {
  cursor?: string
  limit?: number
  q?: string
  pos?: string
  state?: string
  sort?: 'created' | 'alpha'
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

export function listWords(
  dictionaryId: string,
  params: ListWordsParams = {},
): Promise<WordListResponse> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words${toQueryString(params)}`)
}

export function createWord(dictionaryId: string, input: NewWordDto): Promise<WordDto> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function bulkCreateWords(
  dictionaryId: string,
  rows: NewWordDto[],
): Promise<{ results: { word: WordDto | null; error: string | null }[] }> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words:bulk`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })
}

export function getWord(id: string): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}`)
}

export function updateWord(id: string, patch: Partial<NewWordDto>): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteWord(id: string): Promise<void> {
  return apiFetch(`/api/v1/words/${id}`, { method: 'DELETE' })
}

export function moveWord(id: string, dictionaryId: string): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}:move`, {
    method: 'POST',
    body: JSON.stringify({ dictionary_id: dictionaryId }),
  })
}
```

- [ ] **Step 5: Implement `reviews.ts`**

```typescript
// src/api/reviews.ts
import { apiFetch } from './client'

export interface ReviewQueueItemDto {
  word_id: string
  word: string
  definition: string
  part_of_speech: string | null
  example: string | null
  state: string
  due_at: string | null
}

export interface SubmitReviewResponseDto {
  word_id: string
  state: string
  ease_factor: string
  interval_days: number
  due_at: string
}

export interface ForecastDayDto {
  date: string
  due_count: number
}

export function getReviewQueue(
  params: { dictionaryId?: string; limit?: number } = {},
): Promise<{ items: ReviewQueueItemDto[] }> {
  const query = new URLSearchParams()
  if (params.dictionaryId) query.set('dictionary_id', params.dictionaryId)
  if (params.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiFetch(`/api/v1/reviews/queue${qs ? `?${qs}` : ''}`)
}

export function submitReview(input: {
  wordId: string
  rating: 1 | 2 | 3 | 4
  elapsedMs?: number
}): Promise<SubmitReviewResponseDto> {
  return apiFetch('/api/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({
      word_id: input.wordId,
      rating: input.rating,
      elapsed_ms: input.elapsedMs,
      source: 'flashcard',
    }),
  })
}

export function getReviewForecast(days = 14): Promise<{ days: ForecastDayDto[] }> {
  return apiFetch(`/api/v1/reviews/forecast?days=${days}`)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- src/api/dictionaries.test.ts src/api/words.test.ts src/api/reviews.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 7: Commit**

```bash
git add src/api/dictionaries.ts src/api/words.ts src/api/reviews.ts src/api/dictionaries.test.ts src/api/words.test.ts src/api/reviews.test.ts
git commit -m "feat: add typed dictionaries/words/reviews API modules"
```

---

## Task 16: Client-side interval preview (`domain/srs.ts`)

**Files:**

- Create: `src/domain/srs.ts`
- Test: `src/domain/srs.test.ts`

**Interfaces:**

- Consumes: `src/domain/srs-fixtures.json` (written in Task 3).
- Produces: `AGAIN=1, HARD=2, GOOD=3, EASY=4`; `ReviewState { wordId, state, step, ease, interval }`; `previewNextState(state: ReviewState, rating: 1|2|3|4, now: Date): { state: ReviewState; dueAt: Date }`; `formatIntervalPreview(dueAt: Date, now: Date): string` (e.g. `"10m"`, `"1d"`, `"3mo"`) for the four rating buttons in `ReviewPage` (Task 18).
- This mirrors `services/srs.py`'s state/ease transitions exactly but does **not** need to reproduce Python's fuzz byte-for-byte — it's a preview shown before the user rates, the server's actual write is the source of truth. The two fuzz implementations are each tested for their own determinism, not for cross-language equality.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/domain/srs.test.ts
import { describe, expect, it } from 'vitest'
import fixtures from './srs-fixtures.json'
import {
  AGAIN,
  EASY,
  GOOD,
  HARD,
  previewNextState,
  formatIntervalPreview,
  type ReviewState,
} from './srs'

const WORD_ID = 'word-1'
const NOW = new Date('2026-09-15T10:00:00Z')

interface Fixture {
  description: string
  input: { state: ReviewState['state']; step: number; ease: string; interval: number }
  rating: 1 | 2 | 3 | 4
  expectState?: ReviewState['state']
  expectStep?: number
  expectInterval?: number
  expectEase?: string
  expectDueMinutes?: number
  expectDueDays?: number
}

describe('previewNextState — shared cross-language fixture', () => {
  for (const fixture of fixtures as Fixture[]) {
    it(fixture.description, () => {
      const state: ReviewState = {
        wordId: WORD_ID,
        state: fixture.input.state,
        step: fixture.input.step,
        ease: Number(fixture.input.ease),
        interval: fixture.input.interval,
      }
      const { state: next, dueAt } = previewNextState(state, fixture.rating, NOW)

      if (fixture.expectState) expect(next.state).toBe(fixture.expectState)
      if (fixture.expectStep !== undefined) expect(next.step).toBe(fixture.expectStep)
      if (fixture.expectInterval !== undefined) expect(next.interval).toBe(fixture.expectInterval)
      if (fixture.expectEase !== undefined)
        expect(next.ease).toBeCloseTo(Number(fixture.expectEase), 2)
      if (fixture.expectDueMinutes !== undefined) {
        expect(dueAt.getTime()).toBe(NOW.getTime() + fixture.expectDueMinutes * 60_000)
      }
      if (fixture.expectDueDays !== undefined) {
        expect(dueAt.getTime()).toBe(NOW.getTime() + fixture.expectDueDays * 86_400_000)
      }
    })
  }
})

describe('previewNextState — fuzz', () => {
  it('is deterministic for the same word id', () => {
    const state: ReviewState = {
      wordId: WORD_ID,
      state: 'review',
      step: 0,
      ease: 2.5,
      interval: 10,
    }
    const first = previewNextState(state, GOOD, NOW)
    const second = previewNextState(state, GOOD, NOW)
    expect(first.state.interval).toBe(second.state.interval)
  })

  it('keeps the fuzzed interval within +/-5% of the unfuzzed value', () => {
    const state: ReviewState = {
      wordId: WORD_ID,
      state: 'review',
      step: 0,
      ease: 2.5,
      interval: 10,
    }
    const { state: next } = previewNextState(state, GOOD, NOW)
    // unfuzzed: round(10 * 2.5) == 25
    expect(next.interval).toBeGreaterThanOrEqual(24)
    expect(next.interval).toBeLessThanOrEqual(27)
  })
})

describe('formatIntervalPreview', () => {
  it('formats sub-day intervals in minutes or hours', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe('10m')
    expect(formatIntervalPreview(new Date(NOW.getTime() + 90 * 60_000), NOW)).toBe('2h')
  })

  it('formats multi-day intervals in days', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 5 * 86_400_000), NOW)).toBe('5d')
  })

  it('formats month-scale intervals in months', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 60 * 86_400_000), NOW)).toBe('2mo')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/domain/srs.test.ts`
Expected: FAIL — `Cannot find module './srs'`

- [ ] **Step 3: Implement `srs.ts`**

```typescript
// src/domain/srs.ts
/** Mirrors backend/app/services/srs.py's state/ease transitions exactly.
 * Fuzz is NOT shared cross-language -- this is a preview shown before the
 * user rates; the server's write on submit is the source of truth. */

export const AGAIN = 1
export const HARD = 2
export const GOOD = 3
export const EASY = 4

export type Rating = typeof AGAIN | typeof HARD | typeof GOOD | typeof EASY

export interface ReviewState {
  wordId: string
  state: 'new' | 'learning' | 'relearning' | 'review'
  step: number
  ease: number
  interval: number
}

const LEARNING_STEPS_MIN = [1, 10]
const GRADUATING_INTERVAL_DAYS = 1
const EASY_INTERVAL_DAYS = 4
const MIN_EASE = 1.3
const EASE_FLOOR_STEP = 0.2
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

function fuzz(wordId: string): number {
  let hash = 0
  for (let i = 0; i < wordId.length; i++) {
    hash = (hash * 31 + wordId.charCodeAt(i)) >>> 0
  }
  return 0.95 + (hash / 0xffffffff) * 0.1
}

export function previewNextState(
  state: ReviewState,
  rating: Rating,
  now: Date,
): { state: ReviewState; dueAt: Date } {
  if (state.state !== 'review') {
    if (rating === AGAIN) {
      return {
        state: { ...state, state: 'learning', step: 0 },
        dueAt: new Date(now.getTime() + LEARNING_STEPS_MIN[0] * MINUTE_MS),
      }
    }
    if (rating === EASY) {
      return {
        state: { ...state, state: 'review', step: 0, interval: EASY_INTERVAL_DAYS },
        dueAt: new Date(now.getTime() + EASY_INTERVAL_DAYS * DAY_MS),
      }
    }
    const nextStep = state.step + 1
    if (nextStep >= LEARNING_STEPS_MIN.length) {
      return {
        state: { ...state, state: 'review', step: 0, interval: GRADUATING_INTERVAL_DAYS },
        dueAt: new Date(now.getTime() + GRADUATING_INTERVAL_DAYS * DAY_MS),
      }
    }
    return {
      state: { ...state, state: 'learning', step: nextStep },
      dueAt: new Date(now.getTime() + LEARNING_STEPS_MIN[nextStep] * MINUTE_MS),
    }
  }

  if (rating === AGAIN) {
    const ease = Math.max(MIN_EASE, state.ease - EASE_FLOOR_STEP)
    return {
      state: { ...state, state: 'relearning', step: 0, ease, interval: 1 },
      dueAt: new Date(now.getTime() + DAY_MS),
    }
  }

  const easeDelta = { [HARD]: -0.15, [GOOD]: 0, [EASY]: 0.1 }[rating]
  const ease = Math.max(MIN_EASE, state.ease + easeDelta)
  const multiplier = { [HARD]: 1.2, [GOOD]: ease, [EASY]: ease * 1.3 }[rating]
  const interval = Math.max(1, Math.round(state.interval * multiplier * fuzz(state.wordId)))
  return {
    state: { ...state, state: 'review', step: 0, ease, interval },
    dueAt: new Date(now.getTime() + interval * DAY_MS),
  }
}

export function formatIntervalPreview(dueAt: Date, now: Date): string {
  const totalMinutes = Math.round((dueAt.getTime() - now.getTime()) / MINUTE_MS)
  if (totalMinutes < 60) return `${totalMinutes}m`

  const totalDays = Math.round((dueAt.getTime() - now.getTime()) / DAY_MS)
  if (totalDays < 1) return `${Math.round(totalMinutes / 60)}h`
  if (totalDays < 30) return `${totalDays}d`
  if (totalDays < 365) return `${Math.round(totalDays / 30)}mo`
  return `${Math.round(totalDays / 365)}y`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/domain/srs.test.ts`
Expected: PASS (8 fixture cases + 2 fuzz + 3 formatting = 13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/srs.ts src/domain/srs.test.ts
git commit -m "feat: add client-side SRS interval preview (domain/srs.ts)"
```

---

## Task 17: `httpWords` adapter and `useWordsBackend()` cutover

**Files:**

- Create: `src/lib/http/words.ts`
- Modify: `src/hooks/useWords.ts`
- Test: `src/lib/http/words.test.ts`

**Interfaces:**

- Consumes: `listDictionaries`/`createDictionary` (Task 15), `listWords`/`createWord`/`updateWord`/`deleteWord`/`moveWord`/`getWord`/`bulkCreateWords` (Task 15), `DEFAULT_FOLDER` from `src/lib/folders.ts`.
- Produces: `httpWords: WordsBackend` — a third implementation of the existing `src/types/domain.ts:27` interface, bridging the frontend's `folder: string` concept onto the backend's `dictionary_id`: a folder name is resolved to (or creates) a same-named dictionary, exactly mirroring what the `sync_word_dictionary` DB trigger already does for legacy inserts (migration `0002`). `WordCard`/`WordList`/`AddWordForm`/`SearchBar`/`FolderSidebar` need zero changes because of this.
- `replaceAll` note: the only real caller (`SettingsPage.tsx:88`, "clear my dictionary") always passes `[]`. The implementation below handles the general contract (diff by id, delete removed, create the rest) correctly for that case; it cannot preserve client-supplied ids for genuinely new words since the backend generates ids server-side — no current caller relies on that, so this isn't a regression.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/http/words.test.ts
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { httpWords } from './words'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const DICTIONARIES = [
  {
    id: 'd1',
    name: 'General',
    word_count: 1,
    due_count: 0,
    is_default: true,
    language_code: null,
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

function wordDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'w1',
    dictionary_id: 'd1',
    word: 'cat',
    definition: 'an animal',
    part_of_speech: 'noun',
    example: null,
    translation: null,
    notes: null,
    difficulty: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('httpWords.list', () => {
  it('aggregates words across all dictionaries, mapping dictionary name to folder', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({ items: [wordDto()], next_cursor: null, has_more: false }),
      ),
    )

    const words = await httpWords.list()
    expect(words).toHaveLength(1)
    expect(words[0].folder).toBe('General')
  })

  it('follows pagination cursors until has_more is false', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({
            items: [wordDto({ id: 'w1' })],
            next_cursor: 'abc',
            has_more: true,
          })
        }
        return HttpResponse.json({
          items: [wordDto({ id: 'w2' })],
          next_cursor: null,
          has_more: false,
        })
      }),
    )

    const words = await httpWords.list()
    expect(words.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })
})

describe('httpWords.create', () => {
  it('creates a new dictionary when the folder does not exist yet', async () => {
    let createdDictionaryBody: unknown
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: [] })),
      http.post(`${BASE_URL}/api/v1/dictionaries`, async ({ request }) => {
        createdDictionaryBody = await request.json()
        return HttpResponse.json(
          {
            id: 'd2',
            name: 'New Folder',
            word_count: 0,
            due_count: 0,
            is_default: false,
            language_code: null,
            description: null,
            created_at: '',
            updated_at: '',
          },
          { status: 201 },
        )
      }),
      http.post(`${BASE_URL}/api/v1/dictionaries/d2/words`, () =>
        HttpResponse.json(wordDto({ dictionary_id: 'd2' }), { status: 201 }),
      ),
    )

    const word = await httpWords.create({
      word: 'cat',
      definition: 'an animal',
      partOfSpeech: 'noun',
      folder: 'New Folder',
    })

    expect(createdDictionaryBody).toEqual({ name: 'New Folder' })
    expect(word.folder).toBe('New Folder')
  })

  it('reuses an existing dictionary with a case-insensitive name match', async () => {
    let dictionaryPostCalled = false
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.post(`${BASE_URL}/api/v1/dictionaries`, () => {
        dictionaryPostCalled = true
        return HttpResponse.json({}, { status: 201 })
      }),
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json(wordDto(), { status: 201 }),
      ),
    )

    await httpWords.create({
      word: 'cat',
      definition: 'an animal',
      partOfSpeech: 'noun',
      folder: 'general',
    })
    expect(dictionaryPostCalled).toBe(false)
  })
})

describe('httpWords.update', () => {
  it('moves the word when the folder changes', async () => {
    let moveBody: unknown
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({
          items: [
            ...DICTIONARIES,
            {
              id: 'd2',
              name: 'Other',
              word_count: 0,
              due_count: 0,
              is_default: false,
              language_code: null,
              description: null,
              created_at: '',
              updated_at: '',
            },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/words/w1:move`, async ({ request }) => {
        moveBody = await request.json()
        return HttpResponse.json(wordDto({ dictionary_id: 'd2' }))
      }),
    )

    const word = await httpWords.update('w1', { folder: 'Other' })

    expect(moveBody).toEqual({ dictionary_id: 'd2' })
    expect(word.folder).toBe('Other')
  })

  it('patches fields without moving when folder is unchanged', async () => {
    let patched = false
    server.use(
      http.patch(`${BASE_URL}/api/v1/words/w1`, () => {
        patched = true
        return HttpResponse.json(wordDto({ definition: 'updated' }))
      }),
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )

    const word = await httpWords.update('w1', { definition: 'updated' })
    expect(patched).toBe(true)
    expect(word.definition).toBe('updated')
  })
})

describe('httpWords.remove', () => {
  it('DELETEs the word', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/w1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(httpWords.remove('w1')).resolves.toBeUndefined()
  })
})

describe('httpWords.replaceAll', () => {
  it('deletes every existing word when called with an empty array', async () => {
    const deleted: string[] = []
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({
          items: [wordDto({ id: 'w1' }), wordDto({ id: 'w2' })],
          next_cursor: null,
          has_more: false,
        }),
      ),
      http.delete(`${BASE_URL}/api/v1/words/:id`, ({ params }) => {
        deleted.push(params.id as string)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await httpWords.replaceAll([])
    expect(deleted.sort()).toEqual(['w1', 'w2'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/http/words.test.ts`
Expected: FAIL — `Cannot find module './words'`

- [ ] **Step 3: Implement `httpWords`**

```typescript
// src/lib/http/words.ts
import { createDictionary, listDictionaries, type DictionaryDto } from '@/api/dictionaries'
import {
  bulkCreateWords,
  createWord as apiCreateWord,
  deleteWord as apiDeleteWord,
  getWord,
  listWords,
  moveWord,
  updateWord as apiUpdateWord,
  type WordDto,
} from '@/api/words'
import { DEFAULT_FOLDER } from '@/lib/folders'
import { isPartOfSpeech, type NewWord, type Word, type WordsBackend } from '@/types/domain'

/** Bridges the frontend's folder concept onto the backend's dictionary_id --
 * mirrors the sync_word_dictionary DB trigger (migration 0002) client-side.
 * Module-level cache, cleared whenever a dictionary is created so a second
 * call in the same session sees it. */
let dictionariesCache: DictionaryDto[] | null = null

async function loadDictionaries(): Promise<DictionaryDto[]> {
  if (dictionariesCache) return dictionariesCache
  const { items } = await listDictionaries()
  dictionariesCache = items
  return items
}

async function resolveDictionaryId(folder: string): Promise<string> {
  const name = folder || DEFAULT_FOLDER
  const dictionaries = await loadDictionaries()
  const match = dictionaries.find((d) => d.name.toLowerCase() === name.toLowerCase())
  if (match) return match.id

  const created = await createDictionary({ name })
  dictionariesCache = null
  return created.id
}

async function folderForDictionaryId(dictionaryId: string): Promise<string> {
  const dictionaries = await loadDictionaries()
  return dictionaries.find((d) => d.id === dictionaryId)?.name ?? DEFAULT_FOLDER
}

function toWord(dto: WordDto, folder: string): Word {
  return {
    id: dto.id,
    word: dto.word,
    definition: dto.definition,
    partOfSpeech: isPartOfSpeech(dto.part_of_speech) ? dto.part_of_speech : 'noun',
    example: dto.example,
    folder,
    createdAt: new Date(dto.created_at).getTime(),
  }
}

async function listAllWordsInDictionary(dictionary: DictionaryDto): Promise<Word[]> {
  const words: Word[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await listWords(dictionary.id, { cursor, limit: 100 })
    words.push(...page.items.map((dto) => toWord(dto, dictionary.name)))
    if (!page.has_more || !page.next_cursor) break
    cursor = page.next_cursor
  }
  return words
}

export const httpWords: WordsBackend = {
  async list() {
    const dictionaries = await loadDictionaries()
    const perDictionary = await Promise.all(dictionaries.map(listAllWordsInDictionary))
    return perDictionary.flat().sort((a, b) => b.createdAt - a.createdAt)
  },

  async create(input: NewWord) {
    const dictionaryId = await resolveDictionaryId(input.folder)
    const dto = await apiCreateWord(dictionaryId, {
      word: input.word,
      definition: input.definition,
      part_of_speech: input.partOfSpeech,
      example: input.example ?? null,
    })
    return toWord(dto, input.folder || DEFAULT_FOLDER)
  },

  async update(id, patch) {
    let dto: WordDto | undefined
    let folder = patch.folder

    if (patch.folder !== undefined) {
      const targetDictionaryId = await resolveDictionaryId(patch.folder)
      dto = await moveWord(id, targetDictionaryId)
    }

    const fieldPatch: Record<string, unknown> = {}
    if (patch.word !== undefined) fieldPatch.word = patch.word
    if (patch.definition !== undefined) fieldPatch.definition = patch.definition
    if (patch.partOfSpeech !== undefined) fieldPatch.part_of_speech = patch.partOfSpeech
    if (patch.example !== undefined) fieldPatch.example = patch.example ?? null

    if (Object.keys(fieldPatch).length > 0) {
      dto = await apiUpdateWord(id, fieldPatch)
    }
    if (!dto) {
      dto = await getWord(id)
    }
    if (folder === undefined) {
      folder = await folderForDictionaryId(dto.dictionary_id)
    }

    return toWord(dto, folder)
  },

  async remove(id) {
    await apiDeleteWord(id)
  },

  async replaceAll(words) {
    const existing = await httpWords.list()
    const keepIds = new Set(words.map((w) => w.id))
    await Promise.all(existing.filter((w) => !keepIds.has(w.id)).map((w) => apiDeleteWord(w.id)))

    const existingIds = new Set(existing.map((w) => w.id))
    const toCreate = words.filter((w) => !existingIds.has(w.id))

    const byFolder = new Map<string, NewWord[]>()
    for (const word of toCreate) {
      const folder = word.folder || DEFAULT_FOLDER
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), word])
    }
    for (const [folder, wordsForFolder] of byFolder) {
      const dictionaryId = await resolveDictionaryId(folder)
      await bulkCreateWords(
        dictionaryId,
        wordsForFolder.map((w) => ({
          word: w.word,
          definition: w.definition,
          part_of_speech: w.partOfSpeech,
          example: w.example ?? null,
        })),
      )
    }
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/http/words.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Wire `httpWords` into `useWordsBackend()`**

```typescript
// src/hooks/useWords.ts — replace the supabaseWords import and its usage
import { httpWords } from '@/lib/http/words'
// keep the existing `import { guestWords } from '@/lib/guest/guestStore'` for now —
// removed in Task 21, which deletes guest mode entirely.

export function useWordsBackend(): WordsBackend | null {
  const { state } = useAuth()
  if (state.status === 'authenticated') return httpWords
  if (state.status === 'guest') return guestWords
  return null
}
```

(Remove the now-unused `import { supabaseWords } from '@/lib/supabase/words'` line from this file — `src/lib/supabase/words.ts` itself is deleted in Task 22 once nothing imports it.)

- [ ] **Step 6: Run the full frontend test suite**

Run: `npm test`
Expected: PASS — no other test imports `supabaseWords` from `useWords.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/http/words.ts src/lib/http/words.test.ts src/hooks/useWords.ts
git commit -m "feat: add httpWords adapter and cut useWordsBackend over to it"
```

---

## Task 18: `useReviewQueue` and `useSubmitReview` hooks

**Files:**

- Create: `src/hooks/useReviewQueue.ts`
- Test: `src/hooks/useReviewQueue.test.ts`

**Interfaces:**

- Consumes: `getReviewQueue`, `submitReview` (Task 15), `useAuth` (existing).
- Produces: `useReviewQueue(dictionaryId?: string)` — a TanStack Query hook returning `ReviewQueueItemDto[]`, enabled only when authenticated. `useSubmitReview(dictionaryId?: string)` — a mutation that, on success, optimistically removes the rated word from the cached queue and invalidates it.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/useReviewQueue.test.ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useReviewQueue, useSubmitReview } from './useReviewQueue'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } },
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'authenticated' }, scope: 'user-1' }),
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useReviewQueue', () => {
  it('loads the queue for the current user', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [{ word_id: 'w1', word: 'cat', definition: 'an animal', part_of_speech: 'noun', example: null, state: 'new', due_at: null }],
        }),
      ),
    )

    const { result } = renderHook(() => useReviewQueue(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.[0].word).toBe('cat')
  })
})

describe('useSubmitReview', () => {
  it('removes the rated word from the cached queue on success', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [
            { word_id: 'w1', word: 'cat', definition: 'x', part_of_speech: null, example: null, state: 'new', due_at: null },
            { word_id: 'w2', word: 'dog', definition: 'y', part_of_speech: null, example: null, state: 'new', due_at: null },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/reviews`, () =>
        HttpResponse.json(
          { word_id: 'w1', state: 'learning', ease_factor: '2.50', interval_days: 0, due_at: '2026-09-16T00:00:00Z' },
          { status: 201 },
        ),
      ),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result: queueResult } = renderHook(() => useReviewQueue(), { wrapper: localWrapper })
    await waitFor(() => expect(queueResult.current.isSuccess).toBe(true))

    const { result: submitResult } = renderHook(() => useSubmitReview(), { wrapper: localWrapper })
    await submitResult.current.mutateAsync({ wordId: 'w1', rating: 3 })

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ word_id: string }[]>(['review-queue', 'user-1', 'all'])
      expect(cached?.map((i) => i.word_id)).toEqual(['w2'])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/hooks/useReviewQueue.test.ts`
Expected: FAIL — `Cannot find module './useReviewQueue'`

- [ ] **Step 3: Implement the hooks**

```typescript
// src/hooks/useReviewQueue.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { getReviewQueue, submitReview, type ReviewQueueItemDto } from '@/api/reviews'

function queueKey(scope: string, dictionaryId?: string) {
  return ['review-queue', scope, dictionaryId ?? 'all']
}

export function useReviewQueue(dictionaryId?: string) {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: queueKey(scope, dictionaryId),
    queryFn: () => getReviewQueue({ dictionaryId }).then((r) => r.items),
    enabled: state.status === 'authenticated',
    staleTime: 0,
  })
}

export function useSubmitReview(dictionaryId?: string) {
  const { scope } = useAuth()
  const queryClient = useQueryClient()
  const key = queueKey(scope, dictionaryId)

  return useMutation({
    mutationFn: (input: { wordId: string; rating: 1 | 2 | 3 | 4; elapsedMs?: number }) =>
      submitReview(input),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<ReviewQueueItemDto[]>(key, (prev) =>
        (prev ?? []).filter((item) => item.word_id !== variables.wordId),
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/hooks/useReviewQueue.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReviewQueue.ts src/hooks/useReviewQueue.test.ts
git commit -m "feat: add useReviewQueue and useSubmitReview hooks"
```

---

## Task 19: `ReviewPage` component

**Files:**

- Create: `src/pages/ReviewPage.tsx`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/bg.ts`, `src/index.css`
- Test: `src/pages/ReviewPage.test.tsx`

**Interfaces:**

- Consumes: `useReviewQueue`/`useSubmitReview` (Task 18), `previewNextState`/`formatIntervalPreview`/`AGAIN`/`HARD`/`GOOD`/`EASY` (Task 16). Reads `?dictionary_id=` from the URL (set by `FlashcardsPage` in Task 20).
- Produces: `ReviewPage` — full-viewport flip card (reusing the existing `.flip-card`/`.flip-scene` CSS from `FlashcardModal`), four rating buttons each showing `domain/srs.ts`'s interval preview, swipe left (again) / right (good), keyboard `1`-`4` to rate and `Space` to flip, an empty state once the queue is exhausted.

- [ ] **Step 1: Add the reduced-motion CSS rule (benefits `FlashcardModal` too — same shared class)**

```css
/* src/index.css — inside the existing `.flip-card` rule's @layer components block, after .flip-card.is-flipped */
@media (prefers-reduced-motion: reduce) {
  .flip-card {
    transition: none;
  }
}
```

- [ ] **Step 2: Add the new translation keys**

```typescript
// src/i18n/locales/en.ts — add near 'flip-hint-front'/'flip-hint-back'
  'rating-again': 'Again',
  'rating-hard': 'Hard',
  'rating-good': 'Good',
  'rating-easy': 'Easy',
  'review-remaining': '{n} left',
  'review-all-done-title': "You're all caught up!",
  'review-all-done-body': 'No words are due for review right now.',
  'review-back-to-flashcards': 'Back to Flashcards',
```

```typescript
// src/i18n/locales/bg.ts — add near the same section
  'rating-again': 'Отново',
  'rating-hard': 'Трудно',
  'rating-good': 'Добре',
  'rating-easy': 'Лесно',
  'review-remaining': 'Остават {n}',
  'review-all-done-title': 'Готово за днес!',
  'review-all-done-body': 'В момента няма думи за преговор.',
  'review-back-to-flashcards': 'Обратно към Флаш карти',
```

- [ ] **Step 3: Write the failing tests**

```tsx
// src/pages/ReviewPage.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { ReviewPage } from './ReviewPage'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'authenticated' }, scope: 'user-1' }),
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/app/review']}>
          <ReviewPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('ReviewPage', () => {
  it('shows the current word and interval previews on each rating button', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [
            {
              word_id: 'w1',
              word: 'cat',
              definition: 'an animal',
              part_of_speech: 'noun',
              example: null,
              state: 'new',
              due_at: null,
            },
          ],
        }),
      ),
    )
    renderPage()

    expect(await screen.findByText('cat')).toBeInTheDocument()
    expect(screen.getByText('Again')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
  })

  it('submits a rating when a rating button is clicked and advances the queue', async () => {
    let submittedBody: unknown
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [
            {
              word_id: 'w1',
              word: 'cat',
              definition: 'an animal',
              part_of_speech: 'noun',
              example: null,
              state: 'new',
              due_at: null,
            },
            {
              word_id: 'w2',
              word: 'dog',
              definition: 'a pet',
              part_of_speech: 'noun',
              example: null,
              state: 'new',
              due_at: null,
            },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/reviews`, async ({ request }) => {
        submittedBody = await request.json()
        return HttpResponse.json(
          {
            word_id: 'w1',
            state: 'learning',
            ease_factor: '2.50',
            interval_days: 0,
            due_at: '2026-09-16T00:00:00Z',
          },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('cat')
    await user.click(screen.getByText('Good'))

    await waitFor(() => expect(submittedBody).toMatchObject({ word_id: 'w1', rating: 3 }))
    await waitFor(() => expect(screen.getByText('dog')).toBeInTheDocument())
  })

  it('shows the empty state once the queue is exhausted', async () => {
    server.use(http.get(`${BASE_URL}/api/v1/reviews/queue`, () => HttpResponse.json({ items: [] })))
    renderPage()

    expect(await screen.findByText("You're all caught up!")).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- src/pages/ReviewPage.test.tsx`
Expected: FAIL — `Cannot find module './ReviewPage'`

- [ ] **Step 5: Implement `ReviewPage`**

```tsx
// src/pages/ReviewPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { useT } from '@/context/I18nContext'
import {
  AGAIN,
  EASY,
  GOOD,
  HARD,
  formatIntervalPreview,
  previewNextState,
  type Rating,
  type ReviewState,
} from '@/domain/srs'
import { useReviewQueue, useSubmitReview } from '@/hooks/useReviewQueue'
import type { TranslationKey } from '@/i18n'
import { cn } from '@/lib/cn'

const RATING_BUTTONS: { rating: Rating; labelKey: TranslationKey; className: string }[] = [
  { rating: AGAIN, labelKey: 'rating-again', className: 'bg-error text-white' },
  { rating: HARD, labelKey: 'rating-hard', className: 'bg-amber-500 text-white' },
  { rating: GOOD, labelKey: 'rating-good', className: 'bg-brand text-white' },
  { rating: EASY, labelKey: 'rating-easy', className: 'bg-emerald-500 text-white' },
]

const SWIPE_THRESHOLD_PX = 60

export function ReviewPage() {
  const t = useT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const dictionaryId = searchParams.get('dictionary_id') ?? undefined

  const { data: items, isLoading } = useReviewQueue(dictionaryId)
  const submit = useSubmitReview(dictionaryId)

  const [flipped, setFlipped] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  const current = items?.[0]

  const rate = useCallback(
    (rating: Rating) => {
      if (!current) return
      submit.mutate({ wordId: current.word_id, rating, elapsedMs: Date.now() - startedAt })
      setFlipped(false)
      setStartedAt(Date.now())
    },
    [current, startedAt, submit],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        setFlipped((prev) => !prev)
        return
      }
      if (event.key >= '1' && event.key <= '4') {
        rate(Number(event.key) as Rating)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [rate])

  const previews = useMemo(() => {
    if (!current) return null
    const state: ReviewState = {
      wordId: current.word_id,
      state: current.state as ReviewState['state'],
      step: 0,
      ease: 2.5,
      interval: 0,
    }
    const now = new Date()
    return RATING_BUTTONS.map(({ rating }) =>
      formatIntervalPreview(previewNextState(state, rating, now).dueAt, now),
    )
  }, [current])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[17px] font-semibold text-fg">{t('review-all-done-title')}</p>
        <p className="text-[14.5px] text-fg-muted">{t('review-all-done-body')}</p>
        <button
          type="button"
          onClick={() => navigate('/app/flashcards')}
          className="mt-2 text-[14.5px] font-medium text-brand hover:text-brand-hover"
        >
          {t('review-back-to-flashcards')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-[70vh] flex-col items-center justify-center gap-6 py-6"
      onTouchStart={(event) => setTouchStartX(event.touches[0].clientX)}
      onTouchEnd={(event) => {
        if (touchStartX === null) return
        const deltaX = event.changedTouches[0].clientX - touchStartX
        if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) rate(deltaX > 0 ? GOOD : AGAIN)
        setTouchStartX(null)
      }}
    >
      <span className="text-[13.5px] font-medium text-fg-muted">
        {t('review-remaining', { n: items.length })}
      </span>

      <button
        type="button"
        onClick={() => setFlipped((prev) => !prev)}
        className="flip-scene w-full max-w-[520px]"
        aria-label={t('shortcut-flip')}
      >
        <div className={cn('flip-card block h-[300px] w-full', flipped && 'is-flipped')}>
          <span className="flip-face flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
            <span className="text-[30px] font-bold text-fg">{current.word}</span>
            {current.part_of_speech && (
              <span className="rounded-md bg-brand-soft px-2.5 py-[3px] text-[12.5px] font-medium text-brand">
                {t(current.part_of_speech as TranslationKey)}
              </span>
            )}
          </span>
          <span className="flip-face flip-face-back flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
            <span className="text-[18px] font-medium text-fg">{current.definition}</span>
            {current.example && (
              <span className="text-[13.5px] italic text-fg-muted">{current.example}</span>
            )}
          </span>
        </div>
      </button>

      <div className="grid w-full max-w-[520px] grid-cols-4 gap-2">
        {RATING_BUTTONS.map(({ rating, labelKey, className }, i) => (
          <button
            key={rating}
            type="button"
            onClick={() => rate(rating)}
            className={cn(
              'flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[13px] font-semibold transition hover:brightness-95',
              className,
            )}
          >
            <span>{t(labelKey)}</span>
            <span className="text-[11px] font-normal opacity-80">{previews?.[i]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- src/pages/ReviewPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add src/pages/ReviewPage.tsx src/pages/ReviewPage.test.tsx src/i18n/locales/en.ts src/i18n/locales/bg.ts src/index.css
git commit -m "feat: add ReviewPage with rating buttons, interval previews, swipe and keyboard shortcuts"
```

---

## Task 20: `FlashcardsPage` becomes the entry point into `ReviewPage`

**Files:**

- Create: `src/hooks/useDictionaries.ts`
- Modify: `src/pages/FlashcardsPage.tsx`, `src/routes.tsx`, `src/i18n/locales/en.ts`, `src/i18n/locales/bg.ts`
- Delete: `src/features/flashcards/FlashcardModal.tsx` (its only importer is `FlashcardsPage.tsx`, verified — `WordPicker.tsx` stays, it's also used by `TestsPage.tsx`)
- Test: `src/pages/FlashcardsPage.test.tsx`

**Interfaces:**

- Produces: `useDictionaries()` — TanStack Query hook wrapping `listDictionaries()`. `FlashcardsPage` now renders one card per dictionary (showing its `due_count`) plus an "All words" option; clicking either navigates to `/app/review` (optionally with `?dictionary_id=`) instead of opening `FlashcardModal`. Route `review` added under `/app` in `routes.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/pages/FlashcardsPage.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { FlashcardsPage } from './FlashcardsPage'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'authenticated' }, scope: 'user-1' }),
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/app/flashcards']}>
          <Routes>
            <Route path="/app/flashcards" element={<FlashcardsPage />} />
            <Route path="/app/review" element={<div>REVIEW PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const DICTIONARIES = [
  {
    id: 'd1',
    name: 'IELTS',
    word_count: 10,
    due_count: 3,
    is_default: true,
    language_code: null,
    description: null,
    created_at: '',
    updated_at: '',
  },
]

describe('FlashcardsPage', () => {
  it('lists dictionaries with their due counts', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    renderPage()

    expect(await screen.findByText('IELTS')).toBeInTheDocument()
    expect(screen.getByText(/3/)).toBeInTheDocument()
  })

  it('navigates to /app/review with the dictionary_id when a dictionary card is clicked', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('IELTS'))
    expect(await screen.findByText('REVIEW PAGE')).toBeInTheDocument()
  })

  it('navigates to /app/review with no dictionary_id when "All words" is clicked', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('All words'))
    expect(await screen.findByText('REVIEW PAGE')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/FlashcardsPage.test.tsx`
Expected: FAIL — old `FlashcardsPage` renders a word checklist, not dictionary cards; `screen.findByText('IELTS')` times out

- [ ] **Step 3: Add the translation key**

```typescript
// src/i18n/locales/en.ts — add near 'flashcards-title'
  'flashcards-all-words': 'All words',
```

```typescript
// src/i18n/locales/bg.ts — add near the same section
  'flashcards-all-words': 'Всички думи',
```

- [ ] **Step 4: Add `useDictionaries`**

```typescript
// src/hooks/useDictionaries.ts
import { useQuery } from '@tanstack/react-query'
import { listDictionaries } from '@/api/dictionaries'
import { useAuth } from '@/context/AuthContext'

export function useDictionaries() {
  const { scope, state } = useAuth()
  return useQuery({
    queryKey: ['dictionaries', scope],
    queryFn: () => listDictionaries().then((r) => r.items),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  })
}
```

- [ ] **Step 5: Rewrite `FlashcardsPage`**

```tsx
// src/pages/FlashcardsPage.tsx
import { Layers, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/context/I18nContext'
import { useDictionaries } from '@/hooks/useDictionaries'

export function FlashcardsPage() {
  const t = useT()
  const navigate = useNavigate()
  const { data: dictionaries = [], isLoading } = useDictionaries()

  const start = (dictionaryId?: string) => {
    navigate(dictionaryId ? `/app/review?dictionary_id=${dictionaryId}` : '/app/review')
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-[-0.01em] text-fg">
            <Layers size={24} className="text-brand" />
            {t('flashcards-title')}
          </h1>
          <p className="mt-1.5 text-[14.5px] text-fg-muted">{t('flashcards-subtitle')}</p>
        </div>
      </header>

      <section className="mt-6 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold text-fg">{t('select-words-label')}</h2>

        {isLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-[52px] animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : dictionaries.length === 0 ? (
          <p className="py-10 text-center text-[14.5px] text-fg-muted">{t('empty-body')}</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => start()}
              className="flex items-center justify-between rounded-[10px] border border-line bg-surface-2 px-4 py-3.5 text-left transition hover:border-brand"
            >
              <span className="text-[14.5px] font-medium text-fg">{t('flashcards-all-words')}</span>
              <Play size={16} className="text-brand" />
            </button>
            {dictionaries.map((dictionary) => (
              <button
                key={dictionary.id}
                type="button"
                onClick={() => start(dictionary.id)}
                className="flex items-center justify-between rounded-[10px] border border-line bg-surface-2 px-4 py-3.5 text-left transition hover:border-brand"
              >
                <span className="text-[14.5px] font-medium text-fg">{dictionary.name}</span>
                <span className="text-[13px] text-fg-muted">{dictionary.due_count} due</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
```

- [ ] **Step 6: Delete `FlashcardModal.tsx`**

```bash
git rm src/features/flashcards/FlashcardModal.tsx
```

- [ ] **Step 7: Add the `review` route**

```typescript
// src/routes.tsx — add the import and the child route
import { ReviewPage } from '@/pages/ReviewPage'
// ...
      { path: 'flashcards', element: <FlashcardsPage /> },
      { path: 'review', element: <ReviewPage /> },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- src/pages/FlashcardsPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 9: Run the full frontend suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — confirms nothing else imported `FlashcardModal` or the old checkbox-based `FlashcardsPage` shape

- [ ] **Step 10: Commit**

```bash
git add src/pages/FlashcardsPage.tsx src/pages/FlashcardsPage.test.tsx src/hooks/useDictionaries.ts src/routes.tsx src/i18n/locales/en.ts src/i18n/locales/bg.ts
git commit -m "feat: FlashcardsPage becomes a dictionary picker entry point into ReviewPage"
```

---

## Task 21: Remove guest mode

**Files:**

- Modify: `src/context/AuthContext.tsx`, `src/pages/LoginPage.tsx`, `src/hooks/useWords.ts`, `src/hooks/useQuizHistory.ts`, `src/hooks/useAiUsage.ts`
- Delete: `src/lib/guest/guestStore.ts`, `src/lib/guest/guestProgress.ts`
- Test: `src/context/AuthContext.test.tsx`, `src/pages/LoginPage.test.tsx`

**Interfaces:**

- Removes the `'guest'` variant from `AuthState` and `continueAsGuest` from `AuthValue` entirely. Every consumer that branched on `state.status === 'guest'` is updated in this same task — they aren't independently reviewable since the type change forces all of them to change together. `ChatWidget.tsx`, `TestsPage.tsx`, `AppLayout.tsx`, `SettingsPage.tsx`, `useCustomFolders.ts` are **not** touched: they reference the generic "not authenticated" case or use guest-flavoured copy strings that remain harmless (and in practice unreachable, since `ProtectedRoute` already redirects anonymous users away from every `/app` page) — cleaning those up is Phase 8 polish, not part of removing the guest entry point itself.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/context/AuthContext.test.tsx
import { describe, expect, it } from 'vitest'
import type { AuthState } from './AuthContext'

describe('AuthState', () => {
  it('has no guest variant', () => {
    // Compile-time check: this assignment must be a type error if 'guest'
    // still exists as a valid status. Runtime assertion below is the
    // executable half of that guarantee.
    const state: AuthState = { status: 'anonymous' }
    expect(state.status).not.toBe('guest')
  })
})
```

```tsx
// src/pages/LoginPage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { LoginPage } from './LoginPage'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'anonymous' }, signIn: vi.fn(), signOut: vi.fn() }),
}))

describe('LoginPage', () => {
  it('does not render a continue-as-guest option', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </I18nProvider>,
    )
    expect(screen.queryByText('Continue as guest')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/context/AuthContext.test.tsx src/pages/LoginPage.test.tsx`
Expected: FAIL — `LoginPage` renders "Continue as guest"; `useAuth()` mock is missing `continueAsGuest` which the real hook's consumers still expect (a TS error surfaces at `npm run typecheck` even before the test fails at runtime)

- [ ] **Step 3: Rewrite `AuthContext.tsx`**

```tsx
// src/context/AuthContext.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { signInWithGoogle, signOut as supabaseSignOut, toAppUser } from '@/lib/supabase/auth'
import { upsertProfile } from '@/lib/supabase/profiles'
import type { AppUser } from '@/types/domain'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AppUser; session: Session }

interface AuthValue {
  state: AuthState
  /** Stable key for cache scoping: user id or 'anonymous'. */
  scope: string
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    const apply = (session: Session | null) => {
      if (!active) return
      if (session?.user) {
        const user = toAppUser(session.user)
        setState({ status: 'authenticated', user, session })
        void upsertProfile(user)
        return
      }
      setState({ status: 'anonymous' })
    }

    void supabase.auth.getSession().then(({ data }) => apply(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async () => {
    await signInWithGoogle()
  }, [])

  const signOut = useCallback(async () => {
    await supabaseSignOut()
    setState({ status: 'anonymous' })
  }, [])

  const scope = state.status === 'authenticated' ? state.user.id : 'anonymous'

  const value = useMemo<AuthValue>(
    () => ({ state, scope, signIn, signOut }),
    [state, scope, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
```

- [ ] **Step 4: Update `LoginPage.tsx`**

```tsx
// src/pages/LoginPage.tsx — full file
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { BookMarked, Brain, Layers, Sparkles } from 'lucide-react'
import { LogoMark } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import type { TranslationKey } from '@/i18n'

const FEATURES: { icon: typeof BookMarked; key: TranslationKey }[] = [
  { icon: BookMarked, key: 'nav-dictionary' },
  { icon: Layers, key: 'nav-flashcards' },
  { icon: Brain, key: 'nav-tests' },
  { icon: Sparkles, key: 'open-chat' },
]

export function LoginPage() {
  const t = useT()
  const { state, signIn } = useAuth()
  const [busy, setBusy] = useState(false)

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner />
      </div>
    )
  }

  if (state.status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-card">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10 rounded-xl" />
          <span className="text-[22px] font-bold tracking-[-0.01em] text-fg">{t('app-name')}</span>
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">{t('login-tagline')}</p>

        <ul className="mt-6 grid grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, key }) => (
            <li
              key={key}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[14px] text-fg"
            >
              <Icon size={17} className="text-brand" />
              {t(key)}
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await signIn()
            } finally {
              setBusy(false)
            }
          }}
          className="mt-7 flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] bg-brand text-[15.5px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? <Spinner /> : null}
          {t('sign-in-google')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update `useWords.ts`**

```typescript
// src/hooks/useWords.ts — remove the guestWords import and branch
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { httpWords } from '@/lib/http/words'
import type { NewWord, Word, WordsBackend } from '@/types/domain'

export function useWordsBackend(): WordsBackend | null {
  const { state } = useAuth()
  if (state.status === 'authenticated') return httpWords
  return null
}

export function useWords() {
  const { scope, state } = useAuth()
  const backend = useWordsBackend()

  return useQuery({
    queryKey: ['words', scope],
    queryFn: () => (backend ? backend.list() : Promise.resolve<Word[]>([])),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  })
}

// useWordMutations() is unchanged below this point
```

- [ ] **Step 6: Update `useQuizHistory.ts`**

```typescript
// src/hooks/useQuizHistory.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { listQuizHistory, saveQuizResult } from '@/lib/supabase/progress'
import type { NewQuizResult, QuizResult } from '@/types/domain'

export function useQuizHistory(limit = 10) {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: ['quiz-history', scope, limit],
    queryFn: (): Promise<QuizResult[]> => listQuizHistory(limit),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  })
}

export function useSaveQuizResult() {
  const { scope } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: NewQuizResult) => saveQuizResult(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['quiz-history', scope] }),
  })
}
```

- [ ] **Step 7: Update the comment in `useAiUsage.ts`**

```typescript
// src/hooks/useAiUsage.ts — the ternary's else-branch is now unreachable in
// practice (ProtectedRoute keeps unauthenticated users off every /app page)
// but stays as defensive code for the brief 'loading' window; only the
// stale comment referencing "guests" is updated:
/** Unauthenticated/loading has no server-side quota to report yet. */
const GUEST_USAGE: UsageInfo = { used: 0, limit: 0, isUnlimited: false }
```

- [ ] **Step 8: Delete the guest storage modules**

```bash
git rm src/lib/guest/guestStore.ts src/lib/guest/guestProgress.ts
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- src/context/AuthContext.test.tsx src/pages/LoginPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Run the full frontend suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — a lingering `state.status === 'guest'` comparison anywhere would now be a TypeScript error (comparing against an exhausted union), which is the mechanical proof every call site was updated

- [ ] **Step 11: Commit**

```bash
git add src/context/AuthContext.tsx src/pages/LoginPage.tsx src/hooks/useWords.ts src/hooks/useQuizHistory.ts src/hooks/useAiUsage.ts src/context/AuthContext.test.tsx src/pages/LoginPage.test.tsx
git commit -m "feat: remove guest mode"
```

---

## Task 22: Guest-data import prompt + remove the dead Supabase words client

**Files:**

- Create: `src/features/data/legacyGuestWords.ts`, `src/features/data/GuestImportPrompt.tsx`
- Modify: `src/pages/AppLayout.tsx`, `src/i18n/locales/en.ts`, `src/i18n/locales/bg.ts`
- Delete: `src/lib/supabase/words.ts` (its only importer, `useWords.ts`, was switched to `httpWords` in Task 17; `progress.ts`/`usage.ts`/`profiles.ts` stay — they back quiz history, AI usage display and profile upsert, none of which this work order cuts over)
- Test: `src/features/data/legacyGuestWords.test.ts`, `src/features/data/GuestImportPrompt.test.tsx`

**Interfaces:**

- Produces: `readLegacyGuestWords(): NewWord[]` and `clearLegacyGuestWords(): void`, reading the same `localStorage` key (`dictionary_guest`) the now-deleted `guestStore.ts` used, so a pre-cutover guest's words aren't silently lost. `GuestImportPrompt` — a one-time modal shown after login when legacy words exist, offering to import them into the user's default dictionary via `bulkCreateWords`, or dismiss (which clears the key permanently either way).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/features/data/legacyGuestWords.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { clearLegacyGuestWords, readLegacyGuestWords } from './legacyGuestWords'

const KEY = 'dictionary_guest'

afterEach(() => localStorage.clear())

describe('readLegacyGuestWords', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(readLegacyGuestWords()).toEqual([])
  })

  it('reads and normalises stored legacy words', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { word: 'cat', definition: 'an animal', partOfSpeech: 'noun', example: 'A cat sat.' },
      ]),
    )
    const words = readLegacyGuestWords()
    expect(words).toEqual([
      {
        word: 'cat',
        definition: 'an animal',
        partOfSpeech: 'noun',
        example: 'A cat sat.',
        folder: 'Imported',
      },
    ])
  })

  it('skips entries missing a word or definition', () => {
    localStorage.setItem(KEY, JSON.stringify([{ word: 'onlyword' }, { definition: 'onlydef' }]))
    expect(readLegacyGuestWords()).toEqual([])
  })

  it('falls back to noun for an invalid part of speech', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ word: 'x', definition: 'y', partOfSpeech: 'nonsense' }]),
    )
    expect(readLegacyGuestWords()[0].partOfSpeech).toBe('noun')
  })
})

describe('clearLegacyGuestWords', () => {
  it('removes the storage key', () => {
    localStorage.setItem(KEY, JSON.stringify([{ word: 'x', definition: 'y' }]))
    clearLegacyGuestWords()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
```

```tsx
// src/features/data/GuestImportPrompt.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { I18nProvider } from '@/context/I18nContext'
import { GuestImportPrompt } from './GuestImportPrompt'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const KEY = 'dictionary_guest'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify([{ word: 'cat', definition: 'an animal' }]))
})

function renderPrompt() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <GuestImportPrompt />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('GuestImportPrompt', () => {
  it('renders nothing when there are no legacy words', () => {
    localStorage.clear()
    const { container } = renderPrompt()
    expect(container).toBeEmptyDOMElement()
  })

  it('imports into the default dictionary and clears the key on confirm', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'd1',
              name: 'General',
              is_default: true,
              word_count: 0,
              due_count: 0,
              language_code: null,
              description: null,
              created_at: '',
              updated_at: '',
            },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words:bulk`, () =>
        HttpResponse.json({ results: [] }),
      ),
    )
    const user = userEvent.setup()
    renderPrompt()

    await user.click(await screen.findByRole('button', { name: /import/i }))

    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
  })

  it('clears the key without importing when dismissed', async () => {
    const user = userEvent.setup()
    renderPrompt()

    await user.click(await screen.findByRole('button', { name: /not now|dismiss/i }))
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/features/data/legacyGuestWords.test.ts src/features/data/GuestImportPrompt.test.tsx`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Add the translation keys**

```typescript
// src/i18n/locales/en.ts
  'guest-import-title': 'Import your words?',
  'guest-import-body': 'We found {n} words saved on this device. Add them to your account?',
  'guest-import-confirm': 'Import',
  'guest-import-dismiss': 'Not now',
  'guest-import-success': 'Imported {n} words.',
```

```typescript
// src/i18n/locales/bg.ts
  'guest-import-title': 'Импортиране на думите?',
  'guest-import-body': 'Намерихме {n} думи, запазени на това устройство. Да ги добавим ли към акаунта ти?',
  'guest-import-confirm': 'Импортирай',
  'guest-import-dismiss': 'Не сега',
  'guest-import-success': 'Импортирани {n} думи.',
```

- [ ] **Step 4: Implement `legacyGuestWords.ts`**

```typescript
// src/features/data/legacyGuestWords.ts
/** Reads the localStorage key the now-deleted src/lib/guest/guestStore.ts
 * used, so a pre-cutover guest's words survive the guest-mode removal
 * (Task 21) as a one-time import instead of silently disappearing. */

import { readJson, removeKey } from '@/lib/storage'
import { isPartOfSpeech, type NewWord } from '@/types/domain'

const KEY = 'dictionary_guest'
const IMPORT_TARGET_FOLDER = 'Imported'

interface LegacyWord {
  word?: string
  definition?: string
  partOfSpeech?: string
  example?: string | null
}

export function readLegacyGuestWords(): NewWord[] {
  const raw = readJson<LegacyWord[]>(KEY, [])
  if (!Array.isArray(raw)) return []

  return raw
    .filter((entry): entry is Required<Pick<LegacyWord, 'word' | 'definition'>> & LegacyWord =>
      Boolean(entry.word && entry.definition),
    )
    .map((entry) => ({
      word: entry.word,
      definition: entry.definition,
      partOfSpeech: isPartOfSpeech(entry.partOfSpeech) ? entry.partOfSpeech : 'noun',
      example: entry.example ?? null,
      folder: IMPORT_TARGET_FOLDER,
    }))
}

export function clearLegacyGuestWords(): void {
  removeKey(KEY)
}
```

- [ ] **Step 5: Run the `legacyGuestWords` tests to verify they pass**

Run: `npm test -- src/features/data/legacyGuestWords.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Implement `GuestImportPrompt.tsx`**

```tsx
// src/features/data/GuestImportPrompt.tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createDictionary, listDictionaries } from '@/api/dictionaries'
import { bulkCreateWords } from '@/api/words'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useT } from '@/context/I18nContext'
import { clearLegacyGuestWords, readLegacyGuestWords } from './legacyGuestWords'

export function GuestImportPrompt() {
  const t = useT()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(() => readLegacyGuestWords())
  const [importing, setImporting] = useState(false)

  if (pending.length === 0) return null

  const dismiss = () => {
    clearLegacyGuestWords()
    setPending([])
  }

  const importWords = async () => {
    setImporting(true)
    try {
      const { items } = await listDictionaries()
      const target =
        items.find((d) => d.is_default) ?? (await createDictionary({ name: 'Imported' }))
      await bulkCreateWords(
        target.id,
        pending.map((w) => ({
          word: w.word,
          definition: w.definition,
          part_of_speech: w.partOfSpeech,
          example: w.example ?? null,
        })),
      )
      clearLegacyGuestWords()
      const count = pending.length
      setPending([])
      await queryClient.invalidateQueries({ queryKey: ['words'] })
      await queryClient.invalidateQueries({ queryKey: ['dictionaries'] })
      toast.push(t('guest-import-success', { n: count }))
    } catch {
      toast.push(t('err-generic'), 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <p className="text-[15px] font-semibold text-fg">{t('guest-import-title')}</p>
        <p className="mt-2 text-[13.5px] text-fg-muted">
          {t('guest-import-body', { n: pending.length })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={importing}>
            {t('guest-import-dismiss')}
          </Button>
          <Button onClick={() => void importWords()} loading={importing}>
            {t('guest-import-confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Mount it in `AppLayout.tsx`**

```tsx
// src/pages/AppLayout.tsx — add the import and mount alongside ChatWidget
import { GuestImportPrompt } from '@/features/data/GuestImportPrompt'
// ...
      <BackToTop />
      <ChatWidget />
      <GuestImportPrompt />
```

- [ ] **Step 8: Run the `GuestImportPrompt` tests to verify they pass**

Run: `npm test -- src/features/data/GuestImportPrompt.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 9: Delete the dead Supabase words client**

```bash
git rm src/lib/supabase/words.ts
```

- [ ] **Step 10: Run the full frontend suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — no remaining import of `src/lib/supabase/words.ts` anywhere

- [ ] **Step 11: Commit**

```bash
git add src/features/data/legacyGuestWords.ts src/features/data/GuestImportPrompt.tsx src/features/data/legacyGuestWords.test.ts src/features/data/GuestImportPrompt.test.tsx src/pages/AppLayout.tsx src/i18n/locales/en.ts src/i18n/locales/bg.ts
git commit -m "feat: add one-time guest-data import prompt; remove dead Supabase words client"
```

---

## Task 23: Demo account seed script

**Files:**

- Create: `backend/scripts/__init__.py`, `backend/scripts/seed_demo_account.py`
- Test: `backend/tests/integration/test_seed_demo_account.py`

**Interfaces:**

- Produces: `seed_demo_data(session_factory, user_id: uuid.UUID) -> None` — idempotent (no-op if the user already has a dictionary), pure DB logic, fully tested. `ensure_demo_auth_user(settings, service_role_key) -> uuid.UUID` — calls the Supabase Admin API to find-or-create the demo auth user; this is thin I/O glue against a real external service and is **not** unit tested here (no `respx`/similar HTTP-mocking dependency exists in this project yet, and adding one for a single manually-run script isn't justified) — it's exercised manually against a real Supabase project per the README note added below, the same way `JwtVerifier.ensure_jwks_reachable` already documents itself as a dependency check rather than something covered by the test suite.

- [ ] **Step 1: Write the failing test for the DB half**

```python
# backend/tests/integration/test_seed_demo_account.py
from sqlalchemy import select

from app.models import Dictionary, Word
from scripts.seed_demo_account import seed_demo_data
from tests.factories import create_dictionary, create_user


async def test_seed_demo_data_creates_dictionary_and_words(db_session, _migrated_database):
    from app.config import Settings
    from app.db import make_engine, make_session_factory

    user_id = await create_user(db_session)
    await db_session.commit()

    settings = Settings(database_url=_migrated_database, supabase_url="https://example.supabase.co")  # type: ignore[arg-type]
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)

    await seed_demo_data(session_factory, user_id)

    async with session_factory() as verify_session:
        dictionary = await verify_session.scalar(
            select(Dictionary).where(Dictionary.user_id == user_id)
        )
        assert dictionary is not None
        assert dictionary.is_default is True

        words = list(
            await verify_session.scalars(select(Word).where(Word.dictionary_id == dictionary.id))
        )
        assert len(words) == 5

    await engine.dispose()


async def test_seed_demo_data_is_idempotent(db_session, _migrated_database):
    from app.config import Settings
    from app.db import make_engine, make_session_factory

    user_id = await create_user(db_session)
    await create_dictionary(db_session, user_id, name="Already Here")
    await db_session.commit()

    settings = Settings(database_url=_migrated_database, supabase_url="https://example.supabase.co")  # type: ignore[arg-type]
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)

    await seed_demo_data(session_factory, user_id)  # should no-op, not add a second dictionary

    async with session_factory() as verify_session:
        dictionaries = list(
            await verify_session.scalars(select(Dictionary).where(Dictionary.user_id == user_id))
        )
        assert len(dictionaries) == 1

    await engine.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/integration/test_seed_demo_account.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts'`

- [ ] **Step 3: Write the script**

```python
# backend/scripts/__init__.py
```

```python
# backend/scripts/seed_demo_account.py
"""Idempotent demo-account seeder. Run manually:

    cd backend && python -m scripts.seed_demo_account

Requires SUPABASE_SERVICE_ROLE_KEY and DEMO_ACCOUNT_PASSWORD in the
environment. The service role key is never used by the running API service
itself (see docs/architecture/v2-plan.md §J) -- this script is a one-off,
run locally or from a deploy hook, never from request-handling code.
"""

import asyncio
import os
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.models import Dictionary, Word

DEMO_EMAIL = "demo@smartdict.app"

_DEMO_WORDS = [
    ("ubiquitous", "present, appearing, or found everywhere", "adjective"),
    ("ephemeral", "lasting for a very short time", "adjective"),
    ("serendipity", "a happy accident", "noun"),
    ("meticulous", "showing great attention to detail", "adjective"),
    ("candid", "truthful and straightforward", "adjective"),
]


async def ensure_demo_auth_user(supabase_url: str, service_role_key: str) -> uuid.UUID:
    password = os.environ["DEMO_ACCOUNT_PASSWORD"]
    headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}

    async with httpx.AsyncClient(base_url=f"{supabase_url}/auth/v1/admin") as client:
        existing = await client.get("/users", headers=headers, params={"email": DEMO_EMAIL})
        existing.raise_for_status()
        users = existing.json().get("users", [])
        if users:
            return uuid.UUID(users[0]["id"])

        created = await client.post(
            "/users",
            headers=headers,
            json={"email": DEMO_EMAIL, "password": password, "email_confirm": True},
        )
        created.raise_for_status()
        return uuid.UUID(created.json()["id"])


async def seed_demo_data(
    session_factory: async_sessionmaker,  # type: ignore[type-arg]
    user_id: uuid.UUID,
) -> None:
    async with session_factory() as session:
        existing = await session.scalar(select(Dictionary).where(Dictionary.user_id == user_id))
        if existing is not None:
            return

        async with session.begin():
            dictionary = Dictionary(user_id=user_id, name="Demo Vocabulary", is_default=True)
            session.add(dictionary)
            await session.flush()

            for word, definition, part_of_speech in _DEMO_WORDS:
                session.add(
                    Word(
                        dictionary_id=dictionary.id,
                        user_id=user_id,
                        word=word,
                        definition=definition,
                        part_of_speech=part_of_speech,
                    )
                )


async def main() -> None:
    settings = get_settings()
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    user_id = await ensure_demo_auth_user(str(settings.supabase_url), service_role_key)

    engine = make_engine(settings)
    session_factory = make_session_factory(engine)
    await seed_demo_data(session_factory, user_id)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/integration/test_seed_demo_account.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend suite one final time**

Run: `cd backend && pytest -v`
Expected: PASS (every test from Tasks 1-23)

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/__init__.py backend/scripts/seed_demo_account.py backend/tests/integration/test_seed_demo_account.py
git commit -m "feat: add idempotent demo account seed script"
```
