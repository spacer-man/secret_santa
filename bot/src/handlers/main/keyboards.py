from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons


MAIN_MENU = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(
        text=buttons.EDIT_TIMEZONE,
        callback_data=buttons.EDIT_TIMEZONE)],
    [InlineKeyboardButton(
        text=buttons.NEW_WISH,
        callback_data=buttons.NEW_WISH)],
    [InlineKeyboardButton(
        text=buttons.MY_WISHES,
        callback_data=buttons.MY_WISHES)],
])
