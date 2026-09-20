import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UsageDaily


class UsageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_reviews_done(self, user_id: uuid.UUID, usage_date: date) -> int:
        row = await self._session.get(UsageDaily, {"user_id": user_id, "usage_date": usage_date})
        return row.reviews_done if row is not None else 0

    async def increment_reviews_done(self, user_id: uuid.UUID, usage_date: date) -> None:
        row = await self._session.get(UsageDaily, {"user_id": user_id, "usage_date": usage_date})
        if row is None:
            self._session.add(UsageDaily(user_id=user_id, usage_date=usage_date, reviews_done=1))
        else:
            row.reviews_done += 1
        await self._session.flush()
