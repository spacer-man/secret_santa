"""
Notifications outside Telegram: Web Push and e-mail, in the channels the user chose.

Telegram messages are sent where they always were (the mailer, the bot handlers); this module
adds the other channels. A user's channels: ``User.notify`` (None: all). The New Year gift goes
to every chosen channel; reactions and moderation results only by push (no letters for small news).
"""

import logging
from uuid import UUID

from configs.webapp import WebAppConfig
from db import new_db_session
from db.models import User, ValidStatus
from services import email, push

log = logging.getLogger(__name__)

CHANNELS = ("telegram", "push", "email")

TEXTS: dict[str, dict[str, str]] = {
    "ru": {
        "gift_title": "🎄 С Новым годом!",
        "gift_body": "Тебе пришло анонимное поздравление. Открой подарок!",
        "gift_subject": "🎁 Тайный Санта: тебе пришло поздравление",
        "gift_mail": (
            "С Новым годом! 🎄\n\n"
            "Кто-то с другого конца света написал тебе поздравление. "
            "Открой подарок и ответь реакцией:\n{url}\n\n"
            "Тайный Санта"
        ),
        "reaction": "🎄 Кто-то получил твоё поздравление и отреагировал: {reaction}",
        "reply": "💌 Анонимный ответ на твоё поздравление: {reply}",
        "approved": "✅ Твоё поздравление одобрено и висит на ёлке",
        "rejected": "Поздравление не прошло модерацию. Можно написать новое",
        "code_subject": "Код входа: {code}",
        "code_mail": (
            "Твой код для входа в «Тайного Санту»: {code}\n\n"
            "Код действует 10 минут. Если код просил не ты, просто удали это письмо."
        ),
        "title": "Тайный Санта",
    },
    "en": {
        "gift_title": "🎄 Happy New Year!",
        "gift_body": "An anonymous greeting has come for you. Open your gift!",
        "gift_subject": "🎁 Secret Santa: a greeting has come for you",
        "gift_mail": (
            "Happy New Year! 🎄\n\n"
            "Someone from the other side of the world wrote you a greeting. "
            "Open your gift and react:\n{url}\n\n"
            "Secret Santa"
        ),
        "reaction": "🎄 Someone got your greeting and reacted: {reaction}",
        "reply": "💌 An anonymous reply to your greeting: {reply}",
        "approved": "✅ Your greeting is approved and hangs on the tree",
        "rejected": "Your greeting didn't pass moderation. You can write a new one",
        "code_subject": "Sign-in code: {code}",
        "code_mail": (
            "Your Secret Santa sign-in code: {code}\n\n"
            "It works for 10 minutes. If you didn't ask for it, just delete this letter."
        ),
        "title": "Secret Santa",
    },
}


def lang_of(language: str | None) -> str:
    return "en" if language and not language.lower().startswith("ru") else "ru"


def text(language: str | None, key: str, **values: str) -> str:
    return TEXTS[lang_of(language)][key].format(**values)


def wants(notify: str | None, channel: str) -> bool:
    return notify is None or channel in notify.split(",")


def app_url(path: str = "") -> str:
    return WebAppConfig().url_for(path) or "/" + path.lstrip("/")


async def gift(
    user_id: UUID, email_to: str | None, language: str | None, notify: str | None
) -> None:
    """The New Year has come for the user: push and/or a letter (Telegram goes separately)"""
    if wants(notify, "push"):
        await push.send(
            user_id,
            text(language, "gift_title"),
            text(language, "gift_body"),
            url="/inbox",
            tag="gift",
        )
    if email_to and wants(notify, "email"):
        await email.send(
            email_to,
            text(language, "gift_subject"),
            text(language, "gift_mail", url=app_url("inbox")),
        )


async def _push_to(user_id: UUID, key: str, url: str, **values: str) -> None:
    async with new_db_session() as session:
        user = await session.get(User, user_id)
    if not user or not wants(user.notify, "push"):
        return None
    try:
        await push.send(
            user_id,
            text(user.language, "title"),
            text(user.language, key, **values),
            url=url,
            tag=key,
        )
    except Exception:
        log.warning("Failed to push to %s", user_id, exc_info=True)


async def reaction(author_id: UUID, reaction: str | None, reply: str | None) -> None:
    if reply:
        await _push_to(author_id, "reply", "/wishes", reply=reply[:200])
    elif reaction:
        await _push_to(author_id, "reaction", "/wishes", reaction=reaction)


async def moderation(author_id: UUID, status: ValidStatus) -> None:
    key = "approved" if status == ValidStatus.APPROVED else "rejected"
    await _push_to(author_id, key, "/" if key == "approved" else "/new")


async def telegram_wanted(user_id: UUID) -> bool:
    async with new_db_session() as session:
        user = await session.get(User, user_id)
    return bool(user and user.telegram_id and wants(user.notify, "telegram"))
