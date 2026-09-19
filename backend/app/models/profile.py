import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    tier: Mapped[str] = mapped_column(Text, server_default=text("'free'"))
    locale: Mapped[str] = mapped_column(Text, server_default=text("'bg'"))
    timezone: Mapped[str] = mapped_column(Text, server_default=text("'Europe/Sofia'"))
    daily_new_limit: Mapped[int] = mapped_column(SmallInteger, server_default=text("10"))
    daily_review_limit: Mapped[int] = mapped_column(SmallInteger, server_default=text("100"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
