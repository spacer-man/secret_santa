"""
Timezones are stored as fixed UTC offsets in the form ``UTC+3`` or ``UTC+5:30``.

Only the offset that is in effect on New Year's night matters for us,
so we don't need full IANA zones (and DST rules) here.
"""

import datetime
import re

_WHOLE_HOURS = range(-12, 15)  # UTC-12 ... UTC+14 (Kiribati)
_FRACTIONAL = (
    (-9, 30),  # Marquesas
    (-3, 30),  # Newfoundland
    (3, 30),  # Iran
    (4, 30),  # Afghanistan
    (5, 30),  # India, Sri Lanka
    (5, 45),  # Nepal
    (6, 30),  # Myanmar
    (8, 45),  # Eucla
    (9, 30),  # Central Australia
    (10, 30),  # Lord Howe, South Australia (summer)
    (12, 45),  # Chatham (NZ)
)

_TZ_RE = re.compile(r"^UTC([+-])(\d{1,2})(?::(\d{2}))?$")


def format_offset(minutes: int) -> str:
    sign = "+" if minutes >= 0 else "-"
    hours, mins = divmod(abs(minutes), 60)
    return f"UTC{sign}{hours}" + (f":{mins:02d}" if mins else "")


def offset_minutes(tz: str) -> int:
    match = _TZ_RE.match(tz)
    if not match:
        raise ValueError(f"Incorrect timezone: {tz!r}")
    sign, hours, mins = match.groups()
    value = int(hours) * 60 + int(mins or 0)
    return -value if sign == "-" else value


WHOLE_HOUR_TIMEZONES = [format_offset(h * 60) for h in _WHOLE_HOURS]
FRACTIONAL_TIMEZONES = [
    format_offset((1 if h >= 0 else -1) * (abs(h) * 60 + m)) for h, m in _FRACTIONAL
]
ALL_TIMEZONES = sorted(WHOLE_HOUR_TIMEZONES + FRACTIONAL_TIMEZONES, key=offset_minutes)


def is_valid(tz: str) -> bool:
    return tz in ALL_TIMEZONES


def tz_from_timeshift(tz: str) -> datetime.timezone:
    assert is_valid(tz), "timeshift is uncorrect"
    return datetime.timezone(datetime.timedelta(minutes=offset_minutes(tz)))


def local_now(tz: str, now: datetime.datetime | None = None) -> datetime.datetime:
    now = now or datetime.datetime.now(datetime.UTC)
    return now.astimezone(tz_from_timeshift(tz))


def new_year_year(tz: str, now: datetime.datetime | None = None) -> int | None:
    """
    If it's 1 January in the timezone right now, return the year that has just come.
    Otherwise return ``None``.
    """
    local = local_now(tz, now)
    if local.month == 1 and local.day == 1:
        return local.year
    return None
