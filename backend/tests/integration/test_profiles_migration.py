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
    import pytest
    from sqlalchemy.exc import IntegrityError

    user_id = await create_user(db_session)
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "insert into public.profiles (user_id, daily_new_limit) "
                "values (:user_id, 101)"
            ),
            {"user_id": user_id},
        )
