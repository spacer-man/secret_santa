import json
from typing import (
    Any,
    Generator,
    Optional,
    Unpack,
)
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

    async def get_many(
            self,
            filter_by: Optional[dict[str, Any]] = None,
            ) -> Generator[WishDTO]:
        stmt = select(Wish)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        query_result = await self.session.execute(stmt)
        wishes = (
            WishDTO.model_validate({
                **wish.model_dump(),
                "text_entities": (
                    json.loads(wish.text_entities)
                    if wish.text_entities else None
                ),
            })
            for wish in query_result.scalars()
        )

        return wishes

    async def create(self, **kwargs: Unpack[NewWishArgs]) -> UUID:
        new_wish = Wish(**kwargs)
        self.session.add(new_wish)

        return new_wish.id

    async def delete(self, filter_by: dict[str, Any]) -> None:
        stmt = delete(Wish)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        await self.session.execute(stmt)

        return None
