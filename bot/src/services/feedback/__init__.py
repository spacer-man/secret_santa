import logging

from aiogram import Bot

from services import notifier
from services.delivery import ReactionResult

log = logging.getLogger(__name__)


NEW_REACTION = "🎄 Кто-то получил твоё поздравление и отреагировал: %s"
NEW_REPLY = "💌 Анонимный ответ на твоё поздравление%s:\n\n%s"


async def notify_author(bot: Bot, result: ReactionResult) -> None:
    """Tell the wish author that the recipient reacted / replied"""
    if result.author_id and (result.is_new_reply or result.is_new_reaction):
        await notifier.reaction(
            result.author_id,
            result.reaction if result.is_new_reaction else None,
            result.reply if result.is_new_reply else None,
        )
    if not result.author_telegram_id or not (
        result.author_id and await notifier.telegram_wanted(result.author_id)
    ):
        return None

    text = None
    if result.is_new_reply and result.reply:
        reaction = f" {result.reaction}" if result.reaction else ""
        text = NEW_REPLY % (reaction, result.reply)
    elif result.is_new_reaction and result.reaction:
        text = NEW_REACTION % result.reaction
    if not text:
        return None

    try:
        await bot.send_message(chat_id=result.author_telegram_id, text=text, parse_mode=None)
    except Exception:
        log.warning("Failed to notify wish author", exc_info=True)
