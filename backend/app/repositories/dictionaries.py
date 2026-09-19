import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Dictionary


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
    ) -> Dictionary:
        dictionary = Dictionary(
            user_id=user_id, name=name, language_code=language_code, description=description
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
