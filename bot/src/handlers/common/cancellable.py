from aiogram import F
from aiogram.fsm.scene import on
from aiogram.fsm.scene import Scene
from aiogram.types import CallbackQuery

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
