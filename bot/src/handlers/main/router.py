from aiogram import F, Router
from aiogram.types import CallbackQuery, Message

from handlers import buttons


main_router = Router(name="main")


@main_router.callback_query(F.data == buttons.HIDE)
async def hide_message(call: CallbackQuery) -> None:
    message = call.message
    if isinstance(message, Message):
        await message.delete()
