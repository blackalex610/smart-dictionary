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

    async def create_word(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Word:
        count = await self._repo.count_for_user(user_id)
        if count >= MAX_WORDS_PER_USER:
            raise WordLimitReachedError(f"This account is limited to {MAX_WORDS_PER_USER} words.")
        try:
            # SAVEPOINT: a unique-violation here must leave the surrounding
            # transaction usable, since the error handler still has to read
            # from this session to render the response.
            async with self._session.begin_nested():
                return await self._repo.create(dictionary_id, user_id, **fields)  # type: ignore[arg-type]
        except IntegrityError as exc:
            raise DuplicateWordError("This word already exists in this dictionary.") from exc

    async def update_word(
        self, word_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Word | None:
        try:
            async with self._session.begin_nested():
                return await self._repo.update(word_id, user_id, **fields)
        except IntegrityError as exc:
            raise DuplicateWordError("This word already exists in this dictionary.") from exc
