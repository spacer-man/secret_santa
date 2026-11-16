"""
Accounts without Telegram: e-mail codes, Google, linking, merging, notification channels.
"""

import asyncio
import hashlib
import hmac
import re
import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

import db
from api import accounts as accounts_api
from api import app as api_module
from db import new_db_session
from db.models import Delivery, MandarinTx, User, UserItem
from helpers import init_data, run
from repos.wish.sqlmodel import SQLModelWishRepository
from services import accounts, google, push, shop
from services.delivery import DeliveryService
from services.mailer.service import MailerService

client = TestClient(api_module.app)  # lifespan (real bot) is not started


@pytest.fixture(scope="module", autouse=True)
def database():
    asyncio.set_event_loop(asyncio.new_event_loop())
    run(db.setup_relations(drop_if_exist=True))
    run(shop.seed_catalog())
    api_module.state["bot_username"] = "santa_bot"
    yield


@pytest.fixture(autouse=True)
def mail():
    """Letters are caught instead of being sent; the IP limit is reset"""
    accounts_api._email_sends.clear()
    letters: list[tuple[str, str, str]] = []

    async def send(to: str, subject: str, text: str, html: str | None = None) -> bool:
        letters.append((to, subject, text))
        return True

    with (
        patch("services.email.send", send),
        patch("services.email.enabled", return_value=True),
    ):
        yield letters


def tg(user_id: int) -> dict[str, str]:
    return {"Authorization": "tma " + init_data(user_id)}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def code_of(letters: list, email: str) -> str:
    _to, _, text = [letter for letter in letters if letter[0] == accounts.normalize_email(email)][
        -1
    ]
    match = re.search(r"\b(\d{6})\b", text)
    assert match
    return match.group(1)


def email_login(letters: list, email: str) -> str:
    assert client.post("/api/auth/email/start", json={"email": email}).status_code == 200
    r = client.post(
        "/api/auth/email/verify", json={"email": email, "code": code_of(letters, email)}
    )
    assert r.status_code == 200
    return r.json()["token"]


def user_by(**filters) -> User | None:
    async def get() -> User | None:
        async with new_db_session() as session:
            return await session.scalar(select(User).filter_by(**filters))

    return run(get())


def grant(user_id, amount: int, ref: str) -> None:
    async def add() -> None:
        async with new_db_session() as session:
            session.add(MandarinTx(user_id=user_id, amount=amount, reason="test_grant", ref=ref))
            await session.commit()

    run(add())


# ====== E-mail ====== #
def test_email_sign_in_and_register(mail):
    token = email_login(mail, "Ann@Example.com ")
    me = client.get("/api/me", headers=bearer(token)).json()
    assert me["registered"] is False

    me = client.put(
        "/api/me", headers=bearer(token), json={"timezone": "UTC+1", "language": "en"}
    ).json()
    assert me["registered"] is True
    assert me["identities"] == {"telegram": False, "email": "ann@example.com", "google": False}
    assert me["notify"] == ["telegram", "push", "email"]
    assert me["invite_link"].startswith("https://t.me/santa_bot?start=r_")

    # Everything works without Telegram
    r = client.post("/api/wishes", headers=bearer(token), data={"text": "Happy New Year, Ann!"})
    assert r.status_code == 201
    assert client.get("/api/tree", headers=bearer(token)).status_code == 200

    # Signing in again gets the same account
    again = email_login(mail, "ann@example.com")
    assert client.get("/api/me", headers=bearer(again)).json()["registered"] is True


def test_email_code_rules(mail):
    email = "codes@example.com"
    assert client.post("/api/auth/email/start", json={"email": "not-an-email"}).status_code == 422
    assert client.post("/api/auth/email/start", json={"email": email}).status_code == 200
    # A minute between letters
    assert client.post("/api/auth/email/start", json={"email": email}).status_code == 429
    code = code_of(mail, email)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(accounts.MAX_ATTEMPTS):
        r = client.post("/api/auth/email/verify", json={"email": email, "code": wrong})
        assert r.status_code == 401
    # Too many tries: even the right code is gone
    r = client.post("/api/auth/email/verify", json={"email": email, "code": code})
    assert r.status_code == 401


