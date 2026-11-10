"""
Mandarins 🍊: in-app currency earned for useful actions (never bought).
"""

import enum
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from db.models import MandarinTx


class Reason(enum.StrEnum):
    WISH_APPROVED = "wish_approved"  # ref: wish id
    WISH_DELIVERED = "wish_delivered"  # ref: delivery id
    REACTION = "reaction"  # ref: delivery id
    REPLY = "reply"  # ref: delivery id
    FRIEND_JOINED = "friend_joined"  # ref: friend user id
    FRIEND_WISH = "friend_wish"  # ref: friend user id (first approved wish)
    GIFT_OPENED = "gift_opened"  # ref: delivery id


REWARDS: dict[Reason, int] = {
    Reason.WISH_APPROVED: 30,
    Reason.WISH_DELIVERED: 20,
    Reason.REACTION: 5,
    Reason.REPLY: 10,
    Reason.FRIEND_JOINED: 15,
    Reason.FRIEND_WISH: 50,
    Reason.GIFT_OPENED: 50,
}


async def award(
    session: AsyncSession,
    user_id: UUID,
    reason: Reason,
    ref: UUID | str,
) -> int:
    """
    Give mandarins (once per user/reason/ref). Caller commits.
    Returns the awarded amount (0 if it was already awarded).
    """
    ref = str(ref)
    exists = await session.scalar(
        select(MandarinTx.id)
        .where(MandarinTx.user_id == user_id)
        .where(MandarinTx.reason == reason)
        .where(MandarinTx.ref == ref)
    )
    if exists:
        return 0
    amount = REWARDS[reason]
    session.add(MandarinTx(user_id=user_id, amount=amount, reason=reason, ref=ref))
    return amount


async def balance(session: AsyncSession, user_id: UUID) -> int:
    return (
        await session.scalar(
            select(func.coalesce(func.sum(MandarinTx.amount), 0)).where(
                MandarinTx.user_id == user_id
            )
        )
        or 0
    )


async def history(session: AsyncSession, user_id: UUID, limit: int = 30) -> list[MandarinTx]:
    return list(
        (
            await session.scalars(
                select(MandarinTx)
                .where(MandarinTx.user_id == user_id)
                .order_by(col(MandarinTx.created_at).desc())
                .limit(limit)
            )
        ).all()
    )
