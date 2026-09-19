import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ReviewLog(Base):
    """Append-only audit trail of every review rating. Never updated or
    deleted except by user cascade -- this is what makes retention and
    streak metrics honest (see docs/architecture/v2-plan.md §E)."""

    __tablename__ = "review_log"
    __table_args__ = {"schema": "public"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    word_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.words.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE")
    )
    rating: Mapped[int] = mapped_column(SmallInteger)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    interval_before: Mapped[int | None]
    interval_after: Mapped[int | None]
    ease_before: Mapped[Decimal | None]
    ease_after: Mapped[Decimal | None]
    elapsed_ms: Mapped[int | None]
    source: Mapped[str] = mapped_column(Text)
