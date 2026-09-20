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
