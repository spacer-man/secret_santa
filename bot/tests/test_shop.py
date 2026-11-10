"""
Decoration shop: catalog, purchases, courtyard placement, milestone gifts, set bonus.
"""

import asyncio
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

import db
from api import app as api_module
from db import new_db_session
from db.models import MandarinTx, ShopItem, User
from helpers import init_data, run
from services import shop

client = TestClient(api_module.app)  # lifespan (real bot) is not started


@pytest.fixture(scope="module", autouse=True)
def database():
    asyncio.set_event_loop(asyncio.new_event_loop())
    run(db.setup_relations(drop_if_exist=True))
    run(shop.seed_catalog())
    api_module.state["bot_username"] = "santa_bot"
    yield


def h(user_id: int) -> dict[str, str]:
    return {"Authorization": "tma " + init_data(user_id)}


def register(user_id: int, ref: str | None = None) -> str:
    body = {"timezone": "UTC+3", **({"ref": ref} if ref else {})}
    return client.put("/api/me", headers=h(user_id), json=body).json()["invite_link"].split("=")[1]


def user_uuid(telegram_id: int) -> UUID:
    async def get() -> UUID:
        async with new_db_session() as session:
            return (
                await session.scalars(select(User.id).where(User.telegram_id == telegram_id))
            ).one()

    return run(get())


def give(telegram_id: int, amount: int, ref: str) -> None:
    user_id = user_uuid(telegram_id)

    async def add() -> None:
        async with new_db_session() as session:
            session.add(MandarinTx(user_id=user_id, amount=amount, reason="test_grant", ref=ref))
            await session.commit()

    run(add())


def buy(user_id: int, item: str):
    return client.post("/api/shop/buy", headers=h(user_id), json={"item": item})


def place(user_id: int, item: str, pad: int | None):
    return client.put("/api/shop/place", headers=h(user_id), json={"item": item, "pad": pad})


def shop_items(user_id: int) -> dict[str, dict]:
    payload = client.get("/api/shop", headers=h(user_id)).json()
    return {i["key"]: i for i in payload["items"]}


def test_catalog_seeded_and_idempotent():
    async def count() -> int:
        async with new_db_session() as session:
            return len((await session.scalars(select(ShopItem))).all())

    before = run(count())
    assert before == len(shop.DEFAULT_CATALOG)

    async def tweak() -> None:
        async with new_db_session() as session:
            item = await session.get(ShopItem, "snowman")
            assert item
            item.price = 777
            session.add(item)
            await session.commit()

    run(tweak())
    run(shop.seed_catalog())
    assert run(count()) == before

    register(2001)
    items = shop_items(2001)
    assert items["snowman"]["price"] == 777  # existing rows are not overwritten
    assert items["snowman"]["set"] == "yard" and items["snowman"]["owned"] is False
    assert items["nutcracker"]["friends"] == 10
    run(_set_price("snowman", 150))  # restore for the next tests


async def _set_price(key: str, price: int) -> None:
    async with new_db_session() as session:
        item = await session.get(ShopItem, key)
        assert item
        item.price = price
        session.add(item)
        await session.commit()


def test_buy_flow():
    register(2101)
    assert client.get("/api/shop").status_code == 401
    assert buy(2101, "candy-cane").status_code == 402  # no mandarins
    assert buy(2101, "nope").status_code == 404

    give(2101, 100, "a")
    r = buy(2101, "candy-cane")
    assert r.status_code == 200
    body = r.json()
    assert body["balance"] == 40 and body["bonus"] == 0
    cane = next(i for i in body["items"] if i["key"] == "candy-cane")
    assert cane["owned"] is True and cane["pad"] is None
    assert buy(2101, "candy-cane").status_code == 409

    history = client.get("/api/mandarins", headers=h(2101)).json()
    assert {"amount": -60, "reason": "purchase"} in [
        {"amount": tx["amount"], "reason": tx["reason"]} for tx in history["history"]
    ]
    assert history["balance"] == 40
    assert "purchase" not in client.get("/api/config").json()["rewards"]


def test_milestone_gifts():
    ref = register(2201)
    assert buy(2201, "candy-cane-green").status_code == 403
    assert shop_items(2201)["candy-cane-green"]["owned"] is False

    register(2202, ref)
    items = shop_items(2201)
    assert items["candy-cane-green"]["owned"] is True
    assert items["sled-long"]["owned"] is False
    assert client.get("/api/shop", headers=h(2201)).json()["friends"] == 1
    assert "candy-cane-green" in client.get("/api/tree", headers=h(2201)).json()["owned"]


def test_place_move_swap_unplace():
    register(2301)
    give(2301, 1000, "a")
    for key in ("candy-cane", "snowman", "lantern", "lights-warm"):
        assert buy(2301, key).status_code == 200

    assert place(2301, "snowman", 3).status_code == 200
    assert shop_items(2301)["snowman"]["pad"] == 3
    # move
    place(2301, "snowman", 4)
    assert shop_items(2301)["snowman"]["pad"] == 4
    # onto an occupied pad: the previous one is taken off
    place(2301, "candy-cane", 4)
    items = shop_items(2301)
    assert items["candy-cane"]["pad"] == 4 and items["snowman"]["pad"] is None
    # unplace
    r = place(2301, "candy-cane", None)
    assert r.status_code == 200 and shop_items(2301)["candy-cane"]["pad"] is None

    assert place(2301, "snowman", 15).status_code == 400
    assert place(2301, "snowman", -1).status_code == 400
    assert place(2301, "lights-warm", 1).status_code == 400  # not a figure
    assert place(2301, "reindeer", 1).status_code == 403  # not owned


def test_set_bonus_once():
    register(2401)
    give(2401, 1000, "a")
    for key in ("candy-cane", "snowman-classic", "snowman"):
        assert buy(2401, key).json()["bonus"] == 0
    r = buy(2401, "sled").json()
    assert r["bonus"] == shop.SET_BONUS["yard"]
    assert r["balance"] == 1000 - 60 - 100 - 150 - 180 + 100
    assert next(s for s in r["sets"] if s["key"] == "yard")["done"] is True

    # Buying an unrelated item doesn't pay it again
    assert buy(2401, "lantern").json()["bonus"] == 0
    bonuses = [
        tx
        for tx in client.get("/api/mandarins", headers=h(2401)).json()["history"]
        if tx["reason"] == "set_bonus"
    ]
    assert len(bonuses) == 1


def test_tree_decor_and_level_points():
    register(2501)
    give(2501, 500, "a")
    tree = client.get("/api/tree", headers=h(2501)).json()
    assert tree["decor"] == [] and tree["owned"] == []
    base = tree["points"]

    buy(2501, "snowman")  # rare figure
    buy(2501, "lights-gold")  # common lights
    tree = client.get("/api/tree", headers=h(2501)).json()
    assert tree["owned"] == ["snowman", "lights-gold"]
    assert tree["points"] == base + 2  # the figure is not placed: only lights count

    place(2501, "snowman", 2)
    tree = client.get("/api/tree", headers=h(2501)).json()
    assert tree["decor"] == [{"item": "snowman", "pad": 2}]
    assert tree["points"] == base + 2 + 4
