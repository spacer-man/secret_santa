from pydantic import Field, SecretStr

from .common import EnvConfig


class SmtpConfig(EnvConfig):
    """Outgoing mail: sign-in codes and New Year notifications (empty host: no mail)"""

    host: str = Field(default="", alias="SMTP_HOST")
    port: int = Field(default=587, alias="SMTP_PORT")
    user: str = Field(default="", alias="SMTP_USER")
    password: SecretStr = Field(default=SecretStr(""), alias="SMTP_PASSWORD")
    # "Тайный Санта <santa@example.com>"
    sender: str = Field(default="", alias="SMTP_FROM")
    # True: TLS from the start (port 465); False: STARTTLS (port 587)
    ssl: bool = Field(default=False, alias="SMTP_SSL")


class GoogleConfig(EnvConfig):
    """Sign in with Google (empty: the button is hidden)"""

    client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")


class PushConfig(EnvConfig):
    """
    Web Push (VAPID). Keys: ``python -m services.push`` prints a new pair.
    Empty: push notifications are off.
    """

    public_key: str = Field(default="", alias="VAPID_PUBLIC_KEY")
    private_key: SecretStr = Field(default=SecretStr(""), alias="VAPID_PRIVATE_KEY")
    subject: str = Field(default="mailto:santa@example.com", alias="VAPID_SUBJECT")

    @property
    def enabled(self) -> bool:
        return bool(self.public_key and self.private_key.get_secret_value())
