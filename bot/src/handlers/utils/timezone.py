from collections.abc import Generator, Sequence

from timezones import ALL_TIMEZONES, FRACTIONAL_TIMEZONES, WHOLE_HOUR_TIMEZONES, tz_from_timeshift

__all__ = (
    "ALL_TIMEZONES",
    "FRACTIONAL_TIMEZONES",
    "WHOLE_HOUR_TIMEZONES",
    "batch",
    "clock_emoji",
    "tz_from_timeshift",
)


def clock_emoji(hour: int) -> str:
    """
    Returns a clock emoji representation based on the given hour and minute.

    :args:
        hour: :class:`int`     # The hour (0-23).

    :returns: :class:`str`  # The corresponding clock emoji.
    """
    assert 0 <= hour <= 23, f"Uncorrect hour: hour can't be {hour}"

    # Convert to 12-hour format
    clock_face = hour % 12
    # Dictionary mapping clock face number to emojis
    clock_emojis = {
        0: "🕛",
        1: "🕐",
        2: "🕑",
        3: "🕒",
        4: "🕓",
        5: "🕔",
        6: "🕕",
        7: "🕖",
        8: "🕗",
        9: "🕘",
        10: "🕙",
        11: "🕚",
    }
    # Return the clock emoji
    return clock_emojis[clock_face]


def batch[T](
    iterable: Sequence[T],
    size: int = 1,
) -> Generator[Sequence[T]]:
    """Split sequence to batch"""
    n = len(iterable)
    for chunk in range(0, n, size):
        yield iterable[chunk : min(n, chunk + size)]
