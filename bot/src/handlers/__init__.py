from .main.scene import MainScene
from .register.scene import ConfirmTimezoneScene
from .register.scene import RegistrationScene
from .wishes_list.scene import WishesListScene
from .wishing.scene import ConfirmNewWish
from .wishing.scene import WishingScene


all_scenes = (
    MainScene,
    ConfirmNewWish,
    ConfirmTimezoneScene,
    RegistrationScene,
    WishesListScene,
    WishingScene,
)


__all__ = ("all_scenes",)
