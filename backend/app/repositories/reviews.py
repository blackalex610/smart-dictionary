import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReviewLog, Word, WordReview
from app.services.srs import AGAIN, ReviewState, next_state


def _to_domain(review: WordReview) -> ReviewState:
    return ReviewState(
        word_id=str(review.word_id),
        state=review.state,  # type: ignore[arg-type]
        step=review.repetitions if review.state != "review" else 0,
        ease=review.ease_factor,
        interval=review.interval_days,
    )


class ReviewRepository:
    """The only place word_reviews/review_log SQL is written -- see
    docs/architecture/v2-plan.md §H."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_state(self, word_id: uuid.UUID, user_id: uuid.UUID) -> ReviewState | None:
        review = await self._session.scalar(
            select(WordReview)
            .join(Word, Word.id == WordReview.word_id)
            .where(
                WordReview.word_id == word_id,
                WordReview.user_id == user_id,
                Word.deleted_at.is_(None),
            )
        )
        return _to_domain(review) if review is not None else None

    async def apply_rating(
        self,
        word_id: uuid.UUID,
        user_id: uuid.UUID,
        rating: int,
        now: datetime,
        *,
        source: str,
        elapsed_ms: int | None,
    ) -> tuple[ReviewState, datetime]:
        review = await self._session.scalar(
            select(WordReview)
            .join(Word, Word.id == WordReview.word_id)
            .where(
                WordReview.word_id == word_id,
                WordReview.user_id == user_id,
                Word.deleted_at.is_(None),
            )
        )
        if review is None:
            raise LookupError(f"No word_reviews row for word_id={word_id}, user_id={user_id}")

        before = _to_domain(review)
        after, due_at = next_state(before, rating, now)

        self._session.add(
            ReviewLog(
                word_id=word_id,
                user_id=user_id,
                rating=rating,
                reviewed_at=now,
                interval_before=before.interval,
                interval_after=after.interval,
                ease_before=before.ease,
                ease_after=after.ease,
                elapsed_ms=elapsed_ms,
                source=source,
            )
        )

        review.state = after.state
        review.ease_factor = after.ease
        review.interval_days = after.interval
        review.repetitions = after.step
        if rating == AGAIN:
            review.lapses += 1 if before.state == "review" else 0
        review.due_at = due_at
        review.last_reviewed_at = now
        await self._session.flush()
        return after, due_at

    async def queue(
        self,
        user_id: uuid.UUID,
        *,
        dictionary_id: uuid.UUID | None,
        new_cap: int,
        review_cap: int,
        now: datetime,
    ) -> list[tuple[Word, WordReview]]:
        due_stmt = (
            select(Word, WordReview)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state != "new",
                WordReview.due_at <= now,
                Word.deleted_at.is_(None),
            )
            .order_by(WordReview.due_at)
            .limit(review_cap)
        )
        new_stmt = (
            select(Word, WordReview)
            .join(WordReview, WordReview.word_id == Word.id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state == "new",
                Word.deleted_at.is_(None),
            )
            .order_by(Word.created_at)
            .limit(new_cap)
        )
        if dictionary_id is not None:
            due_stmt = due_stmt.where(Word.dictionary_id == dictionary_id)
            new_stmt = new_stmt.where(Word.dictionary_id == dictionary_id)

        due_rows = list(await self._session.execute(due_stmt))
        new_rows = list(await self._session.execute(new_stmt))
        return [(w, r) for w, r in due_rows] + [(w, r) for w, r in new_rows]

    async def forecast(self, user_id: uuid.UUID, *, days: int, now: datetime) -> dict[date, int]:
        horizon = now + timedelta(days=days)
        rows = await self._session.execute(
            select(func.date(WordReview.due_at), func.count())
            .join(Word, Word.id == WordReview.word_id)
            .where(
                WordReview.user_id == user_id,
                WordReview.state != "new",
                WordReview.due_at >= now,
                WordReview.due_at <= horizon,
                Word.deleted_at.is_(None),
            )
            .group_by(func.date(WordReview.due_at))
        )
        counts = {row[0]: row[1] for row in rows}
        return {
            (now + timedelta(days=i)).date(): counts.get((now + timedelta(days=i)).date(), 0)
            for i in range(days + 1)
        }
