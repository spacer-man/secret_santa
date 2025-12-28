from pydantic import Field

from .common import EnvConfig


class SupportConfig(EnvConfig):
    author_support_link: str = Field(alias="AUTHOR_SUPPORT_LINK")
