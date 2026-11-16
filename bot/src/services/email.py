"""
Outgoing e-mail over SMTP (stdlib ``smtplib`` in a thread: a few letters a minute at most).

Without ``SMTP_HOST`` letters are not sent; with ``DEBUG_TOOLS=1`` they are written to the log
instead, so sign-in by e-mail can be tried locally (the code is in the log).
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

from configs.accounts import SmtpConfig
from services import debug

log = logging.getLogger(__name__)

_config = SmtpConfig()


def enabled() -> bool:
    """Letters can be sent (or are logged in development)"""
    return bool(_config.host) or debug.ENABLED


def _send(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if _config.ssl:
        smtp: smtplib.SMTP = smtplib.SMTP_SSL(_config.host, _config.port, context=context)
    else:
        smtp = smtplib.SMTP(_config.host, _config.port, timeout=20)
    with smtp:
        if not _config.ssl:
            smtp.starttls(context=context)
        if _config.user:
            smtp.login(_config.user, _config.password.get_secret_value())
        smtp.send_message(message)


async def send(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """Send a letter; ``False`` if it couldn't be sent (the reason is logged)"""
    if not _config.host:
        if debug.ENABLED:
            log.warning("E-mail (not sent, no SMTP_HOST) to %s: %s\n%s", to, subject, text)
            return True
        return False

    message = EmailMessage()
    message["From"] = _config.sender or _config.user
    message["To"] = to
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain=(_config.sender or _config.user).split("@")[-1])
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
    try:
        await asyncio.to_thread(_send, message)
    except Exception:
        log.warning("Failed to send e-mail to %s", to, exc_info=True)
        return False
    return True
