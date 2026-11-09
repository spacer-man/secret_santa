"""
HTTP API for the Telegram Mini App and the website.
"""
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import col, select

import db
import timezones
from configs.bot import BotConfig
from configs.notify import NotifyConfig
from db import new_db_session
from db.models import Delivery, Media, MediaType, ValidStatus, Wish
from handlers.referral import parse_ref_code, ref_code
from repos.media.sqlmodel import SQLModelMediaRepository
from repos.user.sqlmodel import SQLModelUserRepository
from repos.wish.sqlmodel import SQLModelWishRepository
from services import mandarins
from services.delivery import (
    REACTIONS,
    DeliveryDTO,
    DeliveryError,
    DeliveryService,
    current_season_year,
    season_start,
)
from services.tree import BALL_COLORS, BALL_PATTERNS, build_tree
from services.feedback import notify_author
from services.notify import AiogramNotifyService
from services.user import UserService
from services.wish import WishService
from . import auth
from .media import (
    check_media_token,
    media_type_by_mime,
    media_url,
    ranged_response,
    sniff_mime,
)


log = logging.getLogger(__name__)

BOT_TOKEN = BotConfig().token.get_secret_value()

MAX_MEDIA_SIZE = 10 * 2 ** 20
MAX_MEDIA_PER_WISH = 5
MAX_WISHES_PER_SEASON = 10


user_service = UserService(user_repo_type=SQLModelUserRepository)
wish_service = WishService(
    user_repo_type=SQLModelUserRepository,
    wish_repo_type=SQLModelWishRepository,
    media_repo_type=SQLModelMediaRepository)
delivery_service = DeliveryService(
    wish_service=wish_service,
    wish_repo_type=SQLModelWishRepository)

state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.setup_relations()
    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN))
    state["bot"] = bot
    state["bot_username"] = (await bot.me()).username
    state["notify"] = AiogramNotifyService(
        bot=bot, reciever_tg_ids=NotifyConfig().wish_validate_tg_ids)
    yield
    await bot.session.close()


app = FastAPI(title="Secret Santa API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


# ====== Auth ====== #
async def current_user(
        authorization: Annotated[str | None, Header()] = None,
        ) -> auth.TgUser:
    try:
        return auth.parse_authorization(authorization, BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err))


CurrentUser = Annotated[auth.TgUser, Depends(current_user)]


async def registered_user(tg_user: CurrentUser):
    user = await user_service.get(telegram_id=tg_user.id)
    if not user:
        raise HTTPException(status_code=403, detail="Not registered")
    return user


class LoginWidgetData(BaseModel):
    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    photo_url: str | None = None
    auth_date: int
    hash: str


@app.post("/api/auth/telegram")
async def login_by_widget(data: LoginWidgetData) -> dict:
    try:
        user = auth.check_login_widget(data.model_dump(), BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err))
    return {"token": auth.make_session(user, BOT_TOKEN)}


# ====== Public ====== #
@app.get("/api/config")
async def config() -> dict:
    return {
        "bot_username": state.get("bot_username"),
        "reactions": REACTIONS,
        "timezones": timezones.ALL_TIMEZONES,
        "ball_colors": BALL_COLORS,
        "ball_patterns": BALL_PATTERNS,
        "rewards": mandarins.REWARDS,
    }


@app.get("/api/stats")
async def stats() -> dict:
    return await delivery_service.stats()


# ====== Profile ====== #
def new_year_moment(tz: str, now: datetime | None = None) -> datetime:
    """The closest (or current, during 1 January) New Year midnight in UTC"""
    local = timezones.local_now(tz, now)
    year = local.year if (local.month == 1 and local.day == 1) else local.year + 1
    offset = timedelta(minutes=timezones.offset_minutes(tz))
    return datetime(year, 1, 1, tzinfo=timezone.utc) - offset


