from sqlalchemy import Column, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# `auth.users` is owned by Supabase, not this app -- it must never be created,
# altered, or dropped by our migrations. Several models declare
# `ForeignKey("auth.users.id")`, and SQLAlchemy needs *some* Table object
# present in `Base.metadata` to resolve that reference, so this is a minimal
# stub (id column only). Alembic is told to ignore anything in the `auth`
# schema via the `include_object` hook in `alembic/env.py`.
auth_users = Table(
    "users",
    Base.metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    schema="auth",
)
