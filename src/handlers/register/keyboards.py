from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons
from handlers.register.utils import ALL_TIMEZONES
from handlers.register.utils import batch


MAIN_MENU = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(
        text=buttons.MY_WISHES,
        callback_data=buttons.MY_WISHES)],
    [InlineKeyboardButton(
        text=buttons.NEW_WISH,
        callback_data=buttons.NEW_WISH)],
])


TIMEZONE_MENU = InlineKeyboardMarkup(inline_keyboard=[
    [
        InlineKeyboardButton(text=timezone, callback_data=timezone)
        for timezone in chunk
    ]
    for chunk in batch(ALL_TIMEZONES, size=5)
])
