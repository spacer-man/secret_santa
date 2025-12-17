from handlers.utils.filters import IsRegistered
from repos.user.abc import UserRepository
from repos.user.sqlmodel import SQLModelUserRepository
from repos.wish.abc import WishRepository
from repos.wish.sqlmodel import SQLModelWishRepository
from services.user import UserService

from db import new_db_session
from services.wish import WishService


db_session = new_db_session()


user_repo: UserRepository = SQLModelUserRepository(session=db_session)
user_service: UserService = UserService(user_repo=user_repo)


wish_repo: WishRepository = SQLModelWishRepository(session=db_session)
wish_service: WishService = WishService(
    user_repo=user_repo,
    wish_repo=wish_repo)


is_registered = IsRegistered(user_service=user_service)
