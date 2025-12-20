from handlers.utils.filters import IsRegistered
from repos.media.abc import MediaRepository
from repos.media.sqlmodel import SQLModelMediaRepository
from repos.user.abc import UserRepository
from repos.user.sqlmodel import SQLModelUserRepository
from repos.wish.abc import WishRepository
from repos.wish.sqlmodel import SQLModelWishRepository
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


is_registered = IsRegistered(user_service=user_service)
