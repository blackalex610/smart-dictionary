import uuid

from pydantic import BaseModel, ConfigDict


class MeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    email: str | None
    display_name: str | None
    avatar_url: str | None
    tier: str
