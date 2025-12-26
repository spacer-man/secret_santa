from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons


HIDE_WISH = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(
        text=buttons.HIDE_WISH,
        callback_data=buttons.HIDE_WISH)]
])
