from pydantic import Field, SecretStr

from .common import EnvConfig


class BotConfig(EnvConfig):
    token: SecretStr = Field(alias="BOT_TOKEN")
    states_redis_url: SecretStr = Field(alias="STATE_STORAGE_REDIS_URL")
