from aiogram import Bot
from aiogram import Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.scene import SceneRegistry
from aiogram.fsm.storage.base import BaseStorage
from aiogram.fsm.storage.base import DefaultKeyBuilder
from aiogram.fsm.storage.redis import RedisStorage

import handlers
from configs.bot import BotConfig
from middlewares.media_group import MediaGroupMiddleware


def setup_storage() -> BaseStorage | None:
    bot_config = BotConfig()
    if bot_config.states_redis_url:
        return RedisStorage.from_url(
            url=bot_config.states_redis_url.get_secret_value(),
            key_builder=DefaultKeyBuilder(with_destiny=True))
    return None


def bot() -> Bot:
    return Bot(
        token=BotConfig().token.get_secret_value(),
        default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN))


def dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=setup_storage())

    registry = SceneRegistry(dp)
    registry.add(*handlers.all_scenes)
    dp.message.middleware(MediaGroupMiddleware())

    return dp
