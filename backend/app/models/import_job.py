import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ImportJob(Base):
    """Uploaded file bytes are never persisted -- only the parsed preview
    rows, expiring after an hour. See docs/architecture/v2-plan.md §E/§J."""

    __tablename__ = "import_jobs"
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
    filename: Mapped[str | None]
    content_type: Mapped[str | None]
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str]
    rows: Mapped[list[object] | None] = mapped_column(JSONB)
    row_count: Mapped[int | None]
    error_code: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    expires_at: Mapped[datetime] = mapped_column(server_default=text("now() + interval '1 hour'"))