def test_email_ip_limit(mail):
    for i in range(accounts_api.EMAIL_PER_IP):
        r = client.post("/api/auth/email/start", json={"email": f"spam{i}@example.com"})
        assert r.status_code == 200
    r = client.post("/api/auth/email/start", json={"email": "spam-last@example.com"})
    assert r.status_code == 429


# ====== Google ====== #
def test_google_sign_in_finds_the_email_account(mail):
    token = email_login(mail, "gina.santa@gmail.com")
    client.put("/api/me", headers=bearer(token), json={"timezone": "UTC+2"})

    # Gmail: Google manages the address, so it's the same person
    who = google.GoogleUser(
        sub="g-123", email="Gina.Santa+x@gmail.com", email_verified=True, name="Gina"
    )
    with patch("services.google.verify", AsyncMock(return_value=who)):
        r = client.post("/api/auth/google", json={"credential": "jwt"})
        # The same token again: refused (a leaked one can't sign in twice)
        assert client.post("/api/auth/google", json={"credential": "jwt"}).status_code == 401
    g_token = r.json()["token"]
    me = client.get("/api/me", headers=bearer(g_token)).json()
    assert me["registered"] is True
    assert me["identities"]["email"] == "ginasanta@gmail.com" and me["identities"]["google"]
    assert me["first_name"] == "Gina"

    # Another domain: anyone could have made a Google account on that address
    token = email_login(mail, "victim@example.com")
    client.put("/api/me", headers=bearer(token), json={"timezone": "UTC+2"})
    who = google.GoogleUser(sub="g-evil", email="victim@example.com", email_verified=True)
    with patch("services.google.verify", AsyncMock(return_value=who)):
        r = client.post("/api/auth/google", json={"credential": "jwt-2"})
    me = client.get("/api/me", headers=bearer(r.json()["token"])).json()
    assert me["registered"] is False  # not let into the victim's account

    with patch("services.google.verify", AsyncMock(side_effect=google.GoogleError("bad"))):
        assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 401


# ====== Linking & merging ====== #
def test_link_free_identity(mail):
    client.put("/api/me", headers=tg(3001), json={"timezone": "UTC+3"})
    assert client.post("/api/auth/email/start", json={"email": "free@example.com"}).status_code
    r = client.post(
        "/api/me/link",
        headers=tg(3001),
        json={"email": {"email": "free@example.com", "code": code_of(mail, "free@example.com")}},
    ).json()
    assert r["status"] == "linked"
    assert r["me"]["identities"]["email"] == "free@example.com"
    # The owner hears of it (here: by the e-mail just linked; Telegram goes by the bot)
    notices = [m for m in mail if m[0] == "free@example.com" and "🔐" in m[1]]
    assert notices and "f***@e***.com" in notices[-1][2]

    # The e-mail now signs in to the Telegram account
    token = email_login(mail, "free@example.com")
    assert client.get("/api/me", headers=bearer(token)).json()["registered"] is True

    # A second e-mail: unlink the first one before
    client.post("/api/auth/email/start", json={"email": "other@example.com"})
    r = client.post(
        "/api/me/link",
        headers=tg(3001),
        json={"email": {"email": "other@example.com", "code": code_of(mail, "other@example.com")}},
    ).json()
    assert r["status"] == "replace"

    # Unlinking: not the one signed in with, not the last one
    assert client.delete("/api/me/link/telegram", headers=tg(3001)).status_code == 409
    me = client.delete("/api/me/link/email", headers=tg(3001)).json()
    assert me["identities"]["email"] is None
    assert client.delete("/api/me/link/email", headers=bearer(token)).status_code == 403


