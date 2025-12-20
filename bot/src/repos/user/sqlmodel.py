from typing import (
    Any,
    Optional,
    Unpack,
)
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from .abc import NewUserArgs, UserDTO, UserRepository
from db.models import User


class SQLModelUserRepository(UserRepository):
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_one(
            self,
            filter_by: Optional[dict[str, Any]] = None,
            ) -> UserDTO | None:
        stmt = select(User)
        if filter_by:
            stmt = stmt.filter_by(**filter_by)

        query_result = await self.session.execute(stmt)
        if user := query_result.scalar_one_or_none():
            return UserDTO.model_validate(user, from_attributes=True)

        return None

    async def create(self, **kwargs: Unpack[NewUserArgs]) -> UUID:
        new_user = User(**kwargs)
        self.session.add(new_user)

        return new_user.id
