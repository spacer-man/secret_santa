from pydantic import Field, SecretStr

from .common import EnvConfig


class BotConfig(EnvConfig):
    token: SecretStr = Field(alias="BOT_TOKEN")
    states_redis_url: SecretStr = Field(alias="STATE_STORAGE_REDIS_URL")


class WebhookConfig(EnvConfig):
    # Full public URL, e.g. https://santa.example.com/telegram/webhook
    # Empty: the bot uses long polling (handy for local development)
    url: str = Field(default="", alias="WEBHOOK_URL")
    secret: SecretStr = Field(default=SecretStr(""), alias="WEBHOOK_SECRET")


# Not settings fields: env vars like PATH / HOST would override them
WEBHOOK_HOST = "0.0.0.0"
WEBHOOK_PORT = 8080
WEBHOOK_PATH = "/telegram/webhook"
