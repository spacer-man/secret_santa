import logging
import os
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

from configs.db import DBConfig

from .models import *  # noqa: F403 (registers all tables in SQLModel.metadata)

log = logging.getLogger(__name__)


USER_COLUMNS = (
    "email VARCHAR(254)",
    "google_id VARCHAR(64)",
    "name VARCHAR(64)",
    "notify VARCHAR(32)",
    "sessions_after TIMESTAMP WITH TIME ZONE",
    "deleted_at TIMESTAMP WITH TIME ZONE",
)
DELIVERY_COLUMNS = ("wish_erased BOOLEAN NOT NULL DEFAULT FALSE",)
EMAILCODE_COLUMNS = (
    "day_start TIMESTAMP WITH TIME ZONE",
    "day_sends INTEGER NOT NULL DEFAULT 0",
    "day_fails INTEGER NOT NULL DEFAULT 0",
)
USER_INDEXES = (
    'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_email ON "user" (email)',
    'CREATE UNIQUE INDEX IF NOT EXISTS ix_user_google_id ON "user" (google_id)',
)

MIGRATIONS = (
    'ALTER TABLE "user" ALTER COLUMN timezone TYPE VARCHAR(16)',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS language VARCHAR(8)',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES "user"(id)',
    "ALTER TABLE wish ADD COLUMN IF NOT EXISTS ball_color VARCHAR(16)",
    "ALTER TABLE wish ADD COLUMN IF NOT EXISTS ball_pattern VARCHAR(16)",
    # Several copies of one figure: the "one of each" constraint is gone
    "ALTER TABLE useritem DROP CONSTRAINT IF EXISTS useritem_user_id_item_key_key",
    # Sign in without Telegram: e-mail / Google, notification channels
    'ALTER TABLE "user" ALTER COLUMN telegram_id DROP NOT NULL',
    *(f'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS {c}' for c in USER_COLUMNS),
    *USER_INDEXES,
    *(f"ALTER TABLE emailcode ADD COLUMN IF NOT EXISTS {c}" for c in EMAILCODE_COLUMNS),
    *(f"ALTER TABLE delivery ADD COLUMN IF NOT EXISTS {c}" for c in DELIVERY_COLUMNS),
)


async def _sqlite_allow_copies(conn: AsyncConnection) -> None:
    """
    SQLite (local development) cannot drop a constraint: the table of owned items made
    before figures could be bought several times is rebuilt without "one of each"
    """
    sql = await conn.scalar(text("SELECT sql FROM sqlite_master WHERE name = 'useritem'"))
    if not sql or "UNIQUE" not in sql:
        return
    log.info("Rebuilding useritem without the unique constraint")
    await conn.execute(text("ALTER TABLE useritem RENAME TO useritem_old"))
    await conn.execute(text("DROP INDEX IF EXISTS ix_useritem_user_id"))
    await conn.run_sync(SQLModel.metadata.create_all)
    await conn.execute(
        text(
            "INSERT INTO useritem (id, user_id, item_key, pad, acquired_at) "
            "SELECT id, user_id, item_key, pad, acquired_at FROM useritem_old"
        )
    )
    await conn.execute(text("DROP TABLE useritem_old"))


async def _sqlite_user_identities(conn: AsyncConnection) -> None:
    """
    SQLite (local development): the user table made when Telegram was the only way in gets
    the new columns, and ``telegram_id`` stops being required (the table is rebuilt for it)
    """
    sql = await conn.scalar(text("SELECT sql FROM sqlite_master WHERE name = 'user'"))
    if not sql:
        return
    if "telegram_id BIGINT NOT NULL" in sql:
        log.info("Rebuilding user: telegram_id becomes optional")
        new_sql = re.sub(r'^CREATE TABLE "?user"?', "CREATE TABLE user_new", sql, count=1).replace(
            "telegram_id BIGINT NOT NULL", "telegram_id BIGINT"
        )
        await conn.execute(text(new_sql))
        await conn.execute(text('INSERT INTO user_new SELECT * FROM "user"'))
        await conn.execute(text('DROP TABLE "user"'))
        await conn.execute(text('ALTER TABLE user_new RENAME TO "user"'))
    await _sqlite_add_columns(conn, "user", USER_COLUMNS)
    await _sqlite_add_columns(conn, "emailcode", EMAILCODE_COLUMNS)
    await _sqlite_add_columns(conn, "delivery", DELIVERY_COLUMNS)
    for statement in USER_INDEXES:
        await conn.execute(text(statement))


async def _sqlite_add_columns(conn: AsyncConnection, table: str, wanted: tuple[str, ...]) -> None:
    columns = {row[1] for row in await conn.execute(text(f'PRAGMA table_info("{table}")'))}
    if not columns:
        return  # No table yet: create_all makes it whole
    for column in wanted:
        if column.split()[0] not in columns:
            await conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {column}'))


_db_url = DBConfig().url.get_secret_value()
engine = create_async_engine(
    url=_db_url,
    future=True,
    # Tests share the engine between several event loops
    **(
        {"poolclass": NullPool}
        if _db_url.startswith("sqlite") or os.environ.get("DB_NULL_POOL")
        else {}
    ),
)

new_db_session = async_sessionmaker(bind=engine, autoflush=True, expire_on_commit=False)


async def drop_relations() -> None:
    async with engine.connect() as conn:
        log.warning("Dropping database relations")
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.commit()
        log.info("Successful dropped database relations")


async def setup_relations(drop_if_exist: bool = False) -> None:
    async with engine.connect() as conn:
        log.info("Starting setup relations...")

        if drop_if_exist:
            log.warning("drop_if_exist == True")
            log.debug("Dropping database relations")
            await conn.run_sync(SQLModel.metadata.drop_all)

        is_postgres = conn.dialect.name == "postgresql"
        if is_postgres:
            # Bot and API start together: let only one of them run DDL at a time
            await conn.execute(text("SELECT pg_advisory_xact_lock(20251231)"))

        if conn.dialect.name == "sqlite":
            await _sqlite_allow_copies(conn)
            await _sqlite_user_identities(conn)

        log.debug("Creating database relations")
        await conn.run_sync(SQLModel.metadata.create_all)

        if is_postgres:
            # create_all() doesn't touch existing tables, so new columns
            # of old tables are added here (idempotent)
            for statement in MIGRATIONS:
                await conn.execute(text(statement))
        await conn.commit()
        log.info("Successful created database relations")