@app.get("/api/me")
async def me(tg_user: CurrentUser) -> dict:
    user = await user_service.get(telegram_id=tg_user.id)
    if not user:
        return {"registered": False, "first_name": tg_user.first_name}

    username = state.get("bot_username")
    return {
        "registered": True,
        "first_name": tg_user.first_name,
        "timezone": user.timezone,
        "new_year_at": new_year_moment(user.timezone) if timezones.is_valid(user.timezone) else None,
        "invite_link": f"https://t.me/{username}?start={ref_code(user.id)}" if username else None,
        "invited": await delivery_service.invited_count(tg_user.id),
    }


class ProfileIn(BaseModel):
    timezone: str
    ref: str | None = None


@app.put("/api/me")
async def save_profile(tg_user: CurrentUser, body: ProfileIn) -> dict:
    if not timezones.is_valid(body.timezone):
        raise HTTPException(status_code=422, detail="Unknown timezone")

    if await user_service.is_registered(telegram_id=tg_user.id):
        await user_service.edit_user(telegram_id=tg_user.id, timezone=body.timezone)
    else:
        await user_service.register(
            telegram_id=tg_user.id,
            timezone=body.timezone,
            language=(tg_user.language_code or "")[:8] or None,
            referrer_id=parse_ref_code(body.ref or tg_user.start_param))
    return await me(tg_user)


