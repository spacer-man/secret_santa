"""
Web Push to browsers and installed PWAs (VAPID, ``pywebpush``).

The browser subscribes with our public key (``/api/config`` gives it) and sends the subscription
to ``/api/push``; the service worker (``web_app/public/sw.js``) shows what comes.

New keys: ``python -m services.push`` (from ``bot/src``) prints ``VAPID_PUBLIC_KEY`` and
``VAPID_PRIVATE_KEY`` for the ``.env``.
"""

import asyncio
import base64
import json
import logging
from uuid import UUID

from pywebpush import WebPushException, webpush
from sqlmodel import col, delete, select

from configs.accounts import PushConfig
from db import new_db_session
from db.models import PushSubscription

log = logging.getLogger(__name__)

_config = PushConfig()

# A notification is useless after a day (a gift at midnight, a reaction)
TTL = 24 * 3600


def enabled() -> bool:
    return _config.enabled


def public_key() -> str | None:
    return _config.public_key or None


async def subscribe(user_id: UUID, endpoint: str, p256dh: str, auth: str) -> None:
    """Save the browser's subscription (the same browser again: moved to this user)"""
    async with new_db_session() as session:
        sub = await session.scalar(
            select(PushSubscription).where(PushSubscription.endpoint == endpoint)
        )
        if sub:
            sub.user_id, sub.p256dh, sub.auth = user_id, p256dh, auth
        else:
            sub = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth)
        session.add(sub)
        await session.commit()


async def unsubscribe(user_id: UUID, endpoint: str) -> None:
    async with new_db_session() as session:
        await session.execute(
            delete(PushSubscription)
            .where(col(PushSubscription.user_id) == user_id)
            .where(col(PushSubscription.endpoint) == endpoint)
        )
        await session.commit()


async def count(user_id: UUID) -> int:
    async with new_db_session() as session:
        return len(
            (
                await session.scalars(
                    select(PushSubscription.id).where(PushSubscription.user_id == user_id)
                )
            ).all()
        )


def _send(sub: PushSubscription, payload: str) -> None:
    webpush(
        subscription_info={
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        },
        data=payload,
        vapid_private_key=_config.private_key.get_secret_value(),
        vapid_claims={"sub": _config.subject},
        ttl=TTL,
    )


async def send(user_id: UUID, title: str, body: str, url: str = "/", tag: str = "santa") -> int:
    """
    Show a notification in every browser of the user. Returns how many got it.
    Subscriptions the push service has forgotten (404/410) are deleted.
    """
    if not enabled():
        return 0
    async with new_db_session() as session:
        subs = list(
            (
                await session.scalars(
                    select(PushSubscription).where(PushSubscription.user_id == user_id)
                )
            ).all()
        )
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent, gone = 0, []
    for sub in subs:
        try:
            await asyncio.to_thread(_send, sub, payload)
            sent += 1
        except WebPushException as err:
            status = err.response.status_code if err.response is not None else None
            if status in (404, 410):
                gone.append(sub.id)
            else:
                log.warning("Push failed (%s) for user %s", status, user_id)
        except Exception:
            log.warning("Push failed for user %s", user_id, exc_info=True)
    if gone:
        async with new_db_session() as session:
            await session.execute(
                delete(PushSubscription).where(col(PushSubscription.id).in_(gone))
            )
            await session.commit()
    return sent


def generate_keys() -> tuple[str, str]:
    """A new VAPID pair: (public, private), both base64url as browsers and pywebpush want"""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return b64(public), b64(private)


if __name__ == "__main__":
    public, private = generate_keys()
    print(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
