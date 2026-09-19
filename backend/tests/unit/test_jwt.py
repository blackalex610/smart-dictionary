import jwt as pyjwt
import pytest

from app.errors import UnauthenticatedError
from app.security.jwt import JwtVerifier
from tests.conftest import SUPABASE_URL, make_access_token


class _StubSigningKey:
    def __init__(self, key: object) -> None:
        self.key = key


def _verifier_with_stubbed_key(settings, public_key) -> JwtVerifier:
    verifier = JwtVerifier(settings)
    verifier._client.get_signing_key_from_jwt = lambda token: _StubSigningKey(public_key)  # type: ignore[method-assign]
    return verifier


def test_valid_token_returns_verified_user(settings, rsa_key_pair):
    private_key, public_key = rsa_key_pair
    token = make_access_token(private_key, sub="abc-123", email="user@example.com")
    verifier = _verifier_with_stubbed_key(settings, public_key)

    user = verifier.verify(token)

    assert user.user_id == "abc-123"
    assert user.email == "user@example.com"


def test_expired_token_rejected(settings, rsa_key_pair):
    private_key, public_key = rsa_key_pair
    token = make_access_token(private_key, exp_delta_seconds=-60)
    verifier = _verifier_with_stubbed_key(settings, public_key)

    with pytest.raises(UnauthenticatedError):
        verifier.verify(token)


def test_wrong_audience_rejected(settings, rsa_key_pair):
    private_key, public_key = rsa_key_pair
    token = make_access_token(private_key, aud="some-other-audience")
    verifier = _verifier_with_stubbed_key(settings, public_key)

    with pytest.raises(UnauthenticatedError):
        verifier.verify(token)


def test_wrong_issuer_rejected(settings, rsa_key_pair):
    private_key, public_key = rsa_key_pair
    token = make_access_token(private_key, iss="https://not-our-project.supabase.co/auth/v1")
    verifier = _verifier_with_stubbed_key(settings, public_key)

    with pytest.raises(UnauthenticatedError):
        verifier.verify(token)


def test_alg_none_rejected_before_signature_is_ever_checked(settings, rsa_key_pair):
    """Classic JWT confusion attack: an attacker sets alg=none (or swaps to
    a symmetric alg) hoping the verifier trusts the header. algorithms=
    ["RS256", "ES256"] in jwt.decode must reject this outright."""
    _, public_key = rsa_key_pair
    forged = pyjwt.api_jws.encode(
        b'{"sub":"attacker","aud":"authenticated","iss":"'
        + f"{SUPABASE_URL}/auth/v1".encode()
        + b'","exp":9999999999}',
        key="",
        algorithm="none",
    )
    verifier = _verifier_with_stubbed_key(settings, public_key)

    with pytest.raises(UnauthenticatedError):
        verifier.verify(forged)
