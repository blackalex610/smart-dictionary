import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WordReview(Base):
    """SRS state for one word. One row per word, created by a trigger on
    `words` insert (migration 0003) so a word always has review state."""

    __tablename__ = "word_reviews"
    __table_args__ = {"schema": "public"}

    word_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.words.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    state: Mapped[str] = mapped_column(server_default=text("'new'"))
    ease_factor: Mapped[Decimal] = mapped_column(server_default=text("2.50"))
    interval_days: Mapped[int] = mapped_column(server_default=text("0"))
    repetitions: Mapped[int] = mapped_column(server_default=text("0"))
    lapses: Mapped[int] = mapped_column(server_default=text("0"))
    due_at: Mapped[datetime | None]
    last_reviewed_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
