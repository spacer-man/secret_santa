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
