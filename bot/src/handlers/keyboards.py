from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from . import buttons
from handlers.utils.timezone import ALL_TIMEZONES
from handlers.utils.timezone import batch


TIMEZONE_MENU = InlineKeyboardMarkup(inline_keyboard=[
    [
        InlineKeyboardButton(text=timezone, callback_data=timezone)
        for timezone in chunk
    ]
    for chunk in batch(ALL_TIMEZONES, size=5)
])


CANCEL = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(text=buttons.CANCEL, callback_data=buttons.CANCEL)],
])

BACK = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(text=buttons.BACK, callback_data=buttons.BACK)],
])

HIDE = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(text=buttons.HIDE, callback_data=buttons.HIDE)]
])

CONFIRM_OR_BACK = InlineKeyboardMarkup(inline_keyboard=[
    [
        InlineKeyboardButton(
            text=buttons.CONFIRM,
            callback_data=buttons.CONFIRM),
        InlineKeyboardButton(
            text=buttons.BACK,
            callback_data=buttons.BACK),
    ],
])
