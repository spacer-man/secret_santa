from typing import Any
from typing import Sequence
from typing import Unpack
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import delete
from sqlmodel import select

from .abc import NewWishArgs
from .abc import WishDTO
from .abc import WishRepository
from db.models import Wish


class SQLModelWishRepository(WishRepository):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_many(self, filter_by: dict[str, Any]) -> Sequence[WishDTO]:
        stmt = select(Wish)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        query_result = await self.session.execute(stmt)
        wishes = [
            WishDTO.model_validate(wish, from_attributes=True)
            for wish in query_result.scalars().all()
        ]

        return wishes

    async def create(self, **kwargs: Unpack[NewWishArgs]) -> UUID:
        new_wish = Wish(**kwargs)
        self.session.add(new_wish)

        await self.session.commit()

        return new_wish.id

    async def delete(self, filter_by: dict[str, Any]) -> None:
        stmt = delete(Wish)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        await self.session.execute(stmt)
        await self.session.commit()

        return None
