from datetime import datetime, timedelta, timezone
from aiogram import Bot
from aiogram.types import FSInputFile

from . import messages
from configs.labels import LabelsConfig
from db import new_db_session
from handlers import keyboards as common_keyboards
from repos.user.abc import UserRepository


class MailerService(object):
    """
    Service that process wish sending at `00:00`
    """
    def __init__(self, bot: Bot, user_repo_type: type[UserRepository]) -> None:
        self.bot = bot
        self.user_repo_type = user_repo_type

    async def send_wish(
            self,
            reciever: int,
            ) -> None:
        """
        Send wish to user.

        :args:
            :param reciever: Reciever Telegram ID;
            :type reciever: `int`
        :return: `None`
        """
        await self.bot.send_photo(
            chat_id=reciever,
            photo=FSInputFile(LabelsConfig().closed_gift),
            caption=messages.NEW_WISH_ALERT,
            reply_markup=common_keyboards.OPEN_WISH)

    async def send_wishes(self, offset: int) -> None:
        """
        Send wishes for users wish timezone UTC hour offset;

        :args:
            :param offset: Timezone UTC hour offset;
            :type offset: `int`
        :return: `None`
        """
        timezone = "UTC" + ("+" if offset >= 0 else "") + str(offset)

        async with new_db_session() as db_session:
            user_repo = self.user_repo_type(session=db_session)

            users = await user_repo.get_many(
                filter_by={"timezone": timezone})

        for user in users:
            await self.send_wish(reciever=user.telegram_id)

    def is_ny_has_come(self) -> int | None:
        """
        Check is New Year has come anywhere.

        If New Year has come, than return New Year comed UTC hour offset;
        Else return None.

        :return: :class:`int` | :class:`None`
        """
        for hour_offset in range(-12, 13):
            utc_now = datetime.now(timezone.utc)
            local_now = utc_now.astimezone(
                tz=timezone(offset=timedelta(hours=hour_offset)))

            if all((
                    local_now.month == 1,
                    local_now.day == 1,
                    local_now.hour == 0,
                    local_now.minute == 0,
                    local_now.second < 30,
                )):
                return hour_offset

        return None

    async def check_ny_and_send_wishes(self) -> None:
        """
        Check where the New Year has arrived and send wishes to the user for whom it has arrived;

        :return: `None`
        """
        if (ny_offset := self.is_ny_has_come()) is not None:
            await self.send_wishes(offset=ny_offset)
