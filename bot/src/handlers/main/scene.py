import contextlib

from aiogram import F
from aiogram.filters import CommandObject, CommandStart
from aiogram.fsm.scene import Scene, on
from aiogram.types import CallbackQuery, FSInputFile, Message

from configs.labels import LabelsConfig
from handlers import buttons
from handlers.consts import Scenes
from handlers.depends import user_service
from handlers.referral import invite_link, parse_ref_code

from . import keyboards


class MainScene(
    Scene,
    reset_data_on_enter=True,
    reset_history_on_enter=True,
    callback_query_without_state=True,
):
    """Main bot scene"""

    @on.message(CommandStart())
    async def first_greeting(
        self,
        message: Message,
        command: CommandObject,
    ) -> None:
        if await user_service.is_registered(telegram_id=message.chat.id):
            await self.main_menu(message=message)
        else:
            if referrer_id := parse_ref_code(command.args):
                await self.wizard.update_data(referrer_id=str(referrer_id))
            await self.wizard.goto(Scenes.REGISTRATION)

    @on.callback_query.enter()
    async def callback_main_menu(self, call: CallbackQuery) -> None:
        if call.message:
            await self.main_menu(message=call.message)

    @on.message.enter()
    async def main_menu(self, message: Message) -> None:
        with contextlib.suppress(Exception):
            await message.delete()

        link = None
        user = await user_service.get(telegram_id=message.chat.id)
        if user and message.bot:
            link = await invite_link(bot=message.bot, user_id=user.id)

        await message.answer_photo(
            photo=FSInputFile(path=LabelsConfig().menu_label),
            reply_markup=keyboards.main_menu(invite_link=link),
        )

    @on.callback_query(F.data == buttons.NEW_WISH)
    async def new_wish(self, _) -> None:
        await self.wizard.goto(Scenes.WISHING)

    @on.callback_query(F.data == buttons.MY_WISHES)
    async def wishes_list(self, _) -> None:
        await self.wizard.goto(Scenes.WISHES_LIST)

    @on.callback_query(F.data == buttons.EDIT_TIMEZONE)
    async def edit_timezone(self, _) -> None:
        await self.wizard.goto(Scenes.EDIT_TIMEZONE)
