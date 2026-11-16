import logging
from datetime import UTC

from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.schedulers.base import BaseScheduler
from apscheduler.triggers.interval import IntervalTrigger

from handlers.depends import delivery_service
from services import accounts
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
        trigger=IntervalTrigger(minutes=1, timezone=UTC),
        name="new_year_mailing",
        executor="asyncio",
        max_instances=1,
        coalesce=True,
    )

    # ====== Deleted accounts: erased 30 days after deletion ====== #
    sheduler.add_job(
        func=accounts.purge_deleted,
        trigger=IntervalTrigger(hours=6, timezone=UTC),
        name="purge_deleted_accounts",
        executor="asyncio",
        max_instances=1,
        coalesce=True,
    )

    return sheduler
