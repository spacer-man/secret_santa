import json
from typing import (
    Any,
    Generator,
    Optional,
    Unpack,
)
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import delete, select, update

from .abc import EditWishArgs, NewWishArgs
from .abc import WishDTO
from .abc import WishRepository
from db.models import Wish


class SQLModelWishRepository(WishRepository):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_with_min_recipients(
            self,
            recipient: Optional[UUID],
            ) -> Generator[WishDTO]:
        """
        Get wishes with minimal recipients count exclude recipient.

        :args:
            :param recipient: User recipient ID in DB.
            :type recipient: `UUID`
        :returns: :class:`Generator[WishDTO]`
        """
        stmt = select(Wish)
        if recipient: stmt = stmt.where(Wish.id != recipient)
        stmt = stmt.order_by(Wish.recipients_count)

        query_result = await self.session.execute(stmt)
        scalars = query_result.scalars()
        min_recipients_count = min(scalars, key=lambda w: w.recipients_count)
        wishes = (
            WishDTO.model_validate({
                **wish.model_dump(),
                "text_entities": (
                    json.loads(wish.text_entities)
                    if wish.text_entities else None
                ),
            })
            for wish in query_result.scalars()
            if wish.recipients_count == min_recipients_count
        )

        return wishes

    async def get_one(self, wish_id: UUID) -> WishDTO | None:
        stmt = select(Wish).filter_by(id=wish_id)

        query_result = await self.session.execute(stmt)
        if wish := query_result.scalar_one_or_none():
            return WishDTO.model_validate({
                **wish.model_dump(),
                "text_entities": (
                    json.loads(wish.text_entities)
                    if wish.text_entities else None
                ),
            })

        return None

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

    async def edit(self, **kwargs: Unpack[EditWishArgs]) -> None:
        update_values = {}
        for field, value in kwargs.items():
            if value is not None and field != "id":
                update_values[field] = value

        stmt = (
            update(Wish)
            .filter_by(id=kwargs["id"])
            .values(**update_values)
        )
        await self.session.execute(stmt)

    async def delete(self, filter_by: dict[str, Any]) -> None:
        stmt = delete(Wish)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        await self.session.execute(stmt)

        return None
