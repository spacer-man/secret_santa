"""Signed media URLs"""

from unittest.mock import patch
from uuid import uuid4

from api.media import check_media_token, media_url
from helpers import TOKEN


def test_media_url_is_stable_across_seconds():
    # The same file asked twice a moment apart (here across a second boundary) gets the same URL:
    # the gift is compared by it, and the browser can cache it
    media_id = uuid4()
    with patch("api.media.time.time", return_value=1_800_000_000.9):
        first = media_url(media_id, TOKEN)
    with patch("api.media.time.time", return_value=1_800_000_001.1):
        second = media_url(media_id, TOKEN)
    assert first == second
    assert check_media_token(media_id, first.split("t=")[1], TOKEN)
