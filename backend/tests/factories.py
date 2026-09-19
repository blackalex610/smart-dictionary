"""Minimal test data builders for integration tests. Not factory_boy --
there's no need for randomised/traited factories yet with this few entities,
and a dependency earns its place when the plain version gets unwieldy."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Dictionary, Word


async def create_user(session: AsyncSession, *, email: str = "test@example.com") -> uuid.UUID:
    user_id = uuid.uuid4()
    await session.execute(
        text("insert into auth.users (id, email) values (:id, :email)"),
        {"id": user_id, "email": email},
    )
    return user_id


async def create_dictionary(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str = "Test Dictionary",
    is_default: bool = False,
) -> Dictionary:
    dictionary = Dictionary(user_id=user_id, name=name, is_default=is_default)
    session.add(dictionary)
    await session.flush()
    return dictionary


async def create_word(
    session: AsyncSession,
    dictionary_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    word: str = "ubiquitous",
    definition: str = "present, appearing, or found everywhere",
    part_of_speech: str | None = "adjective",
) -> Word:
    row = Word(
        dictionary_id=dictionary_id,
        user_id=user_id,
        word=word,
        definition=definition,
        part_of_speech=part_of_speech,
    )
    session.add(row)
    await session.flush()
    return row
