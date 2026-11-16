"""
Accounts: ways to sign in, linking them and merging two accounts of one person.

An account (``User``) has up to three identities: Telegram id, e-mail, Google account id.
Any of them signs in to the same account. A person who made two accounts (say, in the bot
and on the site by e-mail) links the second identity and is offered to merge: everything
moves to the account they are signed in to, the other one is deleted.
"""

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select, update

from api.auth import IdentityKind, Principal
from db import new_db_session
from db.models import (
    Delivery,
    EmailCode,
    MandarinTx,
    PushSubscription,
    ShopItem,
    User,
    UserItem,
    Wish,
)
from services import mandarins
from services.notifier import CHANNELS, lang_of
from services.shop import max_copies

CODE_TTL = timedelta(minutes=10)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5
CODE_LENGTH = 6


# Identity kind -> User column
COLUMNS: dict[IdentityKind, str] = {
    "telegram": "telegram_id",
    "email": "email",
    "google": "google_id",
}

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


class AccountError(Exception):
    pass


class TooSoon(AccountError):
    pass


class LastIdentity(AccountError):
    pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def _aware(moment: datetime) -> datetime:
    # SQLite gives naive datetimes back
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def normalize_email(raw: str) -> str | None:
    email = raw.strip().lower()
    return email if len(email) <= 254 and _EMAIL.match(email) else None


def _value(principal: Principal) -> int | str:
    return int(principal.key) if principal.kind == "telegram" else principal.key


# ====== Lookup & registration ====== #
async def find_user(session: AsyncSession, principal: Principal) -> User | None:
    column = getattr(User, COLUMNS[principal.kind])
    return await session.scalar(select(User).where(column == _value(principal)))


async def get_user(principal: Principal) -> User | None:
    async with new_db_session() as session:
        return await find_user(session, principal)


async def register(
    principal: Principal,
    timezone: str,
    language: str | None,
    referrer_id: UUID | None,
) -> User:
    """A new account for this identity (the caller has checked there is none)"""
    async with new_db_session() as session:
        if referrer_id and not await session.get(User, referrer_id):
            referrer_id = None
        user = User(timezone=timezone, language=language, referrer_id=referrer_id)
        setattr(user, COLUMNS[principal.kind], _value(principal))
        if principal.kind != "telegram":
            user.name = (principal.first_name or "")[:64] or None
        session.add(user)
        await session.flush()
        if referrer_id:
            await mandarins.award(session, referrer_id, mandarins.Reason.FRIEND_JOINED, user.id)
        await session.commit()
        return user