def test_merge_two_accounts(mail):
    # Telegram account: a wish, a figure on place 0, a gift of 2027
    client.put("/api/me", headers=tg(4001), json={"timezone": "UTC+3"})
    tg_user = user_by(telegram_id=4001)
    assert tg_user
    client.post("/api/wishes", headers=tg(4001), data={"text": "From the Telegram account"})
    grant(tg_user.id, 1000, "tg")
    assert (
        client.post("/api/shop/buy", headers=tg(4001), json={"item": "lantern"}).status_code == 200
    )
    client.put("/api/shop/place", headers=tg(4001), json={"item": "lantern", "pad": 0})

    # E-mail account (Bob's friend): two wishes, 5 lanterns (one on place 0), lights
    friend = client.put("/api/me", headers=tg(4999), json={"timezone": "UTC+3"}).json()
    ref = friend["invite_link"].split("start=")[1]
    token = email_login(mail, "merge@example.com")
    client.put("/api/me", headers=bearer(token), json={"timezone": "UTC-5", "ref": ref})
    mail_user = user_by(email="merge@example.com")
    assert mail_user
    for text in ("From the e-mail account 1", "From the e-mail account 2"):
        client.post("/api/wishes", headers=bearer(token), data={"text": text})
    grant(mail_user.id, 2000, "mail")
    for _ in range(5):
        assert (
            client.post(
                "/api/shop/buy", headers=bearer(token), json={"item": "lantern"}
            ).status_code
            == 200
        )
    client.put("/api/shop/place", headers=bearer(token), json={"item": "lantern", "pad": 0})
    client.post("/api/shop/buy", headers=bearer(token), json={"item": "lights-warm"})
    lantern_price = 80

    mine = accounts_api_summary(tg(4001))
    other = accounts_api_summary(bearer(token))
    balance_before = mine["mandarins"] + other["mandarins"]

    # Link the e-mail from the Telegram account: it's taken, a merge is offered
    client.post("/api/auth/email/start", json={"email": "merge@example.com"})
    accounts_api._email_sends.clear()
    r = client.post(
        "/api/me/link",
        headers=tg(4001),
        json={"email": {"email": "merge@example.com", "code": code_of(mail, "merge@example.com")}},
    ).json()
    assert r["status"] == "taken"
    assert r["mine"]["wishes"] == 1 and r["other"]["wishes"] == 2
    assert r["other"]["identities"] == ["email"]
    # The preview is the merge done and rolled back: nothing changed yet
    preview = r["preview"]
    assert preview["report"]["refunded"] == 1 and preview["report"]["unplaced"] == 1
    assert preview["report"]["refunded_mandarins"] == lantern_price
    assert user_by(id=mail_user.id) is not None
    # Asked, not decided by chance: both have their own time zone, language, yard place
    assert preview["report"]["conflicts"] == ["timezone", "language", "yard"]
    assert r["locked"] == ["telegram"]  # the Mini App keeps its Telegram

    # Somebody else can't use the token
    client.put("/api/me", headers=tg(4002), json={"timezone": "UTC+3"})
    bad = client.post("/api/me/merge", headers=tg(4002), json={"merge_token": r["merge_token"]})
    assert bad.status_code == 403

    choices = {"timezone": "other", "language": "mine", "yard": "mine"}
    again = client.post(
        "/api/me/merge/preview",
        headers=tg(4001),
        json={"merge_token": r["merge_token"], "choices": choices},
    ).json()
    assert again["result"]["timezone"] == "UTC-5"
    no = client.post(
        "/api/me/merge",
        headers=tg(4001),
        json={"merge_token": r["merge_token"], "choices": {"telegram": "other"}},
    )
    assert no.status_code == 409
    done = client.post(
        "/api/me/merge",
        headers=tg(4001),
        json={"merge_token": r["merge_token"], "choices": choices},
    ).json()
    assert "token" not in done  # signed in with Telegram: it stays
    me = done["me"]
    assert me["identities"] == {"telegram": True, "email": "merge@example.com", "google": False}
    assert me["timezone"] == "UTC-5"
    assert user_by(id=mail_user.id) is None

    # The e-mail signs in to the merged account
    after = client.get("/api/me", headers=bearer(token)).json()
    assert after["registered"] and after["identities"]["telegram"]

    merged = accounts_api_summary(tg(4001))
    assert merged["wishes"] == 3
    # 6 lanterns + lights: one lantern over the limit is paid back
    assert merged["figures"] == 5 + 1
    assert merged["mandarins"] == balance_before + lantern_price
    # What was promised is what happened
    # The other account's e-mail is masked in what is shown before the merge
    assert again["result"]["email"] == "m***@e***.com" == r["other"]["email"]
    assert {**again["result"], "email": "merge@example.com"} == merged
    shop_items = {i["key"]: i for i in client.get("/api/shop", headers=tg(4001)).json()["items"]}
    assert shop_items["lantern"]["count"] == 5
    assert shop_items["lantern"]["pads"] == [0]  # one figure on a place, the other put away
    # The friend who invited the e-mail account now has the merged one as a friend
    assert client.get("/api/me", headers=tg(4999)).json()["invited"] == 1

    # The token is single-account: a second merge finds nothing
    again = client.post("/api/me/merge", headers=tg(4001), json={"merge_token": r["merge_token"]})
    assert again.status_code == 409


