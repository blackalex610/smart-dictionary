import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UsageDaily(Base):
    __tablename__ = "usage_daily"
    __table_args__ = {"schema": "public"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True
    )
    usage_date: Mapped[date] = mapped_column(
        Date, primary_key=True, server_default=text("current_date")
    )
    ai_requests: Mapped[int] = mapped_column(server_default=text("0"))
    # `daily_limit` is dead data (the quota RPCs hardcode 10) but is still an
    # insert target inside consume_ai_request_quota(), which stays live until
    # Phase 6 replaces it with AiService. Dropping the column now would break
    # that RPC before its replacement exists, so it's kept -- same
    # expand/contract reasoning as `words.folder` and `progress` (see
    # migrations 0002 and 0004).
    daily_limit: Mapped[int] = mapped_column(server_default=text("50"))
    ai_input_tokens: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    ai_output_tokens: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    ai_cost_usd: Mapped[Decimal] = mapped_column(server_default=text("0"))
    reviews_done: Mapped[int] = mapped_column(server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
