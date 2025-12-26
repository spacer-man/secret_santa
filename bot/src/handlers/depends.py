from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from configs.bot import BotConfig
from configs.notify import NotifyConfig
from handlers.utils.filters import IsRegistered
from repos.media.abc import MediaRepository
from repos.media.sqlmodel import SQLModelMediaRepository
from repos.user.abc import UserRepository
from repos.user.sqlmodel import SQLModelUserRepository
from repos.wish.abc import WishRepository
from repos.wish.sqlmodel import SQLModelWishRepository
from services.notify import AiogramNotifyService, NotifyService
from services.user import UserService
from services.wish import WishService


user_repo_type: type[UserRepository] = SQLModelUserRepository
wish_repo_type: type[WishRepository] = SQLModelWishRepository
media_repo_type: type[MediaRepository] = SQLModelMediaRepository


user_service: UserService = UserService(user_repo_type=user_repo_type)
wish_service: WishService = WishService(
    user_repo_type=user_repo_type,
    wish_repo_type=wish_repo_type,
    media_repo_type=media_repo_type)

bot = Bot(
    token=BotConfig().token.get_secret_value(),
    default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN))
notify_service: NotifyService = AiogramNotifyService(
    bot=bot,
    reciever_tg_ids=NotifyConfig().wish_validate_tg_ids)


is_registered = IsRegistered(user_service=user_service)
