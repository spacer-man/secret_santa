"""
End-to-end checks of the New Year flow on SQLite.

Run from bot/:  .venv/bin/python -m pytest tests
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

_db_file = Path(tempfile.mkdtemp()) / "test.db"
os.environ.update({
    "DB_URL": os.environ.get("TEST_DB_URL", f"sqlite+aiosqlite:///{_db_file}"),
    "BOT_TOKEN": "123456:TEST-TOKEN",
    "WISH_VALIDATE_TG_IDS": "1",
    "AUTHOR_SUPPORT_LINK": "https://example.com",
    "STATE_STORAGE_REDIS_URL": "",
    "DB_NULL_POOL": "1",
})
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import timezones  # noqa: E402
from api import auth  # noqa: E402
from api import app as api_module  # noqa: E402
from db.models import ValidStatus  # noqa: E402
from repos.wish.sqlmodel import SQLModelWishRepository  # noqa: E402
from services.delivery import DeliveryService  # noqa: E402
from services.mailer.service import MailerService  # noqa: E402

TOKEN = os.environ["BOT_TOKEN"]


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module", autouse=True)
def database():
    asyncio.set_event_loop(asyncio.new_event_loop())
    run(db.setup_relations(drop_if_exist=True))
    yield


class FakeBot:
    def __init__(self):
        self.sent: list[int] = []

    async def send_photo(self, chat_id, **_):
        self.sent.append(chat_id)


def init_data(user_id: int, start_param: str | None = None) -> str:
    fields = {
        "auth_date": str(int(time.time())),
        "user": json.dumps({"id": user_id, "first_name": "Test", "language_code": "en"}),
    }
    if start_param:
        fields["start_param"] = start_param
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


# ====== Units ====== #
def test_timezones():
    assert timezones.offset_minutes("UTC+5:30") == 330
    assert timezones.offset_minutes("UTC-3:30") == -210
    assert timezones.offset_minutes("UTC+0") == 0
    assert "UTC+14" in timezones.ALL_TIMEZONES
    now = datetime(2026, 12, 31, 10, 0, tzinfo=timezone.utc)
    assert timezones.new_year_year("UTC+14", now) == 2027
    assert timezones.new_year_year("UTC+13", now) is None
    assert timezones.new_year_year("UTC-12", datetime(2027, 1, 1, 12, tzinfo=timezone.utc)) == 2027


def test_init_data_auth():
    user = auth.check_init_data(init_data(42, "r_abc"), TOKEN)
    assert user.id == 42 and user.start_param == "r_abc"
    with pytest.raises(auth.AuthError):
        auth.check_init_data(init_data(42).replace("hash=", "hash=0"), TOKEN)


def test_session_token():
    token = auth.make_session(auth.TgUser(id=7), TOKEN)
    assert auth.read_session(token, TOKEN).id == 7
    with pytest.raises(auth.AuthError):
        auth.read_session(token + "x", TOKEN)


# ====== Flow ====== #
def test_full_new_year_flow():
    client = TestClient(api_module.app)    # lifespan (real bot) is not started
    api_module.state["bot_username"] = "santa_bot"

    class Notify:
        checked = []
        async def new_wish_to_check(self, wish):
            self.checked.append(wish.id)

    class Bot:
        messages = []
        async def send_message(self, chat_id, text, **_):
            self.messages.append((chat_id, text))

    api_module.state["notify"] = Notify()
    api_module.state["bot"] = Bot()

    def h(user_id):
        return {"Authorization": "tma " + init_data(user_id)}

    # Not registered yet
    assert client.get("/api/me", headers=h(1001)).json()["registered"] is False
    assert client.get("/api/wishes", headers=h(1001)).status_code == 403
    assert client.get("/api/me").status_code == 401

    # Alice (Moscow), invites Bob (India) and Carol (Kiribati)
    alice = client.put("/api/me", headers=h(1001), json={"timezone": "UTC+3"}).json()
    ref = alice["invite_link"].split("start=")[1]
    client.put("/api/me", headers=h(1002), json={"timezone": "UTC+5:30", "ref": ref})
    client.put("/api/me", headers=h(1003), json={"timezone": "UTC+14", "ref": ref})
    assert client.get("/api/me", headers=h(1001)).json()["invited"] == 2
    assert client.put("/api/me", headers=h(1004), json={"timezone": "UTC+99"}).status_code == 422

    # Wishes: text only and with an image
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    r = client.post("/api/wishes", headers=h(1001), data={"text": "С Новым годом от Алисы!"})
    assert r.status_code == 201
    alice_wish = r.json()["id"]
    r = client.post(
        "/api/wishes", headers=h(1002), data={"text": "Happy New Year from Bob!"},
        files=[("files", ("a.png", png, "image/png"))])
    assert r.status_code == 201
    bob_wish = r.json()["id"]
    assert client.post("/api/wishes", headers=h(1002), data={"text": "short"}).status_code == 422
    assert len(Notify.checked) == 2

    # Moderation
    from handlers.depends import wish_service
    from uuid import UUID
    for wish_id in (alice_wish, bob_wish):
        run(wish_service.update_wish_status(UUID(wish_id), ValidStatus.APPROVED))

    wishes = client.get("/api/wishes", headers=h(1002)).json()
    assert wishes[0]["status"] == "approved"
    media_url = wishes[0]["media"][0]["url"]
    media = client.get(media_url)
    assert media.status_code == 200 and media.headers["content-type"] == "image/png"
    assert client.get(media_url, headers={"Range": "bytes=0-3"}).content == b"\x89PNG"
    assert client.get(media_url.replace("t=", "t=x")).status_code == 403

    # Before the New Year
    with patch("services.delivery.utc_now", return_value=datetime(2026, 12, 31, 9, tzinfo=timezone.utc)):
        assert client.get("/api/gift", headers=h(1003)).json()["status"] == "waiting"
        assert client.post("/api/gift/open", headers=h(1003)).status_code == 409

    # 10:00 UTC 31 Dec: the New Year in UTC+14 only
    delivery_service = DeliveryService(wish_service, SQLModelWishRepository)
    bot = FakeBot()
    mailer = MailerService(bot=bot, delivery_service=delivery_service)
    mailer.send_gift = lambda reciever: bot.send_photo(reciever)
    ny_kiribati = datetime(2026, 12, 31, 10, 0, tzinfo=timezone.utc)
    run(mailer.check_ny_and_send_wishes(now=ny_kiribati))
    run(mailer.check_ny_and_send_wishes(now=ny_kiribati))  # no duplicates
    assert bot.sent == [1003]

    with patch("services.delivery.utc_now", return_value=ny_kiribati):
        assert client.get("/api/gift", headers=h(1003)).json()["status"] == "ready"
        opened = client.post("/api/gift/open", headers=h(1003)).json()
        reopened = client.post("/api/gift/open", headers=h(1003)).json()
    gift = opened["delivery"]
    assert gift["wish"]["text"] in ("С Новым годом от Алисы!", "Happy New Year from Bob!")
    assert reopened["delivery"]["wish"] == gift["wish"]    # same gift every time

    # Reaction + anonymous reply reach the author
    r = client.post(f"/api/inbox/{gift['id']}/react", headers=h(1003),
                    json={"reaction": "🔥", "reply": "Спасибо!"})
    assert r.status_code == 200
    assert client.post(f"/api/inbox/{gift['id']}/react", headers=h(1003),
                       json={"reaction": "💩"}).status_code == 422
    assert client.post(f"/api/inbox/{gift['id']}/react", headers=h(1001),
                       json={"reaction": "🔥"}).status_code == 422   # not their gift
    author_tg = 1001 if "Алисы" in gift["wish"]["text"] else 1002
    assert Bot.messages[-1][0] == author_tg and "Спасибо!" in Bot.messages[-1][1]
    feedback = client.get("/api/wishes", headers=h(author_tg)).json()[0]["feedback"]
    assert feedback == {"recipients": 1, "reactions": {"🔥": 1}, "replies": ["Спасибо!"]}
    assert len(client.get("/api/inbox", headers=h(1003)).json()) == 1

    # Delivered wishes can't be deleted
    delivered_wish = alice_wish if author_tg == 1001 else bob_wish
    assert client.delete(f"/api/wishes/{delivered_wish}", headers=h(author_tg)).status_code == 409

    # Midnight in India: Bob gets Alice's wish (the least delivered one, not his own)
    ny_india = datetime(2026, 12, 31, 18, 30, tzinfo=timezone.utc)
    run(mailer.check_ny_and_send_wishes(now=ny_india))
    assert bot.sent == [1003, 1002]
    with patch("services.delivery.utc_now", return_value=ny_india):
        bob_gift = client.post("/api/gift/open", headers=h(1002)).json()["delivery"]
    assert bob_gift["wish"]["text"] == "С Новым годом от Алисы!"

    stats = client.get("/api/stats").json()
    assert stats["participants"] == 3
    assert stats["timezones"]["UTC+5:30"] == 1
