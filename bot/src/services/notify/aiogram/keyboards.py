import enum
from uuid import UUID

from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons


class OptionPrefix(enum.StrEnum):
    APPROVE= "w.appr_"
    REJECT = "w.rej_"


def approve_or_reject(wish_id: UUID | str):
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text=buttons.APPROVE_WISH,
                callback_data=OptionPrefix.APPROVE + str(wish_id)),
            InlineKeyboardButton(
                text=buttons.REJECT_WISH,
                callback_data=OptionPrefix.REJECT + str(wish_id)),
        ],
    ])
