import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_session
from app.errors import NotFoundError, UnauthenticatedError
from app.models import Profile
from app.schemas.me import MeResponse
from app.security.jwt import VerifiedUser

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeResponse)
async def get_me(
    user: VerifiedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    try:
        user_uuid = uuid.UUID(user.user_id)
    except ValueError as exc:
        raise UnauthenticatedError("Token subject is not a valid user id") from exc

    profile = await session.scalar(select(Profile).where(Profile.user_id == user_uuid))
    if profile is None:
        # The auth.users -> profiles trigger runs on signup, so a missing
        # row here means the token's subject doesn't correspond to a real
        # account -- never disclose which case it is.
        raise NotFoundError("Profile not found")

    return MeResponse(
        user_id=profile.user_id,
        email=user.email,
        display_name=profile.display_name,
        avatar_url=profile.avatar_url,
        tier=profile.tier,
    )
