"""
Sign in with Google: checks the ID token (JWT) that Google Identity Services gives the page.

Docs: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
"""

import asyncio
from functools import cache

import jwt
from pydantic import BaseModel

from configs.accounts import GoogleConfig

CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("accounts.google.com", "https://accounts.google.com")


class GoogleError(Exception):
    pass


class GoogleUser(BaseModel):
    sub: str
    email: str | None = None
    email_verified: bool = False
    name: str | None = None
    # Google Workspace domain: its addresses are Google's own
    hd: str | None = None

    @property
    def trusted_email(self) -> str | None:
        """
        The address, if Google vouches for it: verified AND managed by Google (Gmail or a
        Workspace domain). A Google account can be made on any address, and the address can
        later pass to someone else: such an e-mail must not open an account found by it.
        """
        if not (self.email and self.email_verified):
            return None
        domain = self.email.rsplit("@", 1)[-1].lower()
        return self.email if (self.hd or domain in ("gmail.com", "googlemail.com")) else None


def client_id() -> str | None:
    return GoogleConfig().client_id or None


@cache
def _jwks() -> jwt.PyJWKClient:
    # Keys are cached by the client; Google rotates them every few days
    return jwt.PyJWKClient(CERTS_URL, cache_keys=True, lifespan=3600)


def _decode(credential: str, audience: str) -> dict:
    key = _jwks().get_signing_key_from_jwt(credential).key
    return jwt.decode(credential, key, algorithms=["RS256"], audience=audience, issuer=ISSUERS)


async def verify(credential: str) -> GoogleUser:
    audience = client_id()
    if not audience:
        raise GoogleError("Google sign-in is off")
    try:
        claims = await asyncio.to_thread(_decode, credential, audience)
    except jwt.PyJWTError as err:
        raise GoogleError(f"Bad Google token: {err}") from err
    return GoogleUser(
        sub=str(claims["sub"]),
        email=claims.get("email"),
        email_verified=bool(claims.get("email_verified")),
        name=claims.get("given_name") or claims.get("name"),
        hd=claims.get("hd"),
    )
