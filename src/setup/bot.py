from aiogram import Bot
from aiogram import Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.scene import SceneRegistry

import handlers
from configs.bot import BotConfig


def bot() -> Bot:
    return Bot(
        token=BotConfig().token.get_secret_value(),
        default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN))


def dispatcher() -> Dispatcher:
    dp = Dispatcher()

    registry = SceneRegistry(dp)
    registry.add(*handlers.all_scenes)

    return dp
