"""
Authentication of Telegram users.

* Telegram Mini App: every request carries ``Authorization: tma <initData>``,
  signed by Telegram with the bot token.
* Website: Telegram Login Widget data is checked once and exchanged for
  our own signed session token (``Authorization: Bearer <token>``).

Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
      https://core.telegram.org/widgets/login#checking-authorization
"""
import base64
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from pydantic import BaseModel


INIT_DATA_MAX_AGE = 7 * 24 * 3600
LOGIN_MAX_AGE = 24 * 3600
SESSION_MAX_AGE = 30 * 24 * 3600


class AuthError(Exception):
    pass


class TgUser(BaseModel):
    id: int
    first_name: str | None = None
    language_code: str | None = None
    start_param: str | None = None


def _hmac(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


def _check_string(fields: dict[str, str]) -> str:
    return "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))


def check_init_data(init_data: str, bot_token: str, now: float | None = None) -> TgUser:
    fields = dict(parse_qsl(init_data, keep_blank_values=True))
    # Everything except "hash" is checked ("signature" too)
    received_hash = fields.pop("hash", "")
    secret = _hmac(b"WebAppData", bot_token.encode())
    expected = hmac.new(
        secret, _check_string(fields).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise AuthError("Bad initData signature")

    now = now or time.time()
    if now - int(fields.get("auth_date", 0)) > INIT_DATA_MAX_AGE:
        raise AuthError("initData is too old")

    user = json.loads(fields.get("user", "{}"))
    if "id" not in user:
        raise AuthError("No user in initData")
    return TgUser(
        id=user["id"],
        first_name=user.get("first_name"),
        language_code=user.get("language_code"),
        start_param=fields.get("start_param"))


def check_login_widget(data: dict, bot_token: str, now: float | None = None) -> TgUser:
    fields = {k: str(v) for k, v in data.items() if v is not None}
    received_hash = fields.pop("hash", "")
    secret = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(
        secret, _check_string(fields).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise AuthError("Bad login signature")

    now = now or time.time()
    if now - int(fields.get("auth_date", 0)) > LOGIN_MAX_AGE:
        raise AuthError("Login data is too old")
    return TgUser(id=int(fields["id"]), first_name=fields.get("first_name"))


# ====== Our own signed tokens ====== #
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _signer_key(bot_token: str, purpose: str) -> bytes:
    return _hmac(bot_token.encode(), purpose.encode())


def sign(payload: dict, bot_token: str, purpose: str) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(_hmac(_signer_key(bot_token, purpose), body.encode()))
    return f"{body}.{sig}"


def unsign(token: str, bot_token: str, purpose: str, now: float | None = None) -> dict:
    try:
        body, sig = token.split(".")
        expected = _b64(_hmac(_signer_key(bot_token, purpose), body.encode()))
        if not hmac.compare_digest(expected, sig):
            raise AuthError("Bad token signature")
        payload = json.loads(_unb64(body))
    except AuthError:
        raise
    except Exception as err:
        raise AuthError("Bad token") from err

    if payload.get("exp", 0) < (now or time.time()):
        raise AuthError("Token expired")
    return payload


def make_session(user: TgUser, bot_token: str) -> str:
    return sign(
        {"id": user.id, "fn": user.first_name, "exp": int(time.time()) + SESSION_MAX_AGE},
        bot_token, "session")


def read_session(token: str, bot_token: str) -> TgUser:
    payload = unsign(token, bot_token, "session")
    return TgUser(id=payload["id"], first_name=payload.get("fn"))


def parse_authorization(header: str | None, bot_token: str) -> TgUser:
    if not header:
        raise AuthError("No Authorization header")
    scheme, _, value = header.partition(" ")
    match scheme.lower():
        case "tma":
            return check_init_data(value, bot_token)
        case "bearer":
            return read_session(value, bot_token)
    raise AuthError("Unknown auth scheme")
