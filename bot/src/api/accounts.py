"""
Signing in without Telegram, linking ways to sign in, merging accounts, notification settings.

Sign in (any of them gives ``{"token": ...}`` for ``Authorization: Bearer``):
* ``POST /api/auth/telegram``      Telegram Login Widget data;
* ``POST /api/auth/email/start``   send a 6-digit code to the e-mail,
  ``POST /api/auth/email/verify``  the code;
* ``POST /api/auth/google``        Google Identity Services credential (ID token).

Linking (signed in and registered): ``POST /api/me/link`` with the proof of another identity.
If that identity already has its own account, the answer offers a merge: a short-lived signed
``merge_token`` (it proves the caller owns both) and what each account has;
``POST /api/me/merge`` does it.
"""

import time
from collections import defaultdict, deque
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services import accounts, email, google, notifier, push

from . import auth
from .deps import BOT_TOKEN, CurrentPrincipal, RegisteredUser

router = APIRouter()

MERGE_TTL = 15 * 60

# Codes to one IP: a few people behind one address are fine, a spammer is not
EMAIL_PER_IP = 8
EMAIL_WINDOW_S = 15 * 60
_email_sends: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Caddy sets X-Forwarded-For to the real client address
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[-1].strip() or (request.client.host if request.client else "?")


def _limit_ip(request: Request) -> None:
    now = time.monotonic()
    sends = _email_sends[_client_ip(request)]
    while sends and now - sends[0] > EMAIL_WINDOW_S:
        sends.popleft()
    if len(sends) >= EMAIL_PER_IP:
        raise HTTPException(status_code=429, detail="Too many codes")
    sends.append(now)


def _token(principal: auth.Principal) -> dict:
    return {"token": auth.make_session(principal, BOT_TOKEN)}


