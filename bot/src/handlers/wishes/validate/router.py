import logging
from uuid import UUID

from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message

from . import keyboards
from . import messages
from db.models import ValidStatus
from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.depends import wish_service
from services.mandarins import REWARDS, Reason
from services.notify.aiogram.keyboards import OptionPrefix


log = logging.getLogger(__name__)


wish_validate_router = Router(name="wishes.validate")


@wish_validate_router.callback_query(
        F.data.startswith(OptionPrefix.APPROVE)
        | F.data.startswith(OptionPrefix.REJECT)
        )
async def approve_or_reject_wish(call: CallbackQuery) -> None:
    callback_data = call.data
    message = call.message
    if not (isinstance(message, Message) and callback_data):
        return None

    # Process different ways
    if callback_data.startswith(OptionPrefix.APPROVE):
        data_prefix = OptionPrefix.APPROVE
        new_wish_valid_status = ValidStatus.APPROVED
        status_message = messages.APPROVED
    else:   # callback_data.startswith(OptionPrefix.REJECT):
        data_prefix = OptionPrefix.REJECT
        new_wish_valid_status = ValidStatus.REJECTED
        status_message = messages.REJECTED

    # Verify that postfix is a valid UUID
    try:
        wish_id = UUID(callback_data[len(data_prefix):])
    except Exception:
        return None

    # Update wish valid status
    await wish_service.update_wish_status(
        wish_id=wish_id,
        valid_status=new_wish_valid_status)

    await notify_wish_author(call, wish_id, new_wish_valid_status)

    # Show successful validate processed
    await message.edit_text(
        text=messages.VERIFIED_WISH_ACTIONS % {"status": status_message},
        reply_markup=keyboards.HIDE_WISH)


async def notify_wish_author(
        call: CallbackQuery,
        wish_id: UUID,
        status: ValidStatus,
        ) -> None:
    bot = call.bot
    wish = await wish_service.get_one(wish_id)
    if not (bot and wish):
        return None
    if status == ValidStatus.APPROVED:
        text = messages.AUTHOR_APPROVED % {"mandarins": REWARDS[Reason.WISH_APPROVED]}
    else:
        text = messages.AUTHOR_REJECTED
    app_row = common_keyboards.open_app(text=buttons.OPEN_TREE)
    try:
        await bot.send_message(
            chat_id=wish.author_telegram_id,
            text=text,
            parse_mode=None,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[app_row]) if app_row else None)
    except Exception:
        log.warning("Failed to notify wish author", exc_info=True)


@wish_validate_router.callback_query(F.data == buttons.HIDE_WISH)
async def hide_wish(call: CallbackQuery) -> None:
    bot = call.bot
    message = call.message
    if not (isinstance(message, Message) and bot):
        return None

    messages_to_delete = [message.message_id]
    if replyed := message.reply_to_message:
        messages_to_delete.append(replyed.message_id)

    await bot.delete_messages(
        chat_id=message.chat.id,
        message_ids=messages_to_delete)
