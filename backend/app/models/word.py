import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Word(Base):
    __tablename__ = "words"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    dictionary_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.dictionaries.id", ondelete="CASCADE")
    )
    word: Mapped[str]
    definition: Mapped[str]
    part_of_speech: Mapped[str | None]
    # Kept until the frontend cut-over (Phase 4) stops writing it; the
    # sync_word_dictionary trigger derives dictionary_id from this column
    # when a pre-cutover client omits dictionary_id. See migration 0002.
    folder: Mapped[str | None]
    example: Mapped[str | None]
    translation: Mapped[str | None]
    notes: Mapped[str | None]
    difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    language_code: Mapped[str | None]
    source: Mapped[str] = mapped_column(server_default=text("'manual'"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    deleted_at: Mapped[datetime | None]
