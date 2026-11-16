"""
The New Year letter from the creators: on top of every gift box of the season.

The text lives in the DB (:class:`CreatorsLetter`, one row per season) to be edited without
a deploy; the API seeds the draft below when the season has no letter yet.
"""

from pydantic import BaseModel

from db import new_db_session
from db.models import CreatorsLetter

DRAFT_RU = """С Новым годом!

Пока ты читаешь это, где-то на планете до полуночи ещё несколько часов, а где-то Новый год \
давно наступил. Праздник идёт по Земле волной, и вместе с ним идут письма: люди из разных \
городов и стран писали их незнакомцу. То есть тебе.

Мы придумали «Тайного Санту» ради простой вещи: доброе слово от того, кто ничего о тебе не \
знает и ничего не ждёт взамен, — это маленькое чудо. Год назад нас было одиннадцать. \
Сегодня каждый, кто написал поздравление, зажёг шар на чьей-то ёлке.

Поставь реакцию авторам писем — им будет приятно узнать, что поздравление дошло. А если \
захочется сказать что-то нам, ответь на это письмо: мы прочитаем каждое.

Пусть новый год будет тёплым, а чудеса — настоящими."""

DRAFT_EN = """Happy New Year!

As you read this, somewhere on the planet midnight is still hours away, and somewhere the New \
Year came long ago. The holiday rolls around the Earth like a wave, and the letters travel \
with it: people from different cities and countries wrote them to a stranger. That is, to you.

We made Secret Santa for one simple thing: a kind word from someone who knows nothing about \
you and expects nothing back is a small miracle. A year ago there were eleven of us. Today \
everyone who wrote a wish has lit a ball on someone's tree.

Send a reaction to the authors — they'll be glad to know their wish arrived. And if you want \
to tell us something, reply to this letter: we read every one.

May the new year be warm and its miracles real."""

SIGNATURE_RU = "Создатели Тайного Санты 🎅"
SIGNATURE_EN = "The Secret Santa team 🎅"


class CreatorsText(BaseModel):
    text: str
    signature: str


async def seed(year: int) -> None:
    """The draft for the season, if it has no letter yet (an edited one is kept)"""
    async with new_db_session() as session:
        if await session.get(CreatorsLetter, year):
            return None
        session.add(
            CreatorsLetter(
                year=year,
                text_ru=DRAFT_RU,
                text_en=DRAFT_EN,
                signature_ru=SIGNATURE_RU,
                signature_en=SIGNATURE_EN,
            )
        )
        await session.commit()


async def exists(session, year: int) -> bool:
    return await session.get(CreatorsLetter, year) is not None


async def text(year: int, language: str | None) -> CreatorsText | None:
    async with new_db_session() as session:
        letter = await session.get(CreatorsLetter, year)
    if not letter:
        return None
    if language == "en":
        return CreatorsText(text=letter.text_en, signature=letter.signature_en)
    return CreatorsText(text=letter.text_ru, signature=letter.signature_ru)
