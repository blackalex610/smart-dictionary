from collections.abc import AsyncGenerator
from typing import cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import UnauthenticatedError
from app.security.jwt import JwtVerifier, VerifiedUser

_bearer = HTTPBearer(auto_error=False)


async def get_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> VerifiedUser:
    if credentials is None:
        raise UnauthenticatedError("Missing bearer token")
    verifier = cast(JwtVerifier, request.app.state.jwt_verifier)
    return verifier.verify(credentials.credentials)
