"""Verifies Supabase-issued access tokens against Supabase's JWKS endpoint.

Per docs/architecture/v2-plan.md §J: JWKS cached with a TTL, `alg` allowlist
(RS256/ES256, never `none`), `iss`/`aud`/`exp` checked. No client-supplied
user id is ever trusted -- `sub` from a verified token is the only source
of identity.
"""

from dataclasses import dataclass
from urllib.error import URLError

import jwt
from jwt import PyJWKClient

from app.config import Settings
from app.errors import UnauthenticatedError

_ALLOWED_ALGORITHMS = ["RS256", "ES256"]
_JWKS_CACHE_TTL_SECONDS = 600


@dataclass(frozen=True)
class VerifiedUser:
    user_id: str
    email: str | None


class JwtVerifier:
    """One instance per process; the underlying PyJWKClient caches keys and
    refetches the JWKS document only after the TTL expires or an unknown
    kid is seen."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = PyJWKClient(
            settings.supabase_jwks_url,
            lifespan=_JWKS_CACHE_TTL_SECONDS,
        )

    def verify(self, token: str) -> VerifiedUser:
        try:
            signing_key = self._client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=_ALLOWED_ALGORITHMS,
                audience="authenticated",
                issuer=self._settings.supabase_issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        except jwt.PyJWKClientError as exc:
            raise UnauthenticatedError("Could not verify token (JWKS unavailable)") from exc
        except jwt.PyJWTError as exc:
            raise UnauthenticatedError("Invalid or expired token") from exc

        sub = payload.get("sub")
        if not sub:
            raise UnauthenticatedError("Token missing subject")

        return VerifiedUser(user_id=sub, email=payload.get("email"))

    def ensure_jwks_reachable(self) -> None:
        """Used by /readyz: fetches the JWKS document (PyJWKClient caches
        it) and raises if the endpoint is unreachable or returns garbage.
        Not an auth failure for the caller, so this deliberately does not
        raise AppError -- it's a dependency check, not a request outcome."""
        try:
            self._client.fetch_data()
        except (URLError, jwt.PyJWKClientError) as exc:
            raise RuntimeError("JWKS endpoint unreachable") from exc