# ====== Wishes ====== #
async def media_of(wish_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """Media list (without bytes) of the wishes"""
    result: dict[UUID, list[dict]] = {wish_id: [] for wish_id in wish_ids}
    if not wish_ids:
        return result
    async with new_db_session() as session:
        rows = (await session.execute(
            select(Media.id, Media.wish_id, Media.type)
            .where(col(Media.wish_id).in_(wish_ids))
            .order_by(col(Media.id)))).all()
    for media_id, wish_id, media_type in rows:
        result[wish_id].append({"id": media_id, "type": media_type, "url": media_url(media_id, BOT_TOKEN)})
    return result


@app.get("/api/wishes")
async def my_wishes(user=Depends(registered_user)) -> list[dict]:
    async with new_db_session() as session:
        wishes = (await session.scalars(
            select(Wish)
            .where(Wish.author_id == user.id)
            .order_by(col(Wish.timestamp).desc()))).all()

    ids = [w.id for w in wishes]
    media = await media_of(ids)
    feedback = await delivery_service.feedback(ids)
    return [{
        "id": w.id,
        "text": w.text,
        "timestamp": w.timestamp,
        "status": w.valid_status,
        "media": media[w.id],
        "feedback": feedback[w.id],
    } for w in wishes]


@app.post("/api/wishes", status_code=201)
async def new_wish(
        user=Depends(registered_user),
        text: str = Form(min_length=8, max_length=4096),
        files: list[UploadFile] = File(default=[]),
        ball_color: str | None = Form(default=None),
        ball_pattern: str | None = Form(default=None),
        ) -> dict:
    if len(files) > MAX_MEDIA_PER_WISH:
        raise HTTPException(status_code=422, detail=f"Max {MAX_MEDIA_PER_WISH} files")

    if ball_color not in (None, *BALL_COLORS) or ball_pattern not in (None, *BALL_PATTERNS):
        raise HTTPException(status_code=422, detail="Unknown ball look")

    year = current_season_year()
    async with new_db_session() as session:
        count = await session.scalar(
            select(func.count(col(Wish.id)))
            .where(Wish.author_id == user.id)
            .where(col(Wish.timestamp) >= season_start(year)))
    if (count or 0) >= MAX_WISHES_PER_SEASON:
        raise HTTPException(status_code=429, detail="Too many wishes")

    media = []
    for file in files:
        data = await file.read(MAX_MEDIA_SIZE + 1)
        if len(data) > MAX_MEDIA_SIZE:
            raise HTTPException(status_code=413, detail="File is too large")
        media_type = media_type_by_mime(file.content_type or "")
        if not media_type:
            raise HTTPException(status_code=415, detail=f"Unsupported file: {file.content_type}")
        media.append({"data": data, "type": media_type})

    wish_id = await wish_service.new_wish(
        author_telegram_id=user.telegram_id,
        text=text.strip(),
        media=media,
        ball_color=ball_color,
        ball_pattern=ball_pattern)

    if wish := await wish_service.get_one(wish_id):
        try:
            await state["notify"].new_wish_to_check(wish)
        except Exception:
            log.exception("Failed to send wish to moderation")
    return {"id": wish_id}


@app.delete("/api/wishes/{wish_id}", status_code=204)
async def delete_wish(wish_id: UUID, user=Depends(registered_user)) -> None:
    async with new_db_session() as session:
        wish = await session.get(Wish, wish_id)
        delivered = await session.scalar(
            select(func.count(col(Delivery.id))).where(Delivery.wish_id == wish_id))
    if not wish or wish.author_id != user.id:
        raise HTTPException(status_code=404)
    if delivered:
        raise HTTPException(status_code=409, detail="Wish is already delivered")
    await wish_service.delete(wish_id)


# ====== Tree & mandarins ====== #
@app.get("/api/tree")
async def tree(user=Depends(registered_user)) -> dict:
    return (await build_tree(user.id, delivery_service)).model_dump(mode="json")


@app.get("/api/mandarins")
async def mandarins_history(user=Depends(registered_user)) -> dict:
    async with new_db_session() as session:
        return {
            "balance": await mandarins.balance(session, user.id),
            "history": [
                {"amount": tx.amount, "reason": tx.reason, "created_at": tx.created_at}
                for tx in await mandarins.history(session, user.id)
            ],
        }


# ====== Gifts ====== #
async def delivery_out(delivery: DeliveryDTO) -> dict:
    wish = None
    if delivery.wish:
        media = await media_of([delivery.wish.id])
        wish = {"text": delivery.wish.text, "media": media[delivery.wish.id]}
    return {
        "id": delivery.id,
        "year": delivery.year,
        "opened_at": delivery.opened_at,
        "reaction": delivery.reaction,
        "reply": delivery.reply,
        "wish": wish,
    }


@app.get("/api/gift")
async def gift(user=Depends(registered_user)) -> dict:
    """Current gift: ``waiting`` (New Year hasn't come), ``ready`` or ``opened``"""
    delivery = await delivery_service.current(user.telegram_id)
    if not delivery:
        return {"status": "waiting", "new_year_at": new_year_moment(user.timezone)}
    if not delivery.opened_at:
        return {"status": "ready"}
    return {"status": "opened", "delivery": await delivery_out(delivery)}


@app.post("/api/gift/open")
async def open_gift(user=Depends(registered_user)) -> dict:
    delivery = await delivery_service.open(user.telegram_id)
    if not delivery:
        raise HTTPException(status_code=409, detail="New Year hasn't come yet")
    return {"status": "opened", "delivery": await delivery_out(delivery)}


@app.get("/api/inbox")
async def inbox(user=Depends(registered_user)) -> list[dict]:
    return [await delivery_out(d) for d in await delivery_service.inbox(user.telegram_id)]


class ReactionIn(BaseModel):
    reaction: str | None = None
    reply: str | None = Field(default=None, max_length=1024)


@app.post("/api/inbox/{delivery_id}/react")
async def react(delivery_id: UUID, body: ReactionIn, user=Depends(registered_user)) -> dict:
    try:
        result = await delivery_service.react(
            telegram_id=user.telegram_id,
            delivery_id=delivery_id,
            reaction=body.reaction,
            reply=body.reply)
    except DeliveryError as err:
        raise HTTPException(status_code=422, detail=str(err))
    await notify_author(bot=state["bot"], result=result)
    return {"reaction": result.reaction, "reply": result.reply}


# ====== Media ====== #
@app.get("/api/media/{media_id}")
async def media(media_id: UUID, t: str, request: Request):
    if not check_media_token(media_id, t, BOT_TOKEN):
        raise HTTPException(status_code=403)
    async with new_db_session() as session:
        item = await session.get(Media, media_id)
    if not item:
        raise HTTPException(status_code=404)
    return ranged_response(request, item.data, sniff_mime(item.data, MediaType(item.type)))
