import uuid
from typing import cast

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_session
from app.errors import NotFoundError, UnauthenticatedError
from app.models import Dictionary, Word
from app.repositories.dictionaries import DictionaryRepository
from app.repositories.words import WordRepository
from app.schemas.words import (
    BulkCreateResult,
    BulkCreateWordsRequest,
    BulkCreateWordsResponse,
    MoveWordRequest,
    WordCreate,
    WordListResponse,
    WordOut,
    WordUpdate,
)
from app.security.jwt import VerifiedUser
from app.services.words import WordService

router = APIRouter(tags=["words"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    try:
        return uuid.UUID(user.user_id)
    except ValueError as exc:
        raise UnauthenticatedError("Token subject is not a valid user id") from exc


async def _dictionary_or_404(
    session: AsyncSession, dictionary_id: uuid.UUID, user_id: uuid.UUID
) -> Dictionary:
    dictionary = await DictionaryRepository(session).get(dictionary_id, user_id)
    if dictionary is None:
        raise NotFoundError("Dictionary not found")
    return dictionary


@router.get("/dictionaries/{dictionary_id}/words", response_model=WordListResponse)
async def list_words(
    dictionary_id: uuid.UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    q: str | None = None,
    pos: str | None = None,
    difficulty: int | None = Query(default=None, ge=1, le=5),
    state: str | None = None,
    sort: str = Query(default="created", pattern="^(created|alpha)$"),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordListResponse:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    items, next_cursor, has_more = await WordRepository(session).list_page(
        dictionary_id,
        cursor=cursor,
        limit=limit,
        q=q,
        part_of_speech=pos,
        difficulty=difficulty,
        state=state,
        sort=sort,
    )
    return WordListResponse(
        items=[WordOut.model_validate(w, from_attributes=True) for w in items],
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.post(
    "/dictionaries/{dictionary_id}/words",
    response_model=WordOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_word(
    dictionary_id: uuid.UUID,
    body: WordCreate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    word = await WordService(session).create_word(dictionary_id, user_id, **body.model_dump())
    return WordOut.model_validate(word, from_attributes=True)


@router.post(
    "/dictionaries/{dictionary_id}/words:bulk",
    response_model=BulkCreateWordsResponse,
)
async def bulk_create_words(
    dictionary_id: uuid.UUID,
    body: BulkCreateWordsRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BulkCreateWordsResponse:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, dictionary_id, user_id)

    rows = [cast(dict[str, object], row.model_dump()) for row in body.rows]
    results = await WordRepository(session).bulk_create(dictionary_id, user_id, rows)
    return BulkCreateWordsResponse(
        results=[
            BulkCreateResult(
                word=(
                    WordOut.model_validate(cast(Word, r["word"]), from_attributes=True)
                    if r["word"] is not None
                    else None
                ),
                error=cast(str | None, r["error"]),
            )
            for r in results
        ]
    )


@router.get("/words/{word_id}", response_model=WordOut)
async def get_word(
    word_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    word = await WordRepository(session).get(word_id, user_id)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)


@router.patch("/words/{word_id}", response_model=WordOut)
async def update_word(
    word_id: uuid.UUID,
    body: WordUpdate,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    word = await WordService(session).update_word(word_id, user_id, **fields)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)


@router.delete("/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word(
    word_id: uuid.UUID,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    user_id = _parse_user_id(user)
    deleted = await WordRepository(session).soft_delete(word_id, user_id)
    if not deleted:
        raise NotFoundError("Word not found")


@router.post("/words/{word_id}:move", response_model=WordOut)
async def move_word(
    word_id: uuid.UUID,
    body: MoveWordRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WordOut:
    user_id = _parse_user_id(user)
    await _dictionary_or_404(session, body.dictionary_id, user_id)

    word = await WordRepository(session).move(word_id, user_id, body.dictionary_id)
    if word is None:
        raise NotFoundError("Word not found")
    return WordOut.model_validate(word, from_attributes=True)
