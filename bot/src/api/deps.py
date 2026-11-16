"""Who is calling: dependencies shared by the API modules"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException

from configs.bot import BotConfig
from db.models import User
from services import accounts

from . import auth

BOT_TOKEN = BotConfig().token.get_secret_value()


async def current_principal(
    authorization: Annotated[str | None, Header()] = None,
) -> auth.Principal:
    try:
        return auth.parse_authorization(authorization, BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err


CurrentPrincipal = Annotated[auth.Principal, Depends(current_principal)]


async def registered_user(principal: CurrentPrincipal) -> User:
    user = await accounts.get_user(principal)
    if not user:
        raise HTTPException(status_code=403, detail="Not registered")
    return user


RegisteredUser = Annotated[User, Depends(registered_user)]


async def fresh_user(user: RegisteredUser, principal: CurrentPrincipal) -> User:
    """
    A registered user who signed in recently: needed to change the ways into the account
    (link, unlink, merge). 403 ``reauth_required`` — confirm with any linked way to sign in
    (``POST /api/me/reauth``); ``reopen_required`` — the Mini App must be opened again.
    """
    if not principal.is_fresh():
        detail = "reopen_required" if principal.via_tma else "reauth_required"
        raise HTTPException(status_code=403, detail=detail)
    return user


FreshUser = Annotated[User, Depends(fresh_user)]
