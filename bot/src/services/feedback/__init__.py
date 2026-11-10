import logging

from aiogram import Bot

from services.delivery import ReactionResult

log = logging.getLogger(__name__)


NEW_REACTION = "🎄 Кто-то получил твоё поздравление и отреагировал: %s"
NEW_REPLY = "💌 Анонимный ответ на твоё поздравление%s:\n\n%s"


async def notify_author(bot: Bot, result: ReactionResult) -> None:
    """Tell the wish author that the recipient reacted / replied"""
    if not result.author_telegram_id:
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
