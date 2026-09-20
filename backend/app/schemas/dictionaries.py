import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.constants import DICTIONARY_NAME_MAX_LENGTH


class DictionaryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=DICTIONARY_NAME_MAX_LENGTH)
    language_code: str | None = None
    description: str | None = None


class DictionaryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=DICTIONARY_NAME_MAX_LENGTH)
    language_code: str | None = None
    description: str | None = None
    is_default: bool | None = None


class DictionaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    name: str
    language_code: str | None
    description: str | None
    is_default: bool
    word_count: int
    due_count: int
    created_at: datetime
    updated_at: datetime


class DictionaryListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DictionaryOut]
