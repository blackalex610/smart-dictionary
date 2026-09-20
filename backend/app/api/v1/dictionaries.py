import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_session
from app.errors import NotFoundError, UnauthenticatedError
from app.models import Dictionary
from app.repositories.dictionaries import DictionaryRepository
from app.schemas.dictionaries import (
    DictionaryCreate,
    DictionaryListResponse,
    DictionaryOut,
    DictionaryUpdate,
)
from app.security.jwt import VerifiedUser
from app.services.dictionaries import DictionaryService

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    try:
        return uuid.UUID(user.user_id)
    except ValueError as exc:
        raise UnauthenticatedError("Token subject is not a valid user id") from exc


async def _to_out(repo: DictionaryRepository, dictionary: Dictionary) -> DictionaryOut:
    word_count, due_count = await repo.counts_for(dictionary.id)
    return DictionaryOut(
        id=dictionary.id,
        name=dictionary.name,
        language_code=dictionary.language_code,
        description=dictionary.description,
        is_default=dictionary.is_default,
        word_count=word_count,
        due_count=due_count,
        created_at=dictionary.created_at,
        updated_at=dictionary.updated_at,
    )


@router.get("", response_model=DictionaryListResponse)
async def list_dictionaries(
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryListResponse:
    user_id = _parse_user_id(user)
    repo = DictionaryRepository(session)
    dictionaries = await repo.list_for_user(user_id)
    return DictionaryListResponse(items=[await _to_out(repo, d) for d in dictionaries])


@router.post("", response_model=DictionaryOut, status_code=status.HTTP_201_CREATED)
async def create_dictionary(
    body: DictionaryCreate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    dictionary = await DictionaryService(session).create_dictionary(user_id, **body.model_dump())
    return await _to_out(DictionaryRepository(session), dictionary)


@router.get("/{dictionary_id}", response_model=DictionaryOut)
async def get_dictionary(
    dictionary_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    repo = DictionaryRepository(session)
    dictionary = await repo.get(dictionary_id, user_id)
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return await _to_out(repo, dictionary)


@router.patch("/{dictionary_id}", response_model=DictionaryOut)
async def update_dictionary(
    dictionary_id: uuid.UUID,
    body: DictionaryUpdate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DictionaryOut:
    user_id = _parse_user_id(user)
    dictionary = await DictionaryService(session).update_dictionary(
        dictionary_id, user_id, **body.model_dump(exclude_unset=True)
    )
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return await _to_out(DictionaryRepository(session), dictionary)


@router.delete("/{dictionary_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dictionary(
    dictionary_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    user_id = _parse_user_id(user)
    deleted = await DictionaryRepository(session).soft_delete(dictionary_id, user_id)
    if not deleted:
        raise NotFoundError("Dictionary not found")
