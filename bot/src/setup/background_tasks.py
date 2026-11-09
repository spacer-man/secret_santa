import logging
from datetime import timezone

from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.schedulers.base import BaseScheduler
from apscheduler.triggers.interval import IntervalTrigger

from handlers.depends import delivery_service
from services.mailer.service import MailerService
from .bot import bot


log = logging.getLogger(__name__)


def setup_background_tasks() -> BaseScheduler:
    sheduler = AsyncIOScheduler()
    sheduler.add_executor(AsyncIOExecutor(), "asyncio")

    # ====== Mailer Service ====== #
    mailer = MailerService(bot=bot(), delivery_service=delivery_service)
    sheduler.add_job(
        func=mailer.check_ny_and_send_wishes,
        # Cheap when it's not 1 January anywhere
        trigger=IntervalTrigger(minutes=1, timezone=timezone.utc),
        name="new_year_mailing",
        executor="asyncio",
        max_instances=1,
        coalesce=True)

    return sheduler
