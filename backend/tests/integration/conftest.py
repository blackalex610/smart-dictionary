"""Integration tests run against a real Postgres so schema, triggers and RLS
policies are exercised the way `tsc --noEmit`-style unit tests never could.

Supabase's `auth` schema (the FK target for every user-owned table, and the
source of `auth.uid()` for RLS policies) isn't something a plain Postgres
container has -- it's provisioned by Supabase itself. `_prepare_auth_schema`
below stands in a minimal version of it: a `users` table for FKs and a
`uid()` function reading the same GUC PostgREST sets from the JWT, so
`create policy ... using (auth.uid() = user_id)` resolves and RLS can
actually be exercised with `set local request.jwt.claim.sub = '<uuid>'`.

If DATABASE_URL doesn't point at a reachable Postgres (no local Docker, no
CI service container), the whole suite is skipped rather than failed --
this mirrors how the frontend's Playwright suite is skipped without a
running app.
"""

import os
from collections.abc import AsyncGenerator

import asyncpg
import pytest
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncSession

from alembic import command
from app.config import Settings
from app.db import make_engine, make_session_factory

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _asyncpg_dsn(database_url: str) -> str:
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _prepare_auth_schema(dsn: str) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute("create extension if not exists pgcrypto")
        await conn.execute("create schema if not exists auth")
        await conn.execute(
            """
            create table if not exists auth.users (
                id uuid primary key default gen_random_uuid(),
                email text
            )
            """
        )
        await conn.execute(
            """
            create or replace function auth.uid() returns uuid
            language sql stable
            as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$
            """
        )
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def integration_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith("postgresql+asyncpg://"):
        pytest.skip("DATABASE_URL is not set to a real Postgres instance")
    return url


@pytest.fixture(scope="session")
def _migrated_database(integration_database_url: str) -> str:
    import asyncio

    try:
        asyncio.run(_prepare_auth_schema(_asyncpg_dsn(integration_database_url)))
    except (OSError, asyncpg.PostgresError) as exc:
        pytest.skip(f"Could not reach Postgres at DATABASE_URL: {exc}")

    alembic_cfg = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    alembic_cfg.set_main_option("script_location", os.path.join(BACKEND_ROOT, "alembic"))
    command.upgrade(alembic_cfg, "head")
    return integration_database_url


@pytest.fixture
async def db_session(_migrated_database: str) -> AsyncGenerator[AsyncSession, None]:
    """One session per test, wrapped in a transaction that is always rolled
    back -- tests never see each other's data and never need manual cleanup."""
    settings = Settings(database_url=_migrated_database, supabase_url="https://example.supabase.co")  # type: ignore[arg-type]
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)

    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = session_factory(bind=connection, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()

    await engine.dispose()
