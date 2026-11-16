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

import hashlib
import logging
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services import accounts, email, google, notifier, push, sessions

from . import auth
from .deps import (
    BOT_TOKEN,
    AnyUser,
    CurrentPrincipal,
    FreshUser,
    RegisteredUser,
    require_fresh,
)

log = logging.getLogger(__name__)

router = APIRouter()

# A Google ID token lives an hour
GOOGLE_TOKEN_TTL_S = 3600

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


async def _token(principal: auth.Principal, request: Request) -> dict:
    """A new session (a row in the list of sessions) and its token"""
    sid = await sessions.start(
        principal.kind,
        principal.key,
        request.headers.get("user-agent", ""),
        _client_ip(request),
    )
    return {"token": auth.make_session(principal, BOT_TOKEN, sid)}


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


async def _once(proof: str, ttl_s: int) -> None:
    """Each proof of identity works once (a leaked one can't be replayed)"""
    digest = hashlib.sha256(proof.encode()).hexdigest()
    try:
        await accounts.consume_proof(digest, timedelta(seconds=ttl_s))
    except accounts.ProofUsed as err:
        raise HTTPException(status_code=401, detail=str(err)) from err


async def telegram_principal(data: LoginWidgetData) -> auth.Principal:
    """Telegram Login Widget: signed by Telegram, fresh (10 min) and used once"""
    try:
        user = auth.check_login_widget(data.model_dump(), BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    await _once(f"tg:{data.hash}", auth.LOGIN_MAX_AGE)
    return auth.Principal.telegram(user)


async def email_principal(body: EmailCodeIn) -> auth.Principal:
    """A code from the letter: once, 5 tries a code, 15 a day an address"""
    address = _email_or_422(body.email)
    if not await accounts.check_email_code(address, body.code, BOT_TOKEN):
        raise HTTPException(status_code=401, detail="Wrong or expired code")
    return auth.Principal(kind="email", key=address, issued_at=int(time.time()))


async def google_principal(body: GoogleIn) -> tuple[auth.Principal, google.GoogleUser]:
    """Google ID token: signed by Google for our client id, not expired, used once"""
    try:
        user = await google.verify(body.credential)
    except google.GoogleError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    await _once(f"google:{body.credential}", GOOGLE_TOKEN_TTL_S)
    principal = auth.Principal(
        kind="google", key=user.sub, first_name=user.name, issued_at=int(time.time())
    )
    return principal, user


async def proof_principal(body: "LinkIn") -> auth.Principal:
    if body.telegram:
        return await telegram_principal(body.telegram)
    if body.email:
        return await email_principal(body.email)
    if body.google:
        return (await google_principal(body.google))[0]
    raise HTTPException(status_code=422, detail="Nothing to prove")


def _bot():
    from .app import state  # app imports this module

    return state.get("bot")


async def _notice(user_id: UUID, key: str, kind: str, email_masked: str | None = None, **extra):
    try:
        await notifier.security(_bot(), user_id, key, kind, email_masked, **extra)
    except Exception:
        log.warning("Security notice failed", exc_info=True)


# ====== Sign in ====== #
@router.post("/api/auth/telegram")
async def login_by_widget(data: LoginWidgetData, request: Request) -> dict:
    return await _token(await telegram_principal(data), request)


@router.post("/api/auth/email/start")
async def email_start(body: EmailStartIn, request: Request) -> dict:
    """Send a sign-in code (also used to prove an e-mail when linking it)"""
    if not email.enabled():
        raise HTTPException(status_code=503, detail="E-mail is off")
    address = _email_or_422(body.email)
    _limit_ip(request)
    try:
        code = await accounts.new_email_code(address, BOT_TOKEN)
    except (accounts.TooSoon, accounts.TooMany) as err:
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
async def email_verify(body: EmailCodeIn, request: Request) -> dict:
    return await _token(await email_principal(body), request)


@router.post("/api/auth/google")
async def login_by_google(body: GoogleIn, request: Request) -> dict:
    principal, user = await google_principal(body)
    # The same person came by e-mail before: only an address Google itself manages (Gmail,
    # Workspace) proves it's them; any other could have been registered by someone else
    trusted = user.trusted_email
    if trusted and not await accounts.get_user(principal):
        address = accounts.normalize_email(trusted)
        owner = (
            await accounts.get_user(auth.Principal(kind="email", key=address)) if address else None
        )
        if owner and owner.google_id is None:
            await accounts.link(owner.id, principal)
            await _notice(owner.id, "sec_linked", "google")
    return await _token(principal, request)


# ====== Linking & merging ====== #
class LinkIn(BaseModel):
    telegram: LoginWidgetData | None = None
    email: EmailCodeIn | None = None
    google: GoogleIn | None = None


async def _me(principal: auth.Principal) -> dict:
    from .app import me_payload  # app imports this module

    return await me_payload(principal, await accounts.get_user(principal))


def _masked(summary: accounts.AccountSummary, own_email: str | None) -> dict:
    """An account summary to show: an e-mail that isn't the caller's own is masked"""
    data = summary.model_dump(mode="json")
    if data.get("email") and data["email"] != own_email:
        data["email"] = accounts.mask_email(data["email"])
    return data


def _masked_preview(preview: accounts.MergePreview, own_email: str | None) -> dict:
    data = preview.model_dump(mode="json")
    data["result"] = _masked(preview.result, own_email)
    for gone in data["report"]["identities_dropped"]:
        if gone.get("email") and gone["email"] != own_email:
            gone["email"] = accounts.mask_email(gone["email"])
    return data


@router.post("/api/me/link")
async def link(body: LinkIn, user: FreshUser, principal: CurrentPrincipal) -> dict:
    """
    Add a way to sign in (a recent sign-in is needed: ``FreshUser``). ``status``:
    ``linked`` / ``same`` (done, ``me`` is fresh); ``replace``: the account already has another
    one of this kind (unlink it first); ``taken``: it has its own account: ``merge_token`` and
    both summaries to decide (the other account's e-mail masked).
    """
    other = await proof_principal(body)
    result = await accounts.link(user.id, other)
    if result.status == "linked":
        address = other.key if other.kind == "email" else None
        await _notice(user.id, "sec_linked", other.kind, accounts.mask_email(address))
    if result.status != "taken" or not result.other_id:
        return {"status": result.status, "me": await _me(principal)}

    token = auth.sign(
        {"keep": user.id.hex, "absorb": result.other_id.hex, "exp": int(time.time()) + MERGE_TTL},
        BOT_TOKEN,
        "merge",
    )
    preview = await accounts.preview_merge(user.id, result.other_id)
    return {
        "status": "taken",
        "merge_token": token,
        "mine": _masked(await accounts.summary(user.id), user.email),
        "other": _masked(await accounts.summary(result.other_id), user.email),
        # What the merged account will have, what must be chosen and what changes
        "preview": _masked_preview(preview, user.email),
        # Ways to sign in that can't be given up here (the Mini App signs in by its Telegram)
        "locked": ["telegram"] if principal.via_tma else [],
    }


class MergeIn(BaseModel):
    merge_token: str
    choices: accounts.MergeChoices = accounts.MergeChoices()


def _merge_pair(body: MergeIn, user_id: UUID, principal: auth.Principal) -> UUID:
    """The other account of a merge token made for this user; the choices allowed here"""
    try:
        payload = auth.unsign(body.merge_token, BOT_TOKEN, "merge")
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    if payload.get("keep") != user_id.hex:
        raise HTTPException(status_code=403, detail="Not your merge")
    if principal.via_tma and body.choices.telegram == "other":
        raise HTTPException(status_code=409, detail="The Mini App keeps its Telegram")
    return UUID(hex=payload["absorb"])


@router.post("/api/me/merge/preview")
async def merge_preview(body: MergeIn, user: FreshUser, principal: CurrentPrincipal) -> dict:
    """The preview again, with other choices"""
    absorb = _merge_pair(body, user.id, principal)
    try:
        preview = await accounts.preview_merge(user.id, absorb, body.choices)
    except accounts.AccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    return _masked_preview(preview, user.email)


@router.post("/api/me/merge")
async def merge(body: MergeIn, user: FreshUser, principal: CurrentPrincipal) -> dict:
    """
    ``{"me": ...}``, plus ``token`` when the way this session signed in went away (the other
    account's one of the same kind was chosen): the new session signs in with that one.
    Both owners hear of it: the merged account by all its ways, a way that left by itself.
    """
    absorb = _merge_pair(body, user.id, principal)
    try:
        before = await accounts.get_by_id(absorb)
        await accounts.merge(user.id, absorb, body.choices)
    except accounts.AccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    merged = await accounts.get_by_id(user.id)

    # Who the absorbed account signed in with, and which of its ways didn't stay
    came = next((k for k, c in accounts.COLUMNS.items() if getattr(before, c) is not None), "email")
    gone_tg = (before.telegram_id,) if before.telegram_id not in (None, merged.telegram_id) else ()
    gone_mail = (before.email,) if before.email and before.email != merged.email else ()
    # Sessions of the ways in that didn't stay end with them
    for kind, value in (
        ("telegram", gone_tg[0] if gone_tg else None),
        ("email", gone_mail[0] if gone_mail else None),
        ("google", before.google_id if before.google_id not in (None, merged.google_id) else None),
    ):
        if value is not None:
            await sessions.end_identity(kind, str(value))
    await _notice(
        user.id,
        "sec_merged",
        came,
        accounts.mask_email(before.email),
        also_telegram=gone_tg,
        also_email=gone_mail,
    )

    if await accounts.get_user(principal):
        return {"me": await _me(principal)}
    value = getattr(merged, accounts.COLUMNS[principal.kind])
    fresh = auth.Principal(
        kind=principal.kind,
        key=str(value),
        first_name=principal.first_name,
        issued_at=principal.issued_at,
    )
    # The same session, now signed in with the way that stayed
    await sessions.move(principal.session_id, fresh.kind, fresh.key)
    token = auth.make_session(fresh, BOT_TOKEN, principal.session_id)
    return {"me": await _me(fresh), "token": token}


@router.delete("/api/me/link/{kind}")
async def unlink(kind: auth.IdentityKind, user: FreshUser, principal: CurrentPrincipal) -> dict:
    if kind == principal.kind:
        # Signed in with it: the session would point nowhere
        raise HTTPException(status_code=409, detail="Signed in with it")
    old_tg, old_mail = user.telegram_id, user.email
    old_value = getattr(user, accounts.COLUMNS[kind])
    try:
        await accounts.unlink(user.id, kind)
    except accounts.LastIdentity as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    if old_value is not None:
        await sessions.end_identity(kind, str(old_value))
    # The way that left hears it too: if it wasn't the owner who removed it, they'll know
    await _notice(
        user.id,
        "sec_unlinked",
        kind,
        accounts.mask_email(old_mail if kind == "email" else None),
        also_telegram=(old_tg,) if kind == "telegram" and old_tg else (),
        also_email=(old_mail,) if kind == "email" and old_mail else (),
    )
    return await _me(principal)


@router.post("/api/me/reauth")
async def reauth(
    body: LinkIn, user: AnyUser, principal: CurrentPrincipal, request: Request
) -> dict:
    """
    Confirm it's the owner (before linking, unlinking or merging): any way to sign in of this
    same account. Gives a fresh session token for that way.
    """
    if principal.via_tma:
        raise HTTPException(status_code=409, detail="reopen_required")
    proved = await proof_principal(body)
    owner = await accounts.get_user(proved)
    if not owner or owner.id != user.id:
        raise HTTPException(status_code=403, detail="Not this account")
    # A new sign-in: a new session instead of this one
    if principal.session_id:
        await sessions.end(user, principal.session_id)
    return {**await _token(proved, request), "me": await _me(proved)}


# ====== Sessions, deletion ====== #
async def _renewed(principal: auth.Principal, request: Request) -> dict:
    """
    After the others were ended: this one keeps its session (an old token without one gets
    a session and a new token; the Mini App has none)
    """
    if principal.via_tma or principal.session_id:
        return {}
    return await _token(principal, request)


@router.post("/api/me/logout-all")
async def logout_all(user: RegisteredUser, principal: CurrentPrincipal, request: Request) -> dict:
    """
    Sign out on every device: all session tokens stop working; this one gets a new token.
    (The Telegram Mini App signs in by Telegram itself: it isn't ended.)
    """
    await accounts.end_sessions(user.id)
    await sessions.end_all(user, keep=principal.session_id)
    return {**await _renewed(principal, request), "me": await _me(principal)}


@router.delete("/api/me")
async def delete_me(user: FreshUser, principal: CurrentPrincipal, request: Request) -> dict:
    """
    Delete the account: hidden from everything at once, every other session ended, erased for
    good in 30 days unless restored (signing in shows the restore page)
    """
    purge_at = await accounts.delete_account(user.id)
    await sessions.end_all(user, keep=principal.session_id)
    await _notice(user.id, "sec_deleted", principal.kind, date=purge_at.date().isoformat())
    return {**await _renewed(principal, request), "me": await _me(principal)}


@router.post("/api/me/restore")
async def restore_me(user: AnyUser, principal: CurrentPrincipal) -> dict:
    try:
        await accounts.restore_account(user.id)
    except accounts.AccountError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    await _notice(user.id, "sec_restored", principal.kind)
    return await _me(principal)


@router.post("/api/me/erase", status_code=204)
async def erase_me(user: AnyUser, principal: CurrentPrincipal) -> None:
    """Erase a deleted account now, without waiting 30 days (a recent sign-in is needed)"""
    if not user.deleted_at:
        raise HTTPException(status_code=409, detail="Delete the account first")
    require_fresh(principal)
    await accounts.purge_account(user.id)


@router.get("/api/me/sessions")
async def my_sessions(user: AnyUser, principal: CurrentPrincipal) -> dict:
    """Where the account is signed in on the website / PWA (the Mini App isn't listed)"""
    listed = await sessions.listed(user, principal.session_id)
    return {
        "sessions": [s.model_dump(mode="json") for s in listed],
        # This device signed in before sessions were listed (or is the Mini App)
        "current_listed": any(s.current for s in listed),
    }


@router.delete("/api/me/sessions/{session_id}")
async def end_session(session_id: str, user: AnyUser, principal: CurrentPrincipal) -> dict:
    """End one session: that device is signed out at its next request"""
    if not await sessions.end(user, session_id):
        raise HTTPException(status_code=404)
    listed = await sessions.listed(user, principal.session_id)
    return {"sessions": [s.model_dump(mode="json") for s in listed]}


@router.post("/api/me/logout", status_code=204)
async def logout(principal: CurrentPrincipal) -> None:
    """Sign out on this device: its session ends on the server too"""
    user = await accounts.get_user(principal)
    if user and principal.session_id:
        await sessions.end(user, principal.session_id)


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
