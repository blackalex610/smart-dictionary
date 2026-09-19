import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Progress(Base):
    """Maps the pre-existing `progress` table. Superseded by
    `quiz_attempts` / `quiz_answers` in Phase 3 -- kept here only so Alembic's
    baseline reflects what is actually live today."""

    __tablename__ = "progress"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    quiz_type: Mapped[str] = mapped_column(Text)
    score: Mapped[int]
    total_questions: Mapped[int]
    percentage: Mapped[Decimal | None] = mapped_column(insert_default=None)
    words_count: Mapped[int] = mapped_column(server_default=text("0"))
    details: Mapped[dict[str, object]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
