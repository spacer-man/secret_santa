from pydantic import Field, SecretStr

from .common import EnvConfig


class DBConfig(EnvConfig):
    url: SecretStr = Field(alias="DB_URL")
