"""
The user's New Year tree.

Every wish of the season is a ball:
  * ``box``  — written, waits for moderation (lies in a box under the tree);
  * ``hung`` — approved, hangs on the tree;
  * ``lit``  — delivered to someone at the New Year: glows.
Plus: a star on top for the opened gift, a garland for invited friends,
and the festive level (1..10) that changes the whole scene.
"""

import random
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from sqlmodel import col, select

from db import new_db_session
from db.models import Delivery, ValidStatus, Wish
from services import debug, mandarins, shop
from services.delivery import DeliveryService, current_season_year, season_start

BALL_COLORS = ("red", "gold", "silver", "blue", "green", "purple", "pink", "orange")
BALL_PATTERNS = ("plain", "stripes", "dots", "snowflake", "zigzag", "stars")

# Festive points needed for levels 1..10
LEVELS = (0, 2, 6, 12, 20, 30, 42, 56, 72, 90)
POINTS = {"hung": 3, "lit": 6, "friend": 4, "star": 8, "reaction": 1}
MAX_GARLAND = 10  # friends shown as garland bulbs


class Ball(BaseModel):
    id: UUID
    color: str
    pattern: str
    state: str  # box | hung | lit
    reactions: dict[str, int]
    replies: int


class Decor(BaseModel):
    item: str
    pad: int


class Tree(BaseModel):
    year: int
    balls: list[Ball]
    star: bool
    garland: int
    mandarins: int
    decor: list[Decor]
    owned: list[str]
    level: int
    points: int
    level_from: int
    level_to: int | None


def default_look(wish_id: UUID) -> tuple[str, str]:
    """Wishes written in the bot get a stable random look"""
    rnd = random.Random(wish_id.int)
    return rnd.choice(BALL_COLORS), rnd.choice(BALL_PATTERNS)


def festive_level(points: int) -> tuple[int, int, int | None]:
    """(level, points at the level start, points of the next level)"""
    level = sum(1 for threshold in LEVELS if points >= threshold)
    next_points = LEVELS[level] if level < len(LEVELS) else None
    return level, LEVELS[level - 1], next_points


async def build_tree(
    user_id: UUID,
    delivery_service: DeliveryService,
    now: datetime | None = None,
) -> Tree:
    now = now or datetime.now(UTC)
    year = current_season_year(now)

    friends = await shop.ensure_milestones(user_id)  # also grants milestone decorations

    async with new_db_session() as session:
        wishes = (
            await session.scalars(
                select(Wish)
                .where(Wish.author_id == user_id)
                .where(Wish.valid_status != ValidStatus.REJECTED)
                .where(col(Wish.timestamp) >= season_start(year))
                .order_by(col(Wish.timestamp))
            )
        ).all()
        star = bool(
            await session.scalar(
                select(Delivery.id)
                .where(Delivery.recipient_id == user_id)
                .where(Delivery.year == year)
                .where(col(Delivery.opened_at).is_not(None))
            )
        )
        balance = await mandarins.balance(session, user_id)
        owned = await shop.owned_items(session, user_id)

    feedback = await delivery_service.feedback(w.id for w in wishes)
    balls = []
    for wish in wishes:
        fb = feedback[wish.id]
        if wish.valid_status == ValidStatus.ON_VALIDATION:
            state = "box"
        elif fb.recipients:
            state = "lit"
        else:
            state = "hung"
        color, pattern = default_look(wish.id)
        balls.append(
            Ball(
                id=wish.id,
                color=wish.ball_color if wish.ball_color in BALL_COLORS else color,
                pattern=wish.ball_pattern if wish.ball_pattern in BALL_PATTERNS else pattern,
                state=state,
                reactions=fb.reactions,
                replies=len(fb.replies),
            )
        )

    points = (
        sum(POINTS[b.state] for b in balls if b.state != "box")
        + sum(sum(b.reactions.values()) for b in balls) * POINTS["reaction"]
        + min(friends, MAX_GARLAND) * POINTS["friend"]
        + (POINTS["star"] if star else 0)
        + shop.decor_points(owned)
    )
    level, level_from, level_to = festive_level(points)
    forced = debug.forced_level(user_id)
    if forced is not None:
        # Debug: the level is shown as if its points were just reached
        level, level_from, level_to = festive_level(LEVELS[forced - 1])
        points = level_from

    return Tree(
        year=year,
        balls=balls,
        star=star,
        garland=min(friends, MAX_GARLAND),
        mandarins=balance,
        decor=[Decor(item=u.item_key, pad=u.pad) for u, _ in owned if u.pad is not None],
        owned=[u.item_key for u, _ in owned],
        level=level,
        points=points,
        level_from=level_from,
        level_to=level_to,
    )