def accounts_api_summary(headers: dict[str, str]) -> dict:
    user_id = client_user_id(headers)
    return run(accounts.summary(user_id)).model_dump(mode="json")


def client_user_id(headers: dict[str, str]):
    from api import auth
    from api.deps import BOT_TOKEN

    principal = auth.parse_authorization(headers["Authorization"], BOT_TOKEN)
    user = run(accounts.get_user(principal))
    assert user
    return user.id


def test_merge_keeps_one_gift_a_year():
    a = run(accounts.register(principal("telegram", "5001"), "UTC+3", None, None))
    b = run(accounts.register(principal("telegram", "5002"), "UTC+3", None, None))
    opened = datetime(2027, 1, 1, tzinfo=UTC)

    async def gifts() -> None:
        async with new_db_session() as session:
            session.add(Delivery(recipient_id=a.id, year=2027))
            session.add(Delivery(recipient_id=b.id, year=2027, opened_at=opened))
            session.add(Delivery(recipient_id=b.id, year=2026, opened_at=opened))
            await session.commit()

    run(gifts())
    run(accounts.merge(a.id, b.id))

    async def years() -> list[tuple[int, bool]]:
        async with new_db_session() as session:
            rows = await session.scalars(select(Delivery).where(Delivery.recipient_id == a.id))
            return sorted((d.year, d.opened_at is not None) for d in rows)

    # The opened gift of 2027 won over the unopened one
    assert run(years()) == [(2026, True), (2027, True)]
    # Telegram ids can't both stay: the kept account has its own
    assert user_by(telegram_id=5002) is None


def test_merge_asks_whose_email_and_gift(mail):
    """Both have an e-mail and a gift of 2027: the person chooses, the session follows"""
    a_token = email_login(mail, "a@example.com")
    client.put("/api/me", headers=bearer(a_token), json={"timezone": "UTC+3"})
    b_token = email_login(mail, "b@example.com")
    client.put("/api/me", headers=bearer(b_token), json={"timezone": "UTC+3"})
    a, b = user_by(email="a@example.com"), user_by(email="b@example.com")
    assert a and b
    opened = datetime(2027, 1, 1, tzinfo=UTC)

    async def gifts() -> None:
        async with new_db_session() as session:
            mine = Delivery(recipient_id=a.id, year=2027, opened_at=opened, reaction="🔥")
            theirs = Delivery(recipient_id=b.id, year=2027, opened_at=opened, reaction="❤️")
            session.add_all([mine, theirs])
            # Each was rewarded for opening
            for d, owner in ((mine, a), (theirs, b)):
                session.add(
                    MandarinTx(user_id=owner.id, amount=50, reason="gift_opened", ref=str(d.id))
                )
            await session.commit()

    run(gifts())
    accounts_api._email_sends.clear()
    client.post("/api/auth/email/start", json={"email": "b@example.com"})
    r = client.post(
        "/api/me/link",
        headers=bearer(a_token),
        json={"email": {"email": "b@example.com", "code": code_of(mail, "b@example.com")}},
    ).json()
    assert r["status"] == "taken"
    assert r["preview"]["report"]["conflicts"] == ["email", "gifts"]
    assert r["locked"] == []
    dropped = r["preview"]["report"]["identities_dropped"]
    # The other account's address is shown masked
    assert dropped == [{"kind": "email", "side": "other", "email": "b***@e***.com"}]

    choices = {"email": "other", "gifts": "other"}
    preview = client.post(
        "/api/me/merge/preview",
        headers=bearer(a_token),
        json={"merge_token": r["merge_token"], "choices": choices},
    ).json()
    assert preview["result"]["email"] == "b***@e***.com"
    assert preview["report"]["identities_dropped"][0]["email"] == "a@example.com"  # own one

    done = client.post(
        "/api/me/merge",
        headers=bearer(a_token),
        json={"merge_token": r["merge_token"], "choices": choices},
    ).json()
    # The session signed in with a@ which went away: a new one with b@
    assert done["me"]["identities"]["email"] == "b@example.com"
    assert client.get("/api/me", headers=bearer(done["token"])).json()["registered"]
    assert client.get("/api/me", headers=bearer(a_token)).json()["registered"] is False

    async def reactions() -> list[str | None]:
        async with new_db_session() as session:
            rows = await session.scalars(select(Delivery).where(Delivery.recipient_id == a.id))
            return [d.reaction for d in rows]

    assert run(reactions()) == ["❤️"]  # the other account's gift, as chosen

    async def opening_rewards() -> int:
        async with new_db_session() as session:
            rows = await session.scalars(
                select(MandarinTx)
                .where(MandarinTx.user_id == a.id)
                .where(MandarinTx.reason == "gift_opened")
            )
            return len(rows.all())

    assert run(opening_rewards()) == 1  # one gift a year, one reward for it


