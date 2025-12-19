from typing import Any
from typing import Sequence
from typing import Unpack
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import delete
from sqlmodel import select

from .abc import NewMediaArgs
from .abc import MediaDTO
from .abc import MediaRepository
from db.models import Media


class SQLModelMediaRepository(MediaRepository):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_many(self, filter_by: dict[str, Any]) -> Sequence[MediaDTO]:
        stmt = select(Media)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        query_result = await self.session.execute(stmt)
        media_many = [
            MediaDTO.model_validate(media, from_attributes=True)
            for media in query_result.scalars().all()
        ]

        return media_many

    async def create(self, **kwargs: Unpack[NewMediaArgs]) -> UUID:
        new_media = Media(**kwargs)
        self.session.add(new_media)

        await self.session.commit()

        return new_media.id

    async def delete(self, filter_by: dict[str, Any]) -> None:
        stmt = delete(Media)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        await self.session.execute(stmt)
        await self.session.commit()

        return None
