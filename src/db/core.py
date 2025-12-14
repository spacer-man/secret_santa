import logging

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import SQLModel

from .models import *
from configs.db import DBConfig


log = logging.getLogger(__name__)


engine = create_async_engine(
    url=DBConfig().url.get_secret_value(),
    future=True)

new_db_session = async_sessionmaker(
    bind=engine,
    autoflush=True,
    expire_on_commit=False)


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

        log.debug("Creating database relations")
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.commit()
        log.info("Successful created database relations")
