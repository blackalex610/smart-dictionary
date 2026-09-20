import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReviewQueueItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    word: str
    definition: str
    part_of_speech: str | None
    example: str | None
    state: str
    due_at: datetime | None


class ReviewQueueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ReviewQueueItem]


class SubmitReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    rating: int = Field(ge=1, le=4)
    elapsed_ms: int | None = Field(default=None, ge=0, le=600_000)
    source: Literal["flashcard"] = "flashcard"


class SubmitReviewResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: uuid.UUID
    state: str
    ease_factor: Decimal
    interval_days: int
    due_at: datetime


class ForecastDay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    due_count: int


class ForecastResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: list[ForecastDay]
