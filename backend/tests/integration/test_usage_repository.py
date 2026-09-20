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
