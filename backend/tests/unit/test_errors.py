"""`_cors_headers` and the `unhandled_error_handler` it backs exist because of
a Starlette wiring detail: `add_exception_handler(Exception, ...)` installs
on `ServerErrorMiddleware`, the outermost layer, while `add_middleware(
CORSMiddleware, ...)` sits further in. A truly unhandled exception never
reaches `CORSMiddleware`'s `send` wrapper, so its 500 response shipped with
no CORS headers at all -- a real bug surfaced to the browser as an opaque
CORS failure instead of the actual error. See app/errors.py's `_cors_headers`
docstring for the full mechanism.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware

from app.config import Settings
from app.errors import (
    AppError,
    DuplicateWordError,
    NotFoundError,
    WordLimitReachedError,
    _cors_headers,
    app_error_handler,
    unhandled_error_handler,
)


def _settings(*, cors_allow_origins: str) -> Settings:
    return Settings(
        database_url="postgresql+asyncpg://user:pass@localhost:5432/test",
        supabase_url="https://example-project.supabase.co",  # type: ignore[arg-type]
        cors_allow_origins=cors_allow_origins,
    )


def _make_app(settings: Settings) -> FastAPI:
    """Mirrors app.main.create_app's middleware order exactly (CORSMiddleware
    added after the app is built, exception handlers registered after that) --
    the ordering, not just the handler logic, is what this test guards."""
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("something went wrong")

    @app.get("/known-error")
    def known_error() -> None:
        raise NotFoundError("no such thing")

    return app


def test_unhandled_exception_still_gets_cors_headers(monkeypatch):
    settings = _settings(cors_allow_origins="https://app.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    client = TestClient(_make_app(settings), raise_server_exceptions=False)
    response = client.get("/boom", headers={"Origin": "https://app.example.com"})

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "https://app.example.com"
    assert response.headers["vary"] == "Origin"
    # The body is still the generic problem+json -- exc details never leak.
    assert response.json()["code"] == "INTERNAL"


def test_unhandled_exception_omits_cors_headers_for_disallowed_origin(monkeypatch):
    settings = _settings(cors_allow_origins="https://app.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    client = TestClient(_make_app(settings), raise_server_exceptions=False)
    response = client.get("/boom", headers={"Origin": "https://evil.example.com"})

    assert response.status_code == 500
    assert "access-control-allow-origin" not in response.headers


def test_known_apperror_already_gets_cors_headers_via_middleware(monkeypatch):
    """Sanity check that AppError responses were never the broken path --
    ExceptionMiddleware sits inside CORSMiddleware, so this always worked."""
    settings = _settings(cors_allow_origins="https://app.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    client = TestClient(_make_app(settings), raise_server_exceptions=False)
    response = client.get("/known-error", headers={"Origin": "https://app.example.com"})

    assert response.status_code == 404
    assert response.headers["access-control-allow-origin"] == "https://app.example.com"


def test_cors_headers_helper_without_origin_header(monkeypatch):
    settings = _settings(cors_allow_origins="https://app.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    client = TestClient(_make_app(settings), raise_server_exceptions=False)
    response = client.get("/boom")

    assert "access-control-allow-origin" not in response.headers


def test_cors_headers_matches_multiple_configured_origins(monkeypatch):
    settings = _settings(cors_allow_origins="https://a.example.com, https://b.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    client = TestClient(_make_app(settings), raise_server_exceptions=False)
    response = client.get("/boom", headers={"Origin": "https://b.example.com"})

    assert response.headers["access-control-allow-origin"] == "https://b.example.com"


def test_cors_headers_helper_returns_empty_dict_when_disallowed(monkeypatch):
    settings = _settings(cors_allow_origins="https://app.example.com")
    monkeypatch.setattr("app.errors.get_settings", lambda: settings)

    class FakeRequest:
        headers = {"origin": "https://evil.example.com"}

    assert _cors_headers(FakeRequest()) == {}  # type: ignore[arg-type]


def test_duplicate_word_error_shape():
    err = DuplicateWordError("cat already exists in this dictionary")
    assert err.status == 409
    assert err.code == "DUPLICATE_WORD"


def test_word_limit_reached_error_shape():
    err = WordLimitReachedError("This account is limited to 5000 words.")
    assert err.status == 409
    assert err.code == "WORD_LIMIT_REACHED"
