import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AiRequest(Base):
    """Cost and reliability ledger. No prompt or completion text is ever
    stored here -- only what's needed to answer "what did this cost and did
    it work" (see docs/architecture/v2-plan.md §M)."""

    __tablename__ = "ai_requests"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="SET NULL")
    )
    kind: Mapped[str]
    model: Mapped[str]
    prompt_version: Mapped[str]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cost_usd: Mapped[Decimal | None]
    latency_ms: Mapped[int | None]
    status: Mapped[str]
    cache_hit: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class AiCache(Base):
    """Only populated for user-independent inputs (distractors, examples,
    explanations) -- never chat, import structuring, or anything containing
    user notes. See docs/architecture/v2-plan.md §E."""

    __tablename__ = "ai_cache"
    __table_args__ = {"schema": "public"}

    cache_key: Mapped[str] = mapped_column(primary_key=True)
    response: Mapped[dict[str, object]] = mapped_column(JSONB)
    hit_count: Mapped[int] = mapped_column(server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    expires_at: Mapped[datetime]
