import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    dictionary_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.dictionaries.id", ondelete="SET NULL")
    )
    config: Mapped[dict[str, object]] = mapped_column(JSONB)
    question_count: Mapped[int] = mapped_column(SmallInteger)
    correct_count: Mapped[int | None] = mapped_column(SmallInteger)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_generated: Mapped[bool] = mapped_column(server_default=text("false"))


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.quiz_attempts.id", ondelete="CASCADE")
    )
    word_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.words.id", ondelete="SET NULL")
    )
    position: Mapped[int] = mapped_column(SmallInteger)
    question_type: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    expected: Mapped[str] = mapped_column(Text)
    given: Mapped[str | None] = mapped_column(Text)
    is_correct: Mapped[bool | None]
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
