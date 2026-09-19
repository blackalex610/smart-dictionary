import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Word


class WordRepository:
    """The only place words SQL is written. Every query scopes to the owning
    user and filters out soft-deleted rows -- a dictionary id reaching a
    handler from a URL is caller-supplied, so it can never be the only
    predicate. Keyset pagination, search and filters are added in Phase 4
    once the API that needs them exists -- see docs/architecture/v2-plan.md §F."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        dictionary_id: uuid.UUID,
        user_id: uuid.UUID,
        word: str,
        definition: str,
        *,
        part_of_speech: str | None = None,
        example: str | None = None,
        translation: str | None = None,
    ) -> Word:
        row = Word(
            dictionary_id=dictionary_id,
            user_id=user_id,
            word=word,
            definition=definition,
            part_of_speech=part_of_speech,
            example=example,
            translation=translation,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def get(self, word_id: uuid.UUID, user_id: uuid.UUID) -> Word | None:
        result: Word | None = await self._session.scalar(
            select(Word).where(
                Word.id == word_id, Word.user_id == user_id, Word.deleted_at.is_(None)
            )
        )
        return result

    async def list_for_dictionary(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> list[Word]:
        result = await self._session.scalars(
            select(Word)
            .where(
                Word.dictionary_id == dictionary_id,
                Word.user_id == user_id,
                Word.deleted_at.is_(None),
            )
            .order_by(Word.created_at.desc(), Word.id)
        )
        return list(result)

    async def soft_delete(self, word_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        word = await self.get(word_id, user_id)
        if word is None:
            return False
        word.deleted_at = datetime.now(UTC)
        await self._session.flush()
        return True
