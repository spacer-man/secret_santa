from pydantic import Field

from .common import EnvConfig


class WebAppConfig(EnvConfig):
    # Public URL of the web app, e.g. https://santa.example.com (empty = disabled)
    url: str = Field(default="", alias="WEBAPP_URL")

    def url_for(self, path: str = "") -> str | None:
        if not self.url:
            return None
        return self.url.rstrip("/") + "/" + path.lstrip("/")
