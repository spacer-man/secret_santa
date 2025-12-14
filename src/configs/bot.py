from pydantic import Field, SecretStr

from .common import EnvConfig


class BotConfig(EnvConfig):
    token: SecretStr = Field(alias="BOT_TOKEN")
