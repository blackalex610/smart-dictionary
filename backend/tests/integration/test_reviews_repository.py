from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ReviewLog, WordReview
from app.repositories.reviews import ReviewRepository
from app.services.srs import GOOD
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
        await repo.apply_rating(
            word.id, user_id, GOOD, datetime.now(UTC), source="flashcard", elapsed_ms=None
        )


async def test_queue_returns_due_review_words_before_new_words(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)

    due_word = await create_word(db_session, dictionary.id, user_id, word="due")
    await set_review_state(db_session, due_word.id, due_at=now - timedelta(hours=1))

    not_due_word = await create_word(db_session, dictionary.id, user_id, word="notdue")
    await set_review_state(db_session, not_due_word.id, due_at=now + timedelta(days=5))

    await create_word(db_session, dictionary.id, user_id, word="brandnew")

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