# ====== E-mail codes ====== #
def _code_hash(email: str, code: str, secret: str) -> str:
    return hmac.new(secret.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


async def new_email_code(email: str, secret: str) -> str:
    """
    A new one-time code for the e-mail (the previous one stops working).
    ``TooSoon`` if a code was sent less than a minute ago.
    """
    async with new_db_session() as session:
        row = await session.get(EmailCode, email)
        now = utc_now()
        if row and now - _aware(row.sent_at) < RESEND_AFTER:
            raise TooSoon("A code was sent less than a minute ago")
        code = "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))
        row = row or EmailCode(email=email, code_hash="")
        row.code_hash, row.attempts, row.sent_at = _code_hash(email, code, secret), 0, now
        session.add(row)
        await session.commit()
    return code


async def check_email_code(email: str, code: str, secret: str) -> bool:
    """The code is right (it can be used once, after 5 wrong tries it's gone)"""
    async with new_db_session() as session:
        row = await session.get(EmailCode, email)
        if not row:
            return False
        if utc_now() - _aware(row.sent_at) > CODE_TTL or row.attempts >= MAX_ATTEMPTS:
            await session.delete(row)
            await session.commit()
            return False
        if hmac.compare_digest(row.code_hash, _code_hash(email, code.strip(), secret)):
            await session.delete(row)
            await session.commit()
            return True
        row.attempts += 1
        session.add(row)
        await session.commit()
        return False


# ====== Linking ====== #
class LinkResult(BaseModel):
    # linked: added to the account; same: it was already this account's;
    # taken: it belongs to another account (merge offered); replace: the account has
    # another identity of this kind
    status: str
    other_id: UUID | None = None


async def link(user_id: UUID, principal: Principal) -> LinkResult:
    column = COLUMNS[principal.kind]
    async with new_db_session() as session:
        user = await session.get(User, user_id)
        if not user:
            raise AccountError("No such user")
        owner = await find_user(session, principal)
        if owner and owner.id == user.id:
            return LinkResult(status="same")
        if owner:
            return LinkResult(status="taken", other_id=owner.id)
        if getattr(user, column) is not None:
            return LinkResult(status="replace")
        setattr(user, column, _value(principal))
        if principal.kind != "telegram" and not user.name and principal.first_name:
            user.name = principal.first_name[:64]
        session.add(user)
        await session.commit()
    return LinkResult(status="linked")


def identities(user: User) -> list[IdentityKind]:
    return [kind for kind, column in COLUMNS.items() if getattr(user, column) is not None]


async def unlink(user_id: UUID, kind: IdentityKind) -> None:
    """Forget a way to sign in; the last one can't be removed (the account would be lost)"""
    async with new_db_session() as session:
        user = await session.get(User, user_id)
        if not user:
            raise AccountError("No such user")
        if identities(user) == [kind] or not identities(user):
            raise LastIdentity("The last way to sign in can't be removed")
        setattr(user, COLUMNS[kind], None)
        session.add(user)
        await session.commit()


# ====== Notification channels ====== #
def channels(user: User) -> list[str]:
    """Chosen channels (None in the DB: all of them)"""
    if user.notify is None:
        return list(CHANNELS)
    return [c for c in user.notify.split(",") if c in CHANNELS]


async def set_channels(user_id: UUID, chosen: list[str]) -> None:
    async with new_db_session() as session:
        user = await session.get(User, user_id)
        if not user:
            raise AccountError("No such user")
        user.notify = ",".join(c for c in CHANNELS if c in chosen)
        session.add(user)
        await session.commit()


# ====== Merge ====== #
Side = Literal["mine", "other"]


class MergeChoices(BaseModel):
    """
    Whose to keep where both accounts have their own and only one can stay. Nothing is decided
    by chance: every such place is listed in ``MergeReport.conflicts`` and asked.
    """

    timezone: Side = "mine"
    language: Side = "mine"
    # Notification channels
    notify: Side = "mine"
    # Ways to sign in that both accounts have (each account has its own)
    telegram: Side = "mine"
    email: Side = "mine"
    google: Side = "mine"
    # Whose figure stays on a courtyard place both accounts use (the other is put away)
    yard: Side = "mine"
    # Whose gift stays for a year both accounts opened a gift in
    gifts: Side = "mine"


CHOICES = tuple(MergeChoices.model_fields)


class AccountSummary(BaseModel):
    """What an account has: shown before a merge (and what the merged one will have)"""

    registered_at: datetime
    timezone: str
    language: str
    notify: list[str]
    identities: list[IdentityKind]
    email: str | None = None
    wishes: int
    mandarins: int
    figures: int
    gifts: int
    friends: int


class DroppedIdentity(BaseModel):
    kind: IdentityKind
    # Whose one goes away
    side: Side
    email: str | None = None


class MergeReport(BaseModel):
    """What a merge does besides adding things up: shown to the person before it"""

    # What must be chosen (keys of MergeChoices): both accounts have their own
    conflicts: list[str] = []
    # Copies over the limit, paid back in mandarins
    refunded: int = 0
    refunded_mandarins: int = 0
    # Figures put away: their place is taken by the figure chosen to stay
    unplaced: int = 0
    # Rewards not doubled (the same thing rewarded in both) or for inviting each other
    rewards_dropped: int = 0
    rewards_dropped_mandarins: int = 0
    # Opened gifts that don't stay: the other account's gift of the same year was chosen
    gifts_dropped: int = 0
    # Ways to sign in that go away (the other one of the same kind was chosen)
    identities_dropped: list[DroppedIdentity] = []


class MergePreview(BaseModel):
    result: AccountSummary
    report: MergeReport


def _language(user: User) -> str:
    return lang_of(user.language)


async def _summary(session: AsyncSession, user_id: UUID) -> AccountSummary:
    user = await session.get(User, user_id)
    if not user:
        raise AccountError("No such user")

    async def count(stmt) -> int:
        return (await session.scalar(stmt)) or 0

    return AccountSummary(
        registered_at=user.registered_at,
        timezone=user.timezone,
        language=_language(user),
        notify=channels(user),
        identities=identities(user),
        email=user.email,
        wishes=await count(select(func.count(col(Wish.id))).where(Wish.author_id == user_id)),
        mandarins=await mandarins.balance(session, user_id),
        figures=await count(
            select(func.count(col(UserItem.id))).where(UserItem.user_id == user_id)
        ),
        gifts=await count(
            select(func.count(col(Delivery.id)))
            .where(Delivery.recipient_id == user_id)
            .where(col(Delivery.opened_at).is_not(None))
        ),
        friends=await count(select(func.count(col(User.id))).where(User.referrer_id == user_id)),
    )


async def get_by_id(user_id: UUID) -> User:
    async with new_db_session() as session:
        user = await session.get(User, user_id)
    if not user:
        raise AccountError("No such user")
    return user


async def summary(user_id: UUID) -> AccountSummary:
    async with new_db_session() as session:
        return await _summary(session, user_id)


async def _merge_deliveries(
    session: AsyncSession, keep: UUID, absorb: UUID, prefer: Side, report: MergeReport
) -> None:
    """
    One gift a year: of two gifts of the same year the opened one stays; both opened: the one
    of the chosen account (``prefer``)
    """
    kept = {
        d.year: d
        for d in await session.scalars(select(Delivery).where(Delivery.recipient_id == keep))
    }
    for delivery in (
        await session.scalars(select(Delivery).where(Delivery.recipient_id == absorb))
    ).all():
        ours = kept.get(delivery.year)
        if ours and ours.opened_at and delivery.opened_at:
            if "gifts" not in report.conflicts:
                report.conflicts.append("gifts")
            report.gifts_dropped += 1
            loser = delivery if prefer == "mine" else ours
        elif ours:
            # Only one of them is opened (or none): that one stays
            loser = delivery if (ours.opened_at or not delivery.opened_at) else ours
        else:
            loser = None
        if loser is delivery:
            await session.delete(delivery)
            continue
        if loser is ours and ours:
            await session.delete(ours)
            await session.flush()
        delivery.recipient_id = keep
        session.add(delivery)
    await session.flush()


async def _merge_mandarins(
    session: AsyncSession, keep: UUID, absorb: UUID, report: MergeReport
) -> None:
    """
    Balances add up. A reward both accounts got for the same thing is not doubled; a purchase
    both made stays (with its own ref), so nothing bought becomes free.
    Rewards for inviting each other are dropped: a person can't be their own friend.
    """

    def dropped(tx: MandarinTx) -> None:
        report.rewards_dropped += 1
        report.rewards_dropped_mandarins += tx.amount

    taken = {
        (reason, ref)
        for reason, ref in (
            await session.execute(
                select(MandarinTx.reason, MandarinTx.ref).where(MandarinTx.user_id == keep)
            )
        ).all()
    }
    each_other = {str(keep), str(absorb)}
    friendly = {mandarins.Reason.FRIEND_JOINED, mandarins.Reason.FRIEND_WISH}
    for tx in (await session.scalars(select(MandarinTx).where(MandarinTx.user_id == absorb))).all():
        if tx.reason in friendly and tx.ref in each_other:
            dropped(tx)
            await session.delete(tx)
            continue
        if (tx.reason, tx.ref) in taken:
            if tx.amount > 0:
                dropped(tx)
                await session.delete(tx)
                continue
            tx.ref = f"{tx.ref}@{absorb.hex[:8]}"[:64]
        tx.user_id = keep
        session.add(tx)
    # The same for the kept account: rewards from the absorbed one for inviting it
    for tx in (
        await session.scalars(
            select(MandarinTx)
            .where(MandarinTx.user_id == keep)
            .where(col(MandarinTx.reason).in_(friendly))
            .where(col(MandarinTx.ref).in_(each_other))
        )
    ).all():
        dropped(tx)
        await session.delete(tx)
    await session.flush()


async def _merge_items(
    session: AsyncSession, keep: UUID, absorb: UUID, prefer: Side, report: MergeReport
) -> None:
    """
    Decorations move. Copies over the limit (figures: ``MAX_COPIES``, the rest: one) are paid
    back in mandarins at the shop price. A courtyard place both accounts use keeps the figure of
    the chosen account (``prefer``), the other one is put away.
    """
    theirs = set(
        (await session.scalars(select(UserItem.id).where(UserItem.user_id == absorb))).all()
    )
    pads_of = {
        side: {
            pad
            for pad in (
                await session.scalars(
                    select(UserItem.pad)
                    .where(UserItem.user_id == owner)
                    .where(col(UserItem.pad).is_not(None))
                )
            ).all()
        }
        for side, owner in (("mine", keep), ("other", absorb))
    }
    if pads_of["mine"] & pads_of["other"]:
        report.conflicts.append("yard")
    await session.execute(
        update(UserItem).where(col(UserItem.user_id) == absorb).values(user_id=keep)
    )
    await session.flush()

    def side(item: UserItem) -> Side:
        return "other" if item.id in theirs else "mine"

    rows = (
        await session.execute(
            select(UserItem, ShopItem)
            .join(ShopItem, col(ShopItem.key) == UserItem.item_key)
            .where(UserItem.user_id == keep)
        )
    ).all()
    # Placed copies first: they stay; then the chosen account's copies, older first
    rows = sorted(
        rows,
        key=lambda row: (
            row[0].pad is None,
            side(row[0]) != prefer,
            _aware(row[0].acquired_at),
        ),
    )
    copies: dict[str, int] = {}
    pads: set[int] = set()
    for item, shop_item in rows:
        copies[item.item_key] = copies.get(item.item_key, 0) + 1
        if copies[item.item_key] > max_copies(shop_item):
            if shop_item.price > 0 and shop_item.friends_required == 0:
                await mandarins.award(
                    session,
                    keep,
                    mandarins.Reason.MERGE_REFUND,
                    item.id,
                    amount=shop_item.price,
                )
                report.refunded += 1
                report.refunded_mandarins += shop_item.price
            await session.delete(item)
            continue
        if item.pad is not None:
            if item.pad in pads:
                item.pad = None
                report.unplaced += 1
                session.add(item)
            else:
                pads.add(item.pad)
    await session.flush()


async def _merge(
    session: AsyncSession, keep_id: UUID, absorb_id: UUID, choices: MergeChoices
) -> MergeReport:
    if keep_id == absorb_id:
        raise AccountError("Same account")
    lock = select(User).where(col(User.id).in_([keep_id, absorb_id])).with_for_update()
    users = {u.id: u for u in (await session.scalars(lock)).all()}
    keep, absorb = users.get(keep_id), users.get(absorb_id)
    if not (keep and absorb):
        raise AccountError("No such user")
    report = MergeReport()

    # Settings both have their own of
    if keep.timezone != absorb.timezone:
        report.conflicts.append("timezone")
    if _language(keep) != _language(absorb):
        report.conflicts.append("language")
    if channels(keep) != channels(absorb):
        report.conflicts.append("notify")
    if choices.timezone == "other":
        keep.timezone = absorb.timezone
    if choices.language == "other":
        keep.language = absorb.language
    if choices.notify == "other":
        keep.notify = absorb.notify

    await session.execute(
        update(Wish).where(col(Wish.author_id) == absorb_id).values(author_id=keep_id)
    )
    await _merge_deliveries(session, keep_id, absorb_id, choices.gifts, report)
    await _merge_mandarins(session, keep_id, absorb_id, report)
    await _merge_items(session, keep_id, absorb_id, choices.yard, report)
    await session.execute(
        update(PushSubscription)
        .where(col(PushSubscription.user_id) == absorb_id)
        .values(user_id=keep_id)
    )
    # Friends of the absorbed account become friends of the kept one
    await session.execute(
        update(User).where(col(User.referrer_id) == absorb_id).values(referrer_id=keep_id)
    )
    # The kept account's own fields are set above: the refresh mustn't throw them away
    chosen = (keep.timezone, keep.language, keep.notify)
    await session.refresh(keep)
    keep.timezone, keep.language, keep.notify = chosen

    # Ways to sign in: free the unique columns first, then give them to the kept account.
    # Both have one of a kind: the chosen one stays, the other goes away.
    moved: dict[str, int | str | None] = {}
    for kind, column in COLUMNS.items():
        mine, theirs = getattr(keep, column), getattr(absorb, column)
        if theirs is None:
            continue
        if mine is None:
            moved[column] = theirs
            continue
        report.conflicts.append(kind)
        take_theirs = getattr(choices, kind) == "other"
        report.identities_dropped.append(
            DroppedIdentity(
                kind=kind,
                side="mine" if take_theirs else "other",
                email=str(mine if take_theirs else theirs) if kind == "email" else None,
            )
        )
        if take_theirs:
            moved[column] = theirs
    for column in COLUMNS.values():
        setattr(absorb, column, None)
    for column in moved:
        setattr(keep, column, None)
    session.add_all([absorb, keep])
    await session.flush()
    for column, value in moved.items():
        setattr(keep, column, value)

    if keep.referrer_id in (keep_id, absorb_id):
        keep.referrer_id = None
    if keep.referrer_id is None and absorb.referrer_id not in (None, keep_id, absorb_id):
        keep.referrer_id = absorb.referrer_id
    keep.name = keep.name or absorb.name
    session.add(keep)
    await session.flush()

    await session.delete(absorb)
    await session.flush()
    report.conflicts = [key for key in CHOICES if key in report.conflicts]
    return report


async def merge(keep_id: UUID, absorb_id: UUID, choices: MergeChoices | None = None) -> None:
    """
    Move everything of ``absorb_id`` to ``keep_id`` and delete ``absorb_id``.
    Where both have their own and only one can stay, ``choices`` say whose.
    """
    async with new_db_session() as session:
        await _merge(session, keep_id, absorb_id, choices or MergeChoices())
        await session.commit()


async def preview_merge(
    keep_id: UUID, absorb_id: UUID, choices: MergeChoices | None = None
) -> MergePreview:
    """The merge done for real in a transaction that is rolled back: exactly what it will be"""
    async with new_db_session() as session:
        try:
            report = await _merge(session, keep_id, absorb_id, choices or MergeChoices())
            result = await _summary(session, keep_id)
        finally:
            await session.rollback()
    return MergePreview(result=result, report=report)
