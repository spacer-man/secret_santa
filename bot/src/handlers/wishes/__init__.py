from .new.scene import WishingScene
from .list.scene import WishesListScene
from .open.router import wish_open_router
from .validate.router import wish_validate_router


scenes = (
    WishesListScene,
    WishingScene,
)


__all__ = (
    "scenes",
    "wish_open_router",
    "wish_validate_router",
)
