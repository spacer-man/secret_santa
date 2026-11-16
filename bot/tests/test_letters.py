"""
Letters in a gift box: how many, which ones, the creators' letter, the old one-wish boxes.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import patch
from uuid import UUID

import pytest
from sqlalchemy import delete, text
from sqlmodel import col, select

import db
import db.core
from db import new_db_session
from db.models import CreatorsLetter, Delivery, Letter, MandarinTx, User, ValidStatus, Wish
from handlers.depends import wish_service
from helpers import run
from repos.wish.sqlmodel import SQLModelWishRepository
from services import creators
from services.delivery import MAX_LETTERS, DeliveryService

NY = datetime(2027, 1, 1, 12, tzinfo=UTC)  # the New Year everywhere

service = DeliveryService(wish_service, SQLModelWishRepository)


@pytest.fixture(autouse=True)
def database():
    asyncio.set_event_loop(asyncio.new_event_loop())
    run(db.setup_relations(drop_if_exist=True))
    yield


def people(count: int) -> list[UUID]:
    async def make() -> list[UUID]:
        async with new_db_session() as session:
            users = [User(timezone="UTC+0") for _ in range(count)]
            session.add_all(users)
            await session.commit()
            return [u.id for u in users]

    return run(make())


def write(author: UUID, count: int) -> list[UUID]:
    async def make() -> list[UUID]:
        async with new_db_session() as session:
            wishes = [
                Wish(
                    author_id=author,
                    text=f"Happy New Year #{i}",
                    valid_status=ValidStatus.APPROVED,
                    timestamp=datetime(2026, 12, 1, tzinfo=UTC),
                )
                for i in range(count)
            ]
            session.add_all(wishes)
            await session.commit()
            return [w.id for w in wishes]

    return run(make())


def open_box(user: UUID) -> list[UUID]:
    """Wish ids in the opened box"""
    with patch("services.delivery.utc_now", return_value=NY):
        gift = run(service.open(user))
    assert gift
    ids = [letter.wish.id for letter in gift.letters if letter.wish]
    assert len(ids) == len(set(ids))  # no wish twice in a box
    return ids


def authors(wish_ids: list[UUID]) -> set[UUID]:
    async def get() -> set[UUID]:
        async with new_db_session() as session:
            rows = await session.scalars(select(Wish.author_id).where(col(Wish.id).in_(wish_ids)))
            return set(rows.all())

    return run(get())


def test_more_wishes_than_people_all_delivered():
    """12 wishes by two writers, 4 readers: a share each, every wish reaches someone"""
    writer_a, writer_b, *readers = people(6)
    written = write(writer_a, 6) + write(writer_b, 6)
    got: list[UUID] = []
    for reader in readers:
        box = open_box(reader)
        # 12 wishes / 6 waiting = 2, then 10/5, 8/4, 6/3: two each
        assert len(box) == 2
        got += box
    for writer, own in ((writer_a, written[:6]), (writer_b, written[6:])):
        box = open_box(writer)
        assert not set(box) & set(own)  # never the own wish
        got += box
    assert set(got) == set(written)


def test_fewer_wishes_than_people_repeat():
    """One wish, three readers: it goes to all of them; its author gets nothing of their own"""
    author, *readers = people(4)
    (wish,) = write(author, 1)
    for reader in readers:
        assert open_box(reader) == [wish]
    assert open_box(author) == []

    async def delivered() -> tuple[int, int]:
        async with new_db_session() as session:
            row = await session.get(Wish, wish)
            rewards = await session.scalars(
                select(MandarinTx).where(MandarinTx.reason == "wish_delivered")
            )
            return (row.recipients_count if row else 0), len(rewards.all())

    # Delivered three times, rewarded once
    assert run(delivered()) == (3, 1)


def test_box_has_a_limit():
    author, reader = people(2)
    write(author, 30)
    assert len(open_box(reader)) == MAX_LETTERS


def test_least_delivered_first():
    author, first, second = people(3)
    a, b = write(author, 2)
    # 2 wishes / 3 waiting: one letter; the other one goes to the next reader
    (one,) = open_box(first)
    (two,) = open_box(second)
    assert {one, two} == {a, b}
    assert authors([one, two]) == {author}


def test_creators_letter_on_top():
    author, reader = people(2)
    write(author, 1)
    run(creators.seed(2027))
    with patch("services.delivery.utc_now", return_value=NY):
        gift = run(service.open(reader))
    assert gift
    top, letter = gift.letters
    assert top.creators and top.creators_text and top.creators_text.text == creators.DRAFT_RU
    assert letter.wish

    # An edited letter is kept by the next seed
    async def edit() -> None:
        async with new_db_session() as session:
            row = await session.get(CreatorsLetter, 2027)
            assert row
            row.text_ru = "Edited"
            session.add(row)
            await session.commit()

    run(edit())
    run(creators.seed(2027))
    assert run(creators.text(2027, "ru")) == creators.CreatorsText(
        text="Edited", signature=creators.SIGNATURE_RU
    )

    # A reaction to it: stored, no author, no mandarins
    result = run(service.react(reader, top.id, reaction="❤️", reply="Спасибо"))
    assert result.author_id is None and not result.is_new_reaction
    assert result.reaction == "❤️" and result.reply == "Спасибо"


def test_old_one_wish_boxes_become_letters():
    author, reader = people(2)
    (wish,) = write(author, 1)

    async def old_box() -> UUID:
        async with new_db_session() as session:
            box = Delivery(
                recipient_id=reader,
                year=2026,
                opened_at=datetime(2026, 1, 1, tzinfo=UTC),
                wish_id=wish,
                reaction="🔥",
                reply="Thanks",
            )
            session.add(box)
            await session.commit()
            return box.id

    box_id = run(old_box())

    async def migrate() -> list[Letter]:
        async with db.core.engine.connect() as conn:
            for statement in db.core.LETTERS_MIGRATION:
                await conn.execute(text(statement))
            await conn.commit()
        async with new_db_session() as session:
            return list((await session.scalars(select(Letter))).all())

    (letter,) = run(migrate())
    assert (letter.id, letter.delivery_id, letter.wish_id) == (box_id, box_id, wish)
    assert (letter.reaction, letter.reply) == ("🔥", "Thanks")
    assert len(run(migrate())) == 1  # runs once

    # The wish can be deleted now: the box no longer points at it
    async def drop() -> None:
        async with new_db_session() as session:
            await session.execute(delete(Letter))
            await session.execute(delete(Wish).where(Wish.id == wish))  # ty: ignore[invalid-argument-type]
            await session.commit()

    run(drop())
