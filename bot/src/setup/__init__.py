from .background_tasks import setup_background_tasks
from .bot import bot, dispatcher
from .logs import setup_logs

__all__ = (
    "bot",
    "dispatcher",
    "setup_background_tasks",
    "setup_logs",
)
