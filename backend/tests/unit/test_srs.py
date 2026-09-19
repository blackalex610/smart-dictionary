import json
import pathlib
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
    # fuzz(WORD_ID) == 1.0230436838402048 (deterministic); round(10 * 2.50 * fuzz) == 26.
    # Exact, not a range: a range this wide also accepts a multiplier bug (e.g. using
    # ease - 0.15 instead of ease), since the mutated interval still lands inside it.
    assert new_state.interval == 26


def test_review_card_easy_increases_ease_and_uses_1_3x_ease_multiplier():
    review = ReviewState(word_id=WORD_ID, state="review", step=0, ease=Decimal("2.50"), interval=10)
    new_state, _due = next_state(review, EASY, NOW)
    assert new_state.ease == Decimal("2.60")
    # fuzz(WORD_ID) == 1.0230436838402048 (deterministic); ease * 1.3 == 3.380;
    # round(10 * 3.380 * fuzz) == 35. Exact, not a range -- see comment on the GOOD test.
    assert new_state.interval == 35


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
