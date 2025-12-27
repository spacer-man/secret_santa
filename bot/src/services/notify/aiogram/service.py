import enum
import logging
import random
from aiogram import Bot

from . import messages
from . import keyboards
from . import utils
from ..interface import NotifyService
from services.wish import WishDTO


log = logging.getLogger(__name__)


class ChoiceStrategy(enum.StrEnum):
    RANDOM = "random"
    ITERABLE = "iterable"


class AiogramNotifyService(NotifyService):
    def __init__(
            self,
            bot: Bot,
            reciever_tg_ids: list[int],
            reciever_choice: ChoiceStrategy | str = "random",
            ) -> None:
        assert reciever_tg_ids, "reciever_tg_ids should be not empty"

        self.bot = bot
        self.reciever_tg_ids = reciever_tg_ids
        self.reciever_choice_strategy = ChoiceStrategy(reciever_choice)
        self.last_reciever = None

    def _get_reciever(self, author: int | None = None) -> int:
        match self.reciever_choice_strategy:
            case ChoiceStrategy.RANDOM:
                recievers = self.reciever_tg_ids[:]

                if len(self.reciever_tg_ids) > 1:
                    recievers = list(filter(
                        lambda r: r not in [self.last_reciever, author],
                        recievers))
                reciever = random.choice(recievers)
                self.last_reciever = reciever

                return reciever
            case ChoiceStrategy.ITERABLE:
                if len(self.reciever_tg_ids) == 1:
                    reciever = self.reciever_tg_ids[0]
                else:
                    recievers = list(filter(
                        lambda r: r != author,
                        self.reciever_tg_ids[:]))

                    if len(recievers) == 1:
                        reciever = recievers[0]

                    else:
                        last_reciever_id = -1
                        if self.last_reciever is not None:
                            last_reciever_id = recievers.index(self.last_reciever)

                        recievers += [recievers[0]]
                        reciever = recievers[last_reciever_id + 1]

                self.last_reciever = reciever
                return reciever

    async def new_wish_to_check(self, wish: WishDTO) -> None:
        reciever = self._get_reciever()
        wish_messages = await utils.send_wish(
            chat_id=reciever,
            bot=self.bot,
            wish=wish)
        await self.bot.send_message(
            chat_id=reciever,
            text=messages.NEW_WISH_TO_CHECK,
            reply_markup=keyboards.approve_or_reject(wish_id=wish.id),
            reply_to_message_id=wish_messages[0].message_id)


