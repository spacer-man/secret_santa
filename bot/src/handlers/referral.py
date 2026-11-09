from uuid import UUID

from aiogram import Bot


REF_PREFIX = "r_"


def ref_code(user_id: UUID) -> str:
    return REF_PREFIX + user_id.hex


def parse_ref_code(code: str | None) -> UUID | None:
    if not code or not code.startswith(REF_PREFIX):
        return None
    try:
        return UUID(hex=code[len(REF_PREFIX):])
    except ValueError:
        return None


async def invite_link(bot: Bot, user_id: UUID) -> str:
    me = await bot.me()
    return f"https://t.me/{me.username}?start={ref_code(user_id)}"
