from uuid import UUID

from aiogram import F, Router
from aiogram.types import CallbackQuery, Message

from . import keyboards
from . import messages
from db.models import ValidStatus
from handlers import buttons
from handlers.depends import wish_service
from services.notify.aiogram.keyboards import OptionPrefix


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

    # Show successful validate processed
    await message.edit_text(
        text=messages.VERIFIED_WISH_ACTIONS % {"status": status_message},
        reply_markup=keyboards.HIDE_WISH)


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
