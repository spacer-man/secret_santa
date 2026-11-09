"""
Media files are stored in the database as bytes.
They are served by signed URLs, so <img>/<video>/<audio> can load them without headers.
"""
import time
from uuid import UUID

from fastapi import Request, Response

from db.models import MediaType
from . import auth


MEDIA_URL_TTL = 24 * 3600


def media_url(media_id: UUID, bot_token: str) -> str:
    token = auth.sign(
        {"m": media_id.hex, "exp": int(time.time()) + MEDIA_URL_TTL},
        bot_token, "media")
    return f"/api/media/{media_id}?t={token}"


def check_media_token(media_id: UUID, token: str, bot_token: str) -> bool:
    try:
        payload = auth.unsign(token, bot_token, "media")
    except auth.AuthError:
        return False
    return payload.get("m") == media_id.hex


def sniff_mime(data: bytes, media_type: MediaType) -> str:
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if head[4:8] == b"ftyp":
        if head[8:11] == b"M4A":
            return "audio/mp4"
        if head[8:10] == b"qt":
            return "video/quicktime"
        return "audio/mp4" if media_type in (MediaType.AUDIO, MediaType.VOICE) else "video/mp4"
    return {
        MediaType.IMAGE: "image/jpeg",
        MediaType.VIDEO: "video/mp4",
        MediaType.VIDEO_NOTE: "video/mp4",
        MediaType.AUDIO: "audio/mpeg",
        MediaType.VOICE: "audio/ogg",
    }[media_type]


def media_type_by_mime(mime: str) -> MediaType | None:
    if mime in ("image/jpeg", "image/png", "image/webp"):
        return MediaType.IMAGE
    if mime in ("video/mp4", "video/quicktime"):
        return MediaType.VIDEO
    if mime in ("audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac"):
        return MediaType.AUDIO
    if mime == "audio/ogg":
        return MediaType.VOICE
    return None


def ranged_response(request: Request, data: bytes, mime: str) -> Response:
    """Range requests are required by Safari to play video/audio"""
    size = len(data)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400",
    }
    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        try:
            start_raw, end_raw = range_header[6:].split(",")[0].split("-")
            if start_raw:
                start = int(start_raw)
                end = int(end_raw) if end_raw else size - 1
            else:   # Suffix: last N bytes
                start = max(0, size - int(end_raw))
                end = size - 1
            end = min(end, size - 1)
            if start > end:
                raise ValueError
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(
            content=data[start:end + 1], status_code=206,
            media_type=mime, headers=headers)
    return Response(content=data, media_type=mime, headers=headers)
