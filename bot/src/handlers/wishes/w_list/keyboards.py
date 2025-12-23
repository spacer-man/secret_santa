import enum
from uuid import UUID

from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from handlers import buttons


class OptionPrefix(enum.StrEnum):
    DELETE = "del_"
    CONFIRM = "conf_"
    CANCEL = "can_"


def wish_item_options(wish_id: UUID | str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text=buttons.DELETE_WISH,
            callback_data=OptionPrefix.DELETE + str(wish_id))],
    ])


def confirm_delete_wish(wish_id: UUID | str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text=buttons.DELETE,
            callback_data=OptionPrefix.CONFIRM + str(wish_id)),
        InlineKeyboardButton(
            text=buttons.CANCEL,
            callback_data=OptionPrefix.CANCEL + str(wish_id))],
    ])
