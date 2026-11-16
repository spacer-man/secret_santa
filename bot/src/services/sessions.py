"""
Sessions: every sign-in on the website / PWA is a row; the session token carries its id.
The owner sees them all (device, a part of the IP, last activity) and can end any of them.

A session belongs to the way of signing in (kind + key), so the sessions of an account are
the sessions of its ways in; after a merge they follow the identity.
"""

import ipaddress
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, or_
from sqlmodel import col, delete, select

from db import new_db_session
from db.models import Session, User

# Last activity is written at most this often (not on every request)
TOUCH_EVERY = timedelta(minutes=5)


def utc_now() -> datetime:
    return datetime.now(UTC)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


_BROWSERS = (
    ("Edge", r"Edg/"),
    ("Opera", r"OPR/|Opera"),
    ("Yandex", r"YaBrowser"),
    ("Samsung", r"SamsungBrowser"),
    ("Firefox", r"Firefox|FxiOS"),
    ("Chrome", r"Chrome|CriOS"),
    ("Safari", r"Safari"),
)
_SYSTEMS = (
    ("iPhone", r"iPhone"),
    ("iPad", r"iPad"),
    ("Android", r"Android"),
    ("Windows", r"Windows"),
    ("macOS", r"Mac OS X|Macintosh"),
    ("Linux", r"Linux"),
)


def device_of(user_agent: str) -> str:
    """'Chrome · Android': enough to recognise a device, nothing more is kept"""
    browser = next((n for n, pattern in _BROWSERS if re.search(pattern, user_agent)), "")
    system = next((n for n, pattern in _SYSTEMS if re.search(pattern, user_agent)), "")
    return " · ".join(part for part in (browser, system) if part)[:64]


def ip_part(raw: str) -> str:
    """The network part only (95.31.*.*): to recognise "that's my home", not to locate"""
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        return ""
    if address.version == 4:
        first, second, *_ = str(address).split(".")
        return f"{first}.{second}.*.*"
    groups = address.exploded.split(":")
    return f"{groups[0]}:{groups[1]}:*"


async def start(kind: str, key: str, user_agent: str, ip: str) -> str:
    async with new_db_session() as session:
        row = Session(kind=kind, key=key, device=device_of(user_agent), ip=ip_part(ip))
        session.add(row)
        await session.commit()
        return str(row.id)


async def alive(session_id: str, kind: str, key: str) -> bool:
    """The session exists for this way in; its last activity is noted now and then"""
    try:
        sid = UUID(session_id)
    except ValueError:
        return False
    async with new_db_session() as session:
        row = await session.get(Session, sid)
        if not row or row.kind != kind or row.key != key:
            return False
        now = utc_now()
        if now - _aware(row.last_seen_at) > TOUCH_EVERY:
            row.last_seen_at = now
            session.add(row)
            await session.commit()
        return True


async def move(session_id: str | None, kind: str, key: str) -> None:
    """The way in of this session changed (a merge kept the other one of its kind)"""
    if not session_id:
        return None
    async with new_db_session() as session:
        row = await session.get(Session, UUID(session_id))
        if row:
            row.kind, row.key = kind, key
            session.add(row)
            await session.commit()


def _of_user(user: User) -> ColumnElement[bool]:
    ways = [
        and_(col(Session.kind) == kind, col(Session.key) == str(value))
        for kind, value in (
            ("telegram", user.telegram_id),
            ("email", user.email),
            ("google", user.google_id),
        )
        if value is not None
    ]
    return or_(*ways) if ways else col(Session.id).is_(None)


class SessionOut(BaseModel):
    id: str
    current: bool
    kind: str
    device: str
    ip: str
    created_at: datetime
    last_seen_at: datetime


async def listed(user: User, current: str | None) -> list[SessionOut]:
    async with new_db_session() as session:
        rows = (
            await session.scalars(
                select(Session).where(_of_user(user)).order_by(col(Session.last_seen_at).desc())
            )
        ).all()
    return [
        SessionOut(
            id=str(row.id),
            current=str(row.id) == current,
            kind=row.kind,
            device=row.device,
            ip=row.ip,
            created_at=_aware(row.created_at),
            last_seen_at=_aware(row.last_seen_at),
        )
        for row in rows
    ]


async def end(user: User, session_id: str) -> bool:
    """End one session of this account; False if there's no such"""
    try:
        sid = UUID(session_id)
    except ValueError:
        return False
    async with new_db_session() as session:
        result = await session.execute(
            delete(Session).where(col(Session.id) == sid).where(_of_user(user))
        )
        await session.commit()
        return bool(getattr(result, "rowcount", 0))


async def end_all(user: User, keep: str | None = None) -> None:
    """End every session of this account (but ``keep``)"""
    async with new_db_session() as session:
        stmt = delete(Session).where(_of_user(user))
        if keep:
            stmt = stmt.where(col(Session.id) != UUID(keep))
        await session.execute(stmt)
        await session.commit()


async def end_identity(kind: str, key: str) -> None:
    """A way in left the account (unlinked, erased): its sessions end"""
    async with new_db_session() as session:
        await session.execute(
            delete(Session).where(col(Session.kind) == kind).where(col(Session.key) == key)
        )
        await session.commit()
