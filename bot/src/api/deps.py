"""Who is calling: dependencies shared by the API modules"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException

from configs.bot import BotConfig
from db.models import User
from services import accounts, sessions

from . import auth

BOT_TOKEN = BotConfig().token.get_secret_value()


async def current_principal(
    authorization: Annotated[str | None, Header()] = None,
) -> auth.Principal:
    try:
        principal = auth.parse_authorization(authorization, BOT_TOKEN)
    except auth.AuthError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err
    if principal.session_id:
        # A sign-in on the website: its session must still be there (it can be ended)
        if not await sessions.alive(principal.session_id, principal.kind, principal.key):
            raise HTTPException(status_code=401, detail="Session ended")
    elif not principal.via_tma:
        # An older token without a session: "sign out everywhere" ends it by time
        user = await accounts.get_user(principal)
        after = user.sessions_after if user else None
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