# ====== Proofs of identities ====== #
class LoginWidgetData(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


class EmailStartIn(BaseModel):
    email: str = Field(max_length=254)
    language: str | None = Field(default=None, max_length=8)


class EmailCodeIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(min_length=4, max_length=12)


class GoogleIn(BaseModel):
    credential: str = Field(max_length=8192)


def _email_or_422(raw: str) -> str:
    if not (address := accounts.normalize_email(raw)):
        raise HTTPException(status_code=422, detail="Bad e-mail")
    return address


def telegram_principal(data: LoginWidgetData) -> auth.Principal:
    try:
        user = auth.check_login_widget(data.model_dump(), BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    return auth.Principal.telegram(user)


async def email_principal(body: EmailCodeIn) -> auth.Principal:
    address = _email_or_422(body.email)
    if not await accounts.check_email_code(address, body.code, BOT_TOKEN):
        raise HTTPException(status_code=401, detail="Wrong or expired code")
    return auth.Principal(kind="email", key=address)


async def google_principal(body: GoogleIn) -> tuple[auth.Principal, google.GoogleUser]:
    try:
        user = await google.verify(body.credential)
    except google.GoogleError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    return auth.Principal(kind="google", key=user.sub, first_name=user.name), user


# ====== Sign in ====== #
@router.post("/api/auth/telegram")
async def login_by_widget(data: LoginWidgetData) -> dict:
    return _token(telegram_principal(data))


@router.post("/api/auth/email/start")
async def email_start(body: EmailStartIn, request: Request) -> dict:
    """Send a sign-in code (also used to prove an e-mail when linking it)"""
    if not email.enabled():
        raise HTTPException(status_code=503, detail="E-mail is off")
    address = _email_or_422(body.email)
    _limit_ip(request)
    try:
        code = await accounts.new_email_code(address, BOT_TOKEN)
    except accounts.TooSoon as err:
        raise HTTPException(status_code=429, detail=str(err)) from err
    sent = await email.send(
        address,
        notifier.text(body.language, "code_subject", code=code),
        notifier.text(body.language, "code_mail", code=code),
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Couldn't send the letter")
    return {"sent": True, "resend_after": int(accounts.RESEND_AFTER.total_seconds())}


@router.post("/api/auth/email/verify")
async def email_verify(body: EmailCodeIn) -> dict:
    return _token(await email_principal(body))


@router.post("/api/auth/google")
async def login_by_google(body: GoogleIn) -> dict:
    principal, user = await google_principal(body)
    # The same person came by e-mail before: Google has checked the address, so it's them
    if user.email and user.email_verified and not await accounts.get_user(principal):
        address = accounts.normalize_email(user.email)
        owner = (
            await accounts.get_user(auth.Principal(kind="email", key=address)) if address else None
        )
        if owner and owner.google_id is None:
            await accounts.link(owner.id, principal)
    return _token(principal)


# ====== Linking & merging ====== #
class LinkIn(BaseModel):
    telegram: LoginWidgetData | None = None
    email: EmailCodeIn | None = None
    google: GoogleIn | None = None


async def _me(principal: auth.Principal) -> dict:
    from .app import me_payload  # app imports this module

    return await me_payload(principal, await accounts.get_user(principal))


@router.post("/api/me/link")
async def link(body: LinkIn, user: RegisteredUser, principal: CurrentPrincipal) -> dict:
    """
    Add a way to sign in. ``status``: ``linked`` / ``same`` (done, ``me`` is fresh);
    ``replace``: the account already has another one of this kind (unlink it first);
    ``taken``: it has its own account: ``merge_token`` and both summaries to decide.
    """
    if body.telegram:
        other = telegram_principal(body.telegram)
    elif body.email:
        other = await email_principal(body.email)
    elif body.google:
        other, _ = await google_principal(body.google)
    else:
        raise HTTPException(status_code=422, detail="Nothing to link")

    result = await accounts.link(user.id, other)
    if result.status != "taken" or not result.other_id:
        return {"status": result.status, "me": await _me(principal)}

    token = auth.sign(
        {"keep": user.id.hex, "absorb": result.other_id.hex, "exp": int(time.time()) + MERGE_TTL},
        BOT_TOKEN,
        "merge",
    )
    return {
        "status": "taken",
        "merge_token": token,
        "mine": (await accounts.summary(user.id)).model_dump(mode="json"),
        "other": (await accounts.summary(result.other_id)).model_dump(mode="json"),
        # What the merged account will have and what changes besides adding up
        "preview": (await accounts.preview_merge(user.id, result.other_id)).model_dump(mode="json"),
    }


class MergeIn(BaseModel):
    merge_token: str
    # Whose time zone (and language) the merged account keeps
    timezone: Literal["mine", "other"] = "mine"


@router.post("/api/me/merge")
async def merge(body: MergeIn, user: RegisteredUser, principal: CurrentPrincipal) -> dict:
    try:
        payload = auth.unsign(body.merge_token, BOT_TOKEN, "merge")
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    if payload.get("keep") != user.id.hex:
        raise HTTPException(status_code=403, detail="Not your merge")
    try:
        await accounts.merge(user.id, UUID(hex=payload["absorb"]), body.timezone == "other")
    except accounts.AccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    return await _me(principal)


@router.delete("/api/me/link/{kind}")
async def unlink(
    kind: auth.IdentityKind, user: RegisteredUser, principal: CurrentPrincipal
) -> dict:
    if kind == principal.kind:
        # Signed in with it: the session would point nowhere
        raise HTTPException(status_code=409, detail="Signed in with it")
    try:
        await accounts.unlink(user.id, kind)
    except accounts.LastIdentity as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    return await _me(principal)


# ====== Notifications ====== #
class NotifyIn(BaseModel):
    channels: list[Literal["telegram", "push", "email"]]


@router.put("/api/me/notify")
async def set_notify(body: NotifyIn, user: RegisteredUser, principal: CurrentPrincipal) -> dict:
    await accounts.set_channels(user.id, list(body.channels))
    return await _me(principal)


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=256)
    auth: str = Field(max_length=64)


class PushIn(BaseModel):
    endpoint: str = Field(max_length=1024, pattern=r"^https://")
    keys: PushKeys


class PushOut(BaseModel):
    endpoint: str = Field(max_length=1024)


@router.post("/api/push", status_code=204)
async def push_subscribe(body: PushIn, user: RegisteredUser) -> None:
    if not push.enabled():
        raise HTTPException(status_code=503, detail="Push is off")
    await push.subscribe(user.id, body.endpoint, body.keys.p256dh, body.keys.auth)


@router.post("/api/push/remove", status_code=204)
async def push_unsubscribe(body: PushOut, user: RegisteredUser) -> None:
    await push.unsubscribe(user.id, body.endpoint)
