"""
Debug tools for development: set the festive level and the mandarin balance on the fly.

Switched on by ``DEBUG_TOOLS=1`` in the environment (``scripts/dev-tunnel.sh`` does it by default)
and only for admins: the moderators (``WISH_VALIDATE_TG_IDS``) and ``ADMIN_TG_IDS`` (optional, comma
separated Telegram ids). For everybody else the endpoint answers 404, as if it did not exist.
"""

import os
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MandarinTx
from services import mandarins

# Read once: the flag belongs to the process
ENABLED = os.getenv("DEBUG_TOOLS", "").lower() in {"1", "true", "yes"}


def _ids(*names: str) -> frozenset[int]:
    raw = ",".join(os.getenv(name, "") for name in names)
    return frozenset(int(part) for part in raw.split(",") if part.strip().lstrip("-").isdigit())


ADMINS = _ids("WISH_VALIDATE_TG_IDS", "ADMIN_TG_IDS")


def allowed(telegram_id: int) -> bool:
    """Debug tools are on and this Telegram user is an admin"""
    return ENABLED and telegram_id in ADMINS


# Festive level forced per user (in memory: the API restart forgets it, the DB is not touched)
_levels: dict[UUID, int] = {}


def forced_level(user_id: UUID) -> int | None:
    # Only admins can force a level (the endpoint checks it), so no check here
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
