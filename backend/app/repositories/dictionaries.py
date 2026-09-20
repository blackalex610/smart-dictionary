import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Dictionary, Word, WordReview


class DictionaryRepository:
    """The only place dictionaries SQL is written. Every query filters out
    soft-deleted rows and scopes to the owning user -- see
    docs/architecture/v2-plan.md §H."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        user_id: uuid.UUID,
        name: str,
        *,
        language_code: str | None = None,
        description: str | None = None,
        is_default: bool = False,
    ) -> Dictionary:
        dictionary = Dictionary(
            user_id=user_id,
            name=name,
            language_code=language_code,
            description=description,
            is_default=is_default,
        )
        self._session.add(dictionary)
        await self._session.flush()
        return dictionary

    async def get(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> Dictionary | None:
        result: Dictionary | None = await self._session.scalar(
            select(Dictionary).where(
                Dictionary.id == dictionary_id,
                Dictionary.user_id == user_id,
                Dictionary.deleted_at.is_(None),
            )
        )
        return result

    async def list_for_user(self, user_id: uuid.UUID) -> list[Dictionary]:
        result = await self._session.scalars(
            select(Dictionary)
            .where(Dictionary.user_id == user_id, Dictionary.deleted_at.is_(None))
            .order_by(Dictionary.created_at)
        )
        return list(result)

    async def soft_delete(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        dictionary = await self.get(dictionary_id, user_id)
        if dictionary is None:
            return False
        dictionary.deleted_at = datetime.now(UTC)
        await self._session.flush()
        return True

    async def update(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Dictionary | None:
        dictionary = await self.get(dictionary_id, user_id)
        if dictionary is None:
            return None
        for key, value in fields.items():
            setattr(dictionary, key, value)
        await self._session.flush()
        return dictionary

    async def set_default(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID
    ) -> Dictionary | None:
        target = await self.get(dictionary_id, user_id)
        if target is None:
            return None

        current_default = await self._session.scalar(
            select(Dictionary).where(
                Dictionary.user_id == user_id,
                Dictionary.is_default.is_(True),
                Dictionary.deleted_at.is_(None),
            )
        )
        if current_default is not None and current_default.id != target.id:
            current_default.is_default = False
            await self._session.flush()

        target.is_default = True
        await self._session.flush()
        return target

    async def counts_for(self, dictionary_id: uuid.UUID) -> tuple[int, int]:
        word_count = await self._session.scalar(
            select(func.count())
            .select_from(Word)
            .where(Word.dictionary_id == dictionary_id, Word.deleted_at.is_(None))
        )
        due_count = await self._session.scalar(
            select(func.count())
            .select_from(Word)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                Word.dictionary_id == dictionary_id,
                Word.deleted_at.is_(None),
                WordReview.state != "new",
                WordReview.due_at <= func.now(),
            )
        )
        return word_count or 0, due_count or 0
