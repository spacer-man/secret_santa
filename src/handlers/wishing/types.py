from pydantic import BaseModel
from pydantic import Field


class NewWishData(BaseModel):
    author_telegram_id: int
    message: str = Field(min_length=8, max_length=4096)
