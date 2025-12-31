from .background_tasks import setup_background_tasks
from .bot import bot
from .bot import dispatcher
from .logs import setup_logs


__all__ = (
    "setup_background_tasks",
    "bot",
    "dispatcher",
    "setup_logs",
)
