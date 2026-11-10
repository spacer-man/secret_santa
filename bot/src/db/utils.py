from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from db.core import new_db_session


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    async with new_db_session() as session:
        yield session
