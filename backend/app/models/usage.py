import uuid
from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, text
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
    daily_limit: Mapped[int] = mapped_column(server_default=text("50"))
    updated_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
