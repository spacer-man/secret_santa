from .edit_timezone.scene import EditTimezoneScene, ConfirmEditTimezoneScene
from .main.router import main_router
from .main.scene import MainScene
from .register.scene import ConfirmTimezoneScene, RegistrationScene
from .wishes import scenes as wishes_scenes


all_scenes = (
    ConfirmEditTimezoneScene,
    ConfirmTimezoneScene,
    EditTimezoneScene,
    MainScene,
    RegistrationScene,
    *wishes_scenes,
)


__all__ = ("all_scenes", "main_router")
