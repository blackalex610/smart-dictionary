import asyncio
from logging.config import fileConfig

from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from alembic import context
from app.config import get_settings
from app.db import make_engine
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    """Keep `auth.*` (owned by Supabase, e.g. `auth.users`) out of autogenerate
    and `alembic check` -- it exists in `Base.metadata` only so that
    `ForeignKey("auth.users.id")` columns can resolve, and must never be
    created, altered, or dropped by our migrations.

    Also excludes indexes from the comparison entirely. Indexes are managed
    exclusively in the migration files, not mirrored onto the ORM models: most
    of them are expression, partial, or GIN/trigram indexes (e.g.
    `sa.text("lower(name)")`, `sa.text("to_tsvector('simple', word || ' ' ||
    definition)")`, `postgresql_where=...`, `postgresql_using="gin"`,
    `postgresql_ops={...}`) that SQLAlchemy's ORM layer cannot faithfully
    represent as `Index(...)` objects and that Alembic's autogenerate cannot
    reliably compare (expressions render as opaque `_textual_index_element`
    objects and `postgresql_where` is compared as raw text, so whitespace,
    casts, and parenthesization all read as spurious differences). Mirroring
    them would not converge to a clean diff and risks a future autogenerate
    emitting incorrect DDL for them. The drift check this enables therefore
    covers columns, column types, and foreign keys only -- NOT indexes. Plain
    (non-index) constraints, such as unique constraints, are still compared
    normally and should be mirrored onto the models as usual."""
    if type_ == "index":
        return False
    schema = getattr(object, "schema", None)
    if schema is None and type_ == "column":
        schema = getattr(object.table, "schema", None)
    return schema != "auth"


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata, include_object=include_object
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine: AsyncEngine = make_engine(get_settings())
    async with engine.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
