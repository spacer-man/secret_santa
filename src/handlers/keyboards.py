from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from . import buttons


CANCEL = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(
        text=buttons.CANCEL,
        callback_data=buttons.CANCEL)],
])

BACK = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(
        text=buttons.BACK,
        callback_data=buttons.BACK)],
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
