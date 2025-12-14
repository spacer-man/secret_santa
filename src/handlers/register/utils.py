import datetime
from typing import Generator
from typing import Sequence


ALL_TIMEZONES = [
    "UTC" + ("+" if timeshift >= 0 else "") + str(timeshift)
    for timeshift in range(-12, 13)
]


def tz_from_timeshift(timeshift: str) -> datetime.timezone:
    assert timeshift in ALL_TIMEZONES, "timeshift is uncorrect" 

    # Select value
    shift_value = timeshift[3:]

    # Convert to timedelta
    timedelta = datetime.timedelta(hours=int(shift_value[1:]))
    if shift_value[0] == '-':
        timedelta *= -1

    # Return result timezone
    return datetime.timezone(timedelta)


def clock_emoji(hour: int) -> str:
    """
    Returns a clock emoji representation based on the given hour and minute.
    
    Args:
    - hour (int): The hour (0-23).
    
    Returns:
    - str: The corresponding clock emoji.
    """
    assert 0 <= hour <= 23, f"Uncorrect hour: hour can't be {hour}"

    # Convert to 12-hour format
    clock_face = hour % 12
    # Dictionary mapping clock face number to emojis
    clock_emojis = {
        0: "🕛", 1: "🕐", 2: "🕑", 3: "🕒",
        4: "🕓", 5: "🕔", 6: "🕕", 7: "🕖", 
        8: "🕗", 9: "🕘", 10: "🕙", 11: "🕚"
    }
    # Return the clock emoji
    return clock_emojis[clock_face]


def batch[T](
        iterable: Sequence[T],
        size: int = 1,
        ) -> Generator[Sequence[T]]:
    """Split sequence to batch"""
    l = len(iterable)
    for chunk in range(0, l, size):
        yield iterable[chunk: min(l, chunk + size)]
