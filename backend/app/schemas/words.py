import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import (
    DEFINITION_MAX_LENGTH,
    EXAMPLE_MAX_LENGTH,
    NOTES_MAX_LENGTH,
    TRANSLATION_MAX_LENGTH,
    WORD_MAX_LENGTH,
    WORDS_BULK_MAX_ROWS,
)


class WordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=WORD_MAX_LENGTH)
    definition: str = Field(min_length=1, max_length=DEFINITION_MAX_LENGTH)
    part_of_speech: str | None = Field(default=None)
    example: str | None = Field(default=None, max_length=EXAMPLE_MAX_LENGTH)
    translation: str | None = Field(default=None, max_length=TRANSLATION_MAX_LENGTH)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class WordUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str | None = Field(default=None, min_length=1, max_length=WORD_MAX_LENGTH)
    definition: str | None = Field(default=None, min_length=1, max_length=DEFINITION_MAX_LENGTH)
    part_of_speech: str | None = None
    example: str | None = Field(default=None, max_length=EXAMPLE_MAX_LENGTH)
    translation: str | None = Field(default=None, max_length=TRANSLATION_MAX_LENGTH)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
    difficulty: int | None = Field(default=None, ge=1, le=5)


class WordOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    dictionary_id: uuid.UUID
    word: str
    definition: str
    part_of_speech: str | None
    example: str | None
    translation: str | None
    notes: str | None
    difficulty: int | None
    created_at: datetime
    updated_at: datetime


class WordListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[WordOut]
    next_cursor: str | None
    has_more: bool


class BulkCreateWordsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[WordCreate] = Field(min_length=1, max_length=WORDS_BULK_MAX_ROWS)


class BulkCreateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: WordOut | None
    error: str | None


class BulkCreateWordsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[BulkCreateResult]


class MoveWordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dictionary_id: uuid.UUID
