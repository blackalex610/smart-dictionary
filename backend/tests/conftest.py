import os

# Must be set before anything imports app.main (module-level `app =
# create_app()` calls get_settings(), which fails fast if these are
# missing). conftest.py is always imported before test modules.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/test")
os.environ.setdefault("SUPABASE_URL", "https://example-project.supabase.co")

import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

from app.config import Settings  # noqa: E402

SUPABASE_URL = "https://example-project.supabase.co"


@pytest.fixture(scope="session")
def rsa_key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="postgresql+asyncpg://user:pass@localhost:5432/test",
        supabase_url=SUPABASE_URL,  # type: ignore[arg-type]
    )


def make_access_token(
    private_key: rsa.RSAPrivateKey,
    *,
    kid: str = "test-kid",
    sub: str = "11111111-1111-1111-1111-111111111111",
    aud: str = "authenticated",
    iss: str = f"{SUPABASE_URL}/auth/v1",
    exp_delta_seconds: int = 3600,
    **extra_claims: object,
) -> str:
    import time

    now = int(time.time())
    payload = {
        "sub": sub,
        "aud": aud,
        "iss": iss,
        "iat": now,
        "exp": now + exp_delta_seconds,
        **extra_claims,
    }
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": kid})
