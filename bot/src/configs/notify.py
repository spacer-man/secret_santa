from pydantic import Field

from .common import EnvConfig


class NotifyConfig(EnvConfig):
    raw_wish_validate_tg_ids: str = Field(alias="WISH_VALIDATE_TG_IDS")
    @property
    def wish_validate_tg_ids(self) -> list[int]:
        return list(map(int, self.raw_wish_validate_tg_ids.split(',')))
