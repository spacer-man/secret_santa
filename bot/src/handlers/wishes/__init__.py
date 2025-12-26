from .new.scene import WishingScene
from .w_list.scene import WishesListScene
from .validate.router import wish_validate_router


scenes = (
    WishesListScene,
    WishingScene,
)


__all__ = ("scenes", "wish_validate_router")
