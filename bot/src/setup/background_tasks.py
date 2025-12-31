import logging
from datetime import datetime, timezone

from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.schedulers.base import BaseScheduler
from apscheduler.triggers.interval import IntervalTrigger

from repos.user.sqlmodel import SQLModelUserRepository
from services.mailer.service import MailerService
from .bot import bot


log = logging.getLogger(__name__)


def setup_background_tasks() -> BaseScheduler:
    sheduler = AsyncIOScheduler()
    sheduler.add_executor(AsyncIOExecutor(), "asyncio")

    # ====== Mailer Service ====== #
    mailer = MailerService(bot=bot(), user_repo_type=SQLModelUserRepository)
    sheduler.add_job(
        func=mailer.check_ny_and_send_wishes,
        trigger=IntervalTrigger(
            hours=1,
            start_date=datetime(2025, 12, 1),
            end_date=datetime(2026, 1, 31),
            timezone=timezone.utc),
        name="new_year_mailing",
        executor="asyncio")

    return sheduler
