import logging
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

from configs.db import DBConfig

from .models import *  # noqa: F403 (registers all tables in SQLModel.metadata)

log = logging.getLogger(__name__)


MIGRATIONS = (
    'ALTER TABLE "user" ALTER COLUMN timezone TYPE VARCHAR(16)',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS language VARCHAR(8)',
    'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES "user"(id)',
    "ALTER TABLE wish ADD COLUMN IF NOT EXISTS ball_color VARCHAR(16)",
    "ALTER TABLE wish ADD COLUMN IF NOT EXISTS ball_pattern VARCHAR(16)",
)


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

        log.debug("Creating database relations")
        await conn.run_sync(SQLModel.metadata.create_all)

        if is_postgres:
            # create_all() doesn't touch existing tables, so new columns
            # of old tables are added here (idempotent)
            for statement in MIGRATIONS:
                await conn.execute(text(statement))
        await conn.commit()
        log.info("Successful created database relations")
