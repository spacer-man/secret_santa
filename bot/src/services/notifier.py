"""
Notifications outside Telegram: Web Push and e-mail, in the channels the user chose.

Telegram messages are sent where they always were (the mailer, the bot handlers); this module
adds the other channels. A user's channels: ``User.notify`` (None: all). The New Year gift goes
to every chosen channel; reactions and moderation results only by push (no letters for small news).
"""

import logging
from typing import TYPE_CHECKING
from uuid import UUID

from configs.webapp import WebAppConfig
from db import new_db_session
from db.models import User, ValidStatus
from services import email, push

if TYPE_CHECKING:
    from aiogram import Bot

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
        "sec_title": "🔐 Тайный Санта: вход в аккаунт",
        "sec_linked": "К твоему аккаунту привязан новый способ входа: {what}.",
        "sec_unlinked": "От твоего аккаунта отвязан способ входа: {what}.",
        "sec_merged": "К твоему аккаунту присоединён другой аккаунт (вход через {what}).",
        "sec_dropped": "Способ входа {what} больше не связан с аккаунтом Тайного Санты: при "
        "объединении аккаунтов оставили другой.",
        "sec_advice": "Если это не ты — открой настройки и убери лишнее, а потом напиши нам.",
        "id_telegram": "Telegram",
        "id_google": "Google",
        "id_email": "почта {email}",
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
        "sec_title": "🔐 Secret Santa: signing in",
        "sec_linked": "A new way to sign in was linked to your account: {what}.",
        "sec_unlinked": "A way to sign in was unlinked from your account: {what}.",
        "sec_merged": "Another account was merged into yours (it signed in with {what}).",
        "sec_dropped": "The sign-in {what} is no longer linked to a Secret Santa account: "
        "another one was kept when accounts were merged.",
        "sec_advice": "If it wasn't you, open the settings, remove what you don't know and "
        "write to us.",
        "id_telegram": "Telegram",
        "id_google": "Google",
        "id_email": "e-mail {email}",
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


# ====== Security notices ====== #
def identity_label(language: str | None, kind: str, email_masked: str | None = None) -> str:
    if kind == "email":
        return text(language, "id_email", email=email_masked or "")
    return text(language, f"id_{kind}")


async def security(
    bot: "Bot | None",
    user_id: UUID,
    key: str,
    kind: str,
    email_masked: str | None = None,
    also_telegram: tuple[int, ...] = (),
    also_email: tuple[str, ...] = (),
) -> None:
    """
    Tell the owner that the ways into the account changed: by Telegram, e-mail and push at once,
    whatever channels they chose (a takeover must be noticed). ``also_*``: ways that just left
    the account (the old owner hears it there). Never fails the request.
    """
    async with new_db_session() as session:
        user = await session.get(User, user_id)
    if not user:
        return None
    language = user.language
    body = (
        text(language, key, what=identity_label(language, kind, email_masked))
        + "\n\n"
        + text(language, "sec_advice")
    )
    title = text(language, "sec_title")
    chats = {*also_telegram, *([user.telegram_id] if user.telegram_id else [])}
    mails = {*also_email, *([user.email] if user.email else [])}
    for chat in chats:
        if bot:
            try:
                await bot.send_message(chat_id=chat, text=f"{title}\n\n{body}", parse_mode=None)
            except Exception:
                log.info("Security notice not sent to Telegram %s", chat)
    for address in mails:
        await email.send(address, title, body)
    try:
        await push.send(user_id, title, body, url="/settings", tag="security")
    except Exception:
        log.warning("Security push failed for %s", user_id, exc_info=True)