# ====== Security ====== #
def widget(user_id: int, age_s: int = 0) -> dict:
    """Telegram Login Widget data signed like Telegram does"""
    from helpers import TOKEN

    fields = {"id": str(user_id), "first_name": "W", "auth_date": str(int(time.time()) - age_s)}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hashlib.sha256(TOKEN.encode()).digest()
    sign = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return {**fields, "id": user_id, "auth_date": int(fields["auth_date"]), "hash": sign}


def test_widget_data_works_once_and_fresh():
    data = widget(8001)
    assert client.post("/api/auth/telegram", json=data).status_code == 200
    # Replayed (a leaked payload): refused
    assert client.post("/api/auth/telegram", json=data).status_code == 401
    # Older than 10 minutes: refused
    assert client.post("/api/auth/telegram", json=widget(8001, age_s=11 * 60)).status_code == 401
    # Forged: refused
    forged = {**widget(8002), "id": 8003}
    assert client.post("/api/auth/telegram", json=forged).status_code == 401


def test_old_session_must_confirm_before_changing_sign_in(mail):
    """A session left open somewhere (or a stolen token) can't plant another way in"""
    from api import auth
    from api.deps import BOT_TOKEN

    fresh = email_login(mail, "owner@example.com")
    client.put("/api/me", headers=bearer(fresh), json={"timezone": "UTC+3"})
    old = auth.make_session(
        auth.Principal(kind="email", key="owner@example.com", issued_at=int(time.time()) - 3600),
        BOT_TOKEN,
    )
    # Reading is fine, changing the ways in is not
    assert client.get("/api/me", headers=bearer(old)).json()["registered"]
    r = client.post("/api/me/link", headers=bearer(old), json={"telegram": widget(8101)})
    assert r.status_code == 403 and r.json()["detail"] == "reauth_required"
    assert client.delete("/api/me/link/google", headers=bearer(old)).status_code == 403

    # Confirming with another account's way in: refused
    stranger = email_login(mail, "stranger@example.com")
    client.put("/api/me", headers=bearer(stranger), json={"timezone": "UTC+3"})
    accounts_api._email_sends.clear()
    client.post("/api/auth/email/start", json={"email": "stranger@example.com"})
    code = code_of(mail, "stranger@example.com")
    r = client.post(
        "/api/me/reauth",
        headers=bearer(old),
        json={"email": {"email": "stranger@example.com", "code": code}},
    )
    assert r.status_code == 403

    # Confirming with its own: a fresh session, and linking works
    client.post("/api/auth/email/start", json={"email": "owner@example.com"})
    code = code_of(mail, "owner@example.com")
    r = client.post(
        "/api/me/reauth",
        headers=bearer(old),
        json={"email": {"email": "owner@example.com", "code": code}},
    )
    renewed = r.json()["token"]
    r = client.post("/api/me/link", headers=bearer(renewed), json={"telegram": widget(8101)})
    assert r.json()["status"] == "linked"


def test_email_code_day_limits(mail):
    email = "guess@example.com"
    # Guessing: 15 wrong codes a day close the address, even for the right code later
    for _ in range(3):
        row_reset_sent(email)
        assert client.post("/api/auth/email/start", json={"email": email}).status_code == 200
        for _ in range(accounts.MAX_ATTEMPTS):
            client.post("/api/auth/email/verify", json={"email": email, "code": "000000x"[:6]})
    row_reset_sent(email)
    assert client.post("/api/auth/email/start", json={"email": email}).status_code == 429

    # Mail bombing: 10 letters a day to one address
    email = "bomb@example.com"
    for _ in range(accounts.DAY_SENDS):
        row_reset_sent(email)
        accounts_api._email_sends.clear()
        assert client.post("/api/auth/email/start", json={"email": email}).status_code == 200
    row_reset_sent(email)
    assert client.post("/api/auth/email/start", json={"email": email}).status_code == 429


