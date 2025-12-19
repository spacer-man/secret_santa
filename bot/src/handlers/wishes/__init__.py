from .new.scene import ConfirmNewWish
from .new.scene import WishingScene
from .w_list.scene import WishesListScene


scenes = (
    ConfirmNewWish,
    WishesListScene,
    WishingScene,
)


__all__ = ("scenes",)
