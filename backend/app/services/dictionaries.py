"""Enforces the single-default invariant on create (first dictionary for a
user is always the default) and translates the name-uniqueness constraint
into a field-level validation error. See docs/architecture/v2-plan.md §E."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ValidationFailedError
from app.models import Dictionary
from app.repositories.dictionaries import DictionaryRepository

_DUPLICATE_NAME_ERRORS: list[dict[str, object]] = [{"field": "name", "code": "DUPLICATE_NAME"}]


class DictionaryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = DictionaryRepository(session)

    async def create_dictionary(
        self, user_id: uuid.UUID, name: str, **fields: object
    ) -> Dictionary:
        existing = await self._repo.list_for_user(user_id)
        try:
            # SAVEPOINT: the unique(user_id, lower(name)) violation must not
            # abort the surrounding transaction -- see WordService for the
            # same reasoning.
            async with self._session.begin_nested():
                return await self._repo.create(
                    user_id,
                    name,
                    is_default=(len(existing) == 0),
                    **fields,  # type: ignore[arg-type]
                )
        except IntegrityError as exc:
            raise ValidationFailedError(
                "A dictionary with this name already exists.",
                errors=_DUPLICATE_NAME_ERRORS,
            ) from exc

    async def update_dictionary(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, **fields: object
    ) -> Dictionary | None:
        make_default = fields.pop("is_default", None)
        dictionary: Dictionary | None = None

        if make_default:
            dictionary = await self._repo.set_default(dictionary_id, user_id)
            if dictionary is None:
                return None

        remaining = {k: v for k, v in fields.items() if v is not None}
        if remaining:
            try:
                async with self._session.begin_nested():
                    dictionary = await self._repo.update(dictionary_id, user_id, **remaining)
            except IntegrityError as exc:
                raise ValidationFailedError(
                    "A dictionary with this name already exists.",
                    errors=_DUPLICATE_NAME_ERRORS,
                ) from exc

        if dictionary is not None:
            return dictionary
        return await self._repo.get(dictionary_id, user_id)