def row_reset_sent(email: str) -> None:
    """Moves the last letter a minute back (instead of waiting)"""
    from datetime import timedelta

    from db.models import EmailCode

    async def go() -> None:
        async with new_db_session() as session:
            row = await session.get(EmailCode, email)
            if row:
                row.sent_at = row.sent_at - timedelta(minutes=2)
                session.add(row)
                await session.commit()

    accounts_api._email_sends.clear()
    run(go())


def test_gmail_aliases_are_one_address():
    assert accounts.normalize_email("A.Na+santa@GoogleMail.com") == "ana@gmail.com"
    assert accounts.normalize_email("a.na+x@example.com") == "a.na+x@example.com"
    assert accounts.mask_email("anna@gmail.com") == "a***@g***.com"


def principal(kind, key):
    from api.auth import Principal

    return Principal(kind=kind, key=key)


# ====== Notifications ====== #
def test_notify_channels_and_push():
    client.put("/api/me", headers=tg(6001), json={"timezone": "UTC+3"})
    me = client.put("/api/me/notify", headers=tg(6001), json={"channels": ["push"]}).json()
    assert me["notify"] == ["push"]
    assert client.put("/api/me/notify", headers=tg(6001), json={"channels": ["sms"]}).status_code

    sub = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "k", "auth": "a"}}
    assert client.post("/api/push", headers=tg(6001), json=sub).status_code == 503
    with patch("services.push.enabled", return_value=True):
        assert client.post("/api/push", headers=tg(6001), json=sub).status_code == 204
        assert client.post("/api/push", headers=tg(6001), json=sub).status_code == 204
    assert client.get("/api/me", headers=tg(6001)).json()["push_devices"] == 1
    client.post("/api/push/remove", headers=tg(6001), json={"endpoint": sub["endpoint"]})
    assert client.get("/api/me", headers=tg(6001)).json()["push_devices"] == 0


def test_vapid_keys_sign():
    from py_vapid import Vapid

    public, private = push.generate_keys()
    vapid = Vapid.from_string(private)
    headers = vapid.sign({"aud": "https://push.example.com", "sub": "mailto:a@b.c"})
    assert "vapid" in headers["Authorization"].lower() or "WebPush" in headers["Authorization"]
    assert len(public) == 87  # 65 bytes, base64url


def test_new_year_by_email_and_push(mail):
    """A user without Telegram gets the gift by the chosen channels"""
    token = email_login(mail, "ny@example.com")
    client.put("/api/me", headers=bearer(token), json={"timezone": "UTC+12", "language": "en"})
    quiet = email_login(mail, "quiet@example.com")
    client.put("/api/me", headers=bearer(quiet), json={"timezone": "UTC+12"})
    client.put("/api/me/notify", headers=bearer(quiet), json={"channels": ["push"]})

    from handlers.depends import wish_service

    bot = AsyncMock()
    mailer = MailerService(
        bot=bot, delivery_service=DeliveryService(wish_service, SQLModelWishRepository)
    )
    pushes = AsyncMock(return_value=1)
    with patch("services.push.send", pushes):
        run(mailer.check_ny_and_send_wishes(now=datetime(2026, 12, 31, 12, 0, tzinfo=UTC)))

    gift_letters = [
        letter for letter in mail if "greeting" in letter[1] or "поздравление" in letter[1]
    ]
    assert [letter[0] for letter in gift_letters] == ["ny@example.com"]
    assert "Happy New Year" in gift_letters[0][2]
    assert pushes.await_count == 2
    bot.send_photo.assert_not_called()  # nobody here has Telegram


def test_items_are_kept_by_user_item_table():
    # Sanity: merged items really belong to the kept account in the DB
    async def orphans() -> int:
        async with new_db_session() as session:
            ids = set((await session.scalars(select(User.id))).all())
            items = (await session.scalars(select(UserItem.user_id))).all()
            return sum(1 for user_id in items if user_id not in ids)

    assert run(orphans()) == 0
