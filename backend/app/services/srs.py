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
