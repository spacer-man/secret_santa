from .main.router import main_router
from .main.scene import MainScene
from .register.scene import ConfirmTimezoneScene
from .register.scene import RegistrationScene
from .wishes import scenes as wishes_scenes


all_scenes = (
    MainScene,
    ConfirmTimezoneScene,
    RegistrationScene,
    *wishes_scenes,
)


__all__ = ("all_scenes", "main_router")
