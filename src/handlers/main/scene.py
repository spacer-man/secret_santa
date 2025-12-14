from aiogram import F
from aiogram.filters import CommandStart
from aiogram.fsm.scene import on
from aiogram.fsm.scene import Scene
from aiogram.types import CallbackQuery, Message

from . import keyboards
from handlers import buttons
from handlers.consts import Scenes
from handlers.depends import user_service


class MainScene(
        Scene,
        reset_data_on_enter=True,
        reset_history_on_enter=True,
        callback_query_without_state=True,
        ):
    """Main bot scene"""
    @on.message(CommandStart())
    async def first_greeting(self, message: Message) -> None:
        if await user_service.is_registered(telegram_id=message.chat.id):
            await self.main_menu(message=message)
        else:
            await self.wizard.goto(Scenes.REGISTRATION)

    @on.callback_query.enter()
    async def callback_main_menu(self, call: CallbackQuery) -> None:
        if call.message:
            await self.main_menu(message=call.message)

    @on.message.enter()
    async def main_menu(self, message: Message) -> None:
        try:
            await message.delete()
        except Exception:
            pass

        await message.answer(
            text="*MAIN MENU*",
            reply_markup=keyboards.MAIN_MENU)

    @on.callback_query(F.data == buttons.NEW_WISH)
    async def new_wish(self, _) -> None:
        await self.wizard.goto(Scenes.WISHING)

    @on.callback_query(F.data == buttons.MY_WISHES)
    async def wishes_list(self, _) -> None:
        await self.wizard.goto(Scenes.WISHES_LIST)
