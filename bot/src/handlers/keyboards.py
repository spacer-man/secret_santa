from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from configs.support import SupportConfig
from configs.webapp import WebAppConfig
from handlers.utils.timezone import FRACTIONAL_TIMEZONES, WHOLE_HOUR_TIMEZONES, batch

from . import buttons

# Whole hour offsets first, then the rarer half/quarter hour ones
_TIMEZONE_MENU_BUTTONS = [
    [InlineKeyboardButton(text=timezone, callback_data=timezone) for timezone in chunk]
    for timezones, size in ((WHOLE_HOUR_TIMEZONES, 5), (FRACTIONAL_TIMEZONES, 4))
    for chunk in batch(timezones, size=size)
]


TIMEZONE_MENU = InlineKeyboardMarkup(inline_keyboard=_TIMEZONE_MENU_BUTTONS)


TIMEZONE_MENU_OR_CANCEL = InlineKeyboardMarkup(
    inline_keyboard=[
        *_TIMEZONE_MENU_BUTTONS,
        [InlineKeyboardButton(text=buttons.CANCEL, callback_data=buttons.CANCEL)],
    ]
)


CANCEL = InlineKeyboardMarkup(
    inline_keyboard=[
        [InlineKeyboardButton(text=buttons.CANCEL, callback_data=buttons.CANCEL)],
    ]
)

BACK = InlineKeyboardMarkup(
    inline_keyboard=[
        [InlineKeyboardButton(text=buttons.BACK, callback_data=buttons.BACK)],
    ]
)

HIDE = InlineKeyboardMarkup(
    inline_keyboard=[[InlineKeyboardButton(text=buttons.HIDE, callback_data=buttons.HIDE)]]
)

CONFIRM_OR_BACK = InlineKeyboardMarkup(
    inline_keyboard=[
        [
            InlineKeyboardButton(text=buttons.CONFIRM, callback_data=buttons.CONFIRM),
            InlineKeyboardButton(text=buttons.BACK, callback_data=buttons.BACK),
        ],
    ]
)

SUPPORT_OR_HIDE = InlineKeyboardMarkup(
    inline_keyboard=[
        [
            InlineKeyboardButton(text=buttons.HIDE, callback_data=buttons.HIDE),
            InlineKeyboardButton(text=buttons.SUPPORT, url=SupportConfig().author_support_link),
        ],
    ]
)

OPEN_WISH = InlineKeyboardMarkup(
    inline_keyboard=[
        [InlineKeyboardButton(text=buttons.OPEN_WISH, callback_data=buttons.OPEN_WISH)],
    ]
)


def open_app(path: str = "", text: str = buttons.OPEN_APP) -> list[InlineKeyboardButton]:
    """A row with a button opening the mini app (empty if the app is not configured)"""
    if url := WebAppConfig().url_for(path):
        return [InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url))]
    return []
