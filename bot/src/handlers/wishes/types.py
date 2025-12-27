from typing import Optional

from aiogram.types import MessageEntity
from pydantic import BaseModel
from pydantic import Field

from db.models import MediaType


class MediaData(BaseModel):
    data: str | bytes
    file_size: Optional[int] = Field(default=None)  # File size in bytes
    type: MediaType


class NewWishData(BaseModel):
    author_telegram_id: int
    text: str = Field(min_length=8, max_length=4096)
    text_entities: list[MessageEntity] | None = Field(default=None)
    effect_id: Optional[str] = Field(default=None)
    media: Optional[list[MediaData]] = Field(default=None, max_length=3)    # media file ids for download
