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
        principal = auth.parse_authorization(authorization, BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    # "Sign out everywhere": tokens made before it don't work (the Mini App is Telegram's own
    # session, it can't be ended by us)
    if not principal.via_tma:
        user = await accounts.get_user(principal)
        after = user.sessions_after if user else None
        # Milliseconds: a token re-issued right after it must work, every older one not
        if after and principal.minted_at < accounts.aware(after).timestamp() * 1000:
            raise HTTPException(status_code=401, detail="Session ended")
    return principal


CurrentPrincipal = Annotated[auth.Principal, Depends(current_principal)]


async def any_user(principal: CurrentPrincipal) -> User:
    """A registered user, also a deleted one (to restore or erase it)"""
    user = await accounts.get_user(principal)
    if not user:
        raise HTTPException(status_code=403, detail="Not registered")
    return user


AnyUser = Annotated[User, Depends(any_user)]


async def registered_user(user: AnyUser) -> User:
    """A registered user whose account isn't deleted"""
    if user.deleted_at:
        raise HTTPException(status_code=403, detail="account_deleted")
    return user


RegisteredUser = Annotated[User, Depends(registered_user)]


def require_fresh(principal: auth.Principal) -> None:
    if not principal.is_fresh():
        detail = "reopen_required" if principal.via_tma else "reauth_required"
        raise HTTPException(status_code=403, detail=detail)


async def fresh_user(user: RegisteredUser, principal: CurrentPrincipal) -> User:
    """
    A registered user who signed in recently: needed to change the ways into the account
    (link, unlink, merge). 403 ``reauth_required`` — confirm with any linked way to sign in
    (``POST /api/me/reauth``); ``reopen_required`` — the Mini App must be opened again.
    """
    require_fresh(principal)
    return user


FreshUser = Annotated[User, Depends(fresh_user)]
