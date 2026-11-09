from aiogram.types import InlineKeyboardMarkup
from aiogram.types import InlineKeyboardButton

from urllib.parse import urlencode

from handlers import buttons
from handlers import keyboards as common_keyboards


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


def main_menu(invite_link: str | None = None) -> InlineKeyboardMarkup:
    rows = [*MAIN_MENU.inline_keyboard]
    if invite_link:
        share_url = "https://t.me/share/url?" + urlencode({
            "url": invite_link, "text": buttons.INVITE_TEXT})
        rows.append([InlineKeyboardButton(text=buttons.INVITE, url=share_url)])
    if app_row := common_keyboards.open_app():
        rows.insert(0, app_row)
    return InlineKeyboardMarkup(inline_keyboard=rows)
