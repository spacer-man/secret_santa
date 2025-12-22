from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons

def confirm_wish(has_media: bool = False) -> InlineKeyboardMarkup:
    keyboard = [
        [InlineKeyboardButton(
            text=buttons.CONFIRM,
            callback_data=buttons.CONFIRM)],
    ]
    if has_media:
        keyboard.append([
            InlineKeyboardButton(
                text=buttons.CLEAR_MEDIA,
                callback_data=buttons.CLEAR_MEDIA)
        ])
    return InlineKeyboardMarkup(inline_keyboard=keyboard)
