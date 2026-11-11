"""
Debug tools for development: set the festive level and the mandarin balance on the fly.

Switched on by ``DEBUG_TOOLS=1`` in the environment (``scripts/dev-tunnel.sh`` does it by default).
Never on in production: the endpoint answers 404 when it is off.
"""

import os
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MandarinTx
from services import mandarins

# Read once: the flag belongs to the process
ENABLED = os.getenv("DEBUG_TOOLS", "").lower() in {"1", "true", "yes"}

# Festive level forced per user (in memory: the API restart forgets it, the DB is not touched)
_levels: dict[UUID, int] = {}


def forced_level(user_id: UUID) -> int | None:
    return _levels.get(user_id) if ENABLED else None


def force_level(user_id: UUID, level: int | None) -> None:
    """``None`` gives the real level back"""
    if level is None:
        _levels.pop(user_id, None)
    else:
        _levels[user_id] = level


async def set_balance(session: AsyncSession, user_id: UUID, target: int) -> None:
    """Adds one ledger entry so that the balance becomes ``target``. Caller commits."""
    diff = target - await mandarins.balance(session, user_id)
    if diff:
        session.add(
            MandarinTx(
                user_id=user_id, amount=diff, reason=mandarins.Reason.DEBUG, ref=str(uuid4())
            )
        )
