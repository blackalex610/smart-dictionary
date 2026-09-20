import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REVIEWS_FORECAST_MAX_DAYS
from app.deps import get_current_user, get_session
from app.errors import NotFoundError, UnauthenticatedError
from app.models import Profile
from app.repositories.reviews import ReviewRepository
from app.repositories.usage import UsageRepository
from app.schemas.reviews import (
    ForecastDay,
    ForecastResponse,
    ReviewQueueItem,
    ReviewQueueResponse,
    SubmitReviewRequest,
    SubmitReviewResponse,
)
from app.security.jwt import VerifiedUser
from app.services.daytime import local_today

router = APIRouter(prefix="/reviews", tags=["reviews"])


def _parse_user_id(user: VerifiedUser) -> uuid.UUID:
    try:
        return uuid.UUID(user.user_id)
    except ValueError as exc:
        raise UnauthenticatedError("Token subject is not a valid user id") from exc


async def _get_profile_or_404(session: AsyncSession, user_id: uuid.UUID) -> Profile:
    profile = await session.scalar(select(Profile).where(Profile.user_id == user_id))
    if profile is None:
        raise NotFoundError("Profile not found")
    return profile


@router.get("/queue", response_model=ReviewQueueResponse)
async def get_queue(
    dictionary_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewQueueResponse:
    user_id = _parse_user_id(user)
    profile = await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)
    today = local_today(profile.timezone, now)

    reviews_done = await UsageRepository(session).get_reviews_done(user_id, today)
    review_cap = min(max(0, profile.daily_review_limit - reviews_done), limit)
    new_cap = min(profile.daily_new_limit, limit)

    rows = await ReviewRepository(session).queue(
        user_id, dictionary_id=dictionary_id, new_cap=new_cap, review_cap=review_cap, now=now
    )
    return ReviewQueueResponse(
        items=[
            ReviewQueueItem(
                word_id=word.id,
                word=word.word,
                definition=word.definition,
                part_of_speech=word.part_of_speech,
                example=word.example,
                state=review.state,
                due_at=review.due_at,
            )
            for word, review in rows
        ]
    )


@router.post("", response_model=SubmitReviewResponse, status_code=201)
async def submit_review(
    body: SubmitReviewRequest,
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmitReviewResponse:
    user_id = _parse_user_id(user)
    profile = await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)

    try:
        new_state, due_at = await ReviewRepository(session).apply_rating(
            body.word_id,
            user_id,
            body.rating,
            now,
            source=body.source,
            elapsed_ms=body.elapsed_ms,
        )
    except LookupError as exc:
        raise NotFoundError("Word not found") from exc

    today = local_today(profile.timezone, now)
    await UsageRepository(session).increment_reviews_done(user_id, today)

    return SubmitReviewResponse(
        word_id=body.word_id,
        state=new_state.state,
        ease_factor=new_state.ease,
        interval_days=new_state.interval,
        due_at=due_at,
    )


@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast(
    days: int = Query(default=14, ge=1, le=REVIEWS_FORECAST_MAX_DAYS),
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ForecastResponse:
    user_id = _parse_user_id(user)
    await _get_profile_or_404(session, user_id)
    now = datetime.now(UTC)

    counts = await ReviewRepository(session).forecast(user_id, days=days, now=now)
    return ForecastResponse(
        days=[ForecastDay(date=d, due_count=c) for d, c in sorted(counts.items())]
    )
