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
        found = await verify_session.scalar(
            select(Dictionary).where(Dictionary.name == "Committed")
        )
        assert found is not None

    await engine.dispose()
