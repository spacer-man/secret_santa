from aiogram import F
from aiogram.filters import CommandStart
from aiogram.fsm.scene import on, Scene
from aiogram.types import CallbackQuery, Message

from handlers import buttons


class CancellableScene(Scene):
    """
    This scene is used to handle cancel and back buttons,
    can be used as a base class for other scenes that needs to support cancel and back buttons.
    """

    @on.callback_query(F.data == buttons.BACK)
    async def handle_back(self, call: CallbackQuery) -> None:
        await self.wizard.back()
        await call.answer()

    @on.callback_query(F.data == buttons.CANCEL)
    async def handle_cancel(self, call: CallbackQuery) -> None:
        await self.wizard.exit()
        await call.answer()

    @on.message(CommandStart())
    async def handle_start_command(self, _: Message) -> None:
        await self.wizard.back()
