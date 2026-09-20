"""Idempotent demo-account seeder. Run manually:

    cd backend && python -m scripts.seed_demo_account

Requires SUPABASE_SERVICE_ROLE_KEY and DEMO_ACCOUNT_PASSWORD in the
environment. The service role key is never used by the running API service
itself (see docs/architecture/v2-plan.md §J) -- this script is a one-off,
run locally or from a deploy hook, never from request-handling code.

`ensure_demo_auth_user` is thin I/O glue against the real Supabase Admin
API and is exercised manually rather than by the test suite; `seed_demo_data`
is pure DB logic and is covered by tests/integration/test_seed_demo_account.py.
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
