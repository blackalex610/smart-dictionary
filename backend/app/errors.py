"""AppError -> RFC 9457 problem+json, per docs/architecture/v2-plan.md §F.

`code` is the contract the frontend maps to an i18n key in exactly one
place. Every subclass below sets a fixed `code` and `status`; call sites
raise them with just the human `detail`.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings
from app.logging import _request_id, get_logger

logger = get_logger(__name__)


class AppError(Exception):
    status: int = 500
    code: str = "INTERNAL"
    title: str = "Internal error"

    def __init__(
        self, detail: str | None = None, errors: list[dict[str, object]] | None = None
    ) -> None:
        self.detail = detail
        self.errors = errors
        super().__init__(detail or self.title)


class UnauthenticatedError(AppError):
    status = 401
    code = "UNAUTHENTICATED"
    title = "Authentication required"


class NotFoundError(AppError):
    status = 404
    code = "NOT_FOUND"
    title = "Resource not found"


class ValidationFailedError(AppError):
    status = 422
    code = "VALIDATION_FAILED"
    title = "Validation failed"


class RateLimitedError(AppError):
    status = 429
    code = "RATE_LIMITED"
    title = "Too many requests"


def _problem_body(error: AppError) -> dict[str, object]:
    return {
        "type": f"https://smartdict.app/errors/{error.code.lower().replace('_', '-')}",
        "title": error.title,
        "status": error.status,
        "detail": error.detail or error.title,
        "code": error.code,
        "request_id": _request_id.get(),
        **({"errors": error.errors} if error.errors else {}),
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content=_problem_body(exc),
        media_type="application/problem+json",
    )


def _cors_headers(request: Request) -> dict[str, str]:
    """Starlette wires exception handlers as `{AppError: ..., Exception: ...}`;
    a handler for the bare `Exception` type (`500` in FastAPI's shorthand) is
    installed on `ServerErrorMiddleware`, the *outermost* layer of the stack,
    while `add_middleware(CORSMiddleware, ...)` sits further in -- see
    `Starlette.build_middleware_stack`. An `AppError` is caught by
    `ExceptionMiddleware`, which is inside `CORSMiddleware`, so its response
    passes back through and gets CORS headers for free. A truly unhandled
    exception never reaches `ExceptionMiddleware` at all: it propagates past
    `CORSMiddleware` before any response has been sent, so `CORSMiddleware`
    never gets the chance to inject anything, and this handler's response is
    the first one actually sent on the wire.

    Without this, a bug that only some requests hit surfaces to the browser
    as an opaque CORS failure instead of the real 500 -- and that failure
    depends on which request happened to be same-origin.

    Mirrors exactly what `CORSMiddleware.send` does for a "simple" (non-
    preflight) response with a fixed, non-wildcard origin list and
    `allow_credentials=False`: echo the request's `Origin` back if and only
    if it's on the allowlist, plus `Vary: Origin` so a cache never serves one
    origin's response to another.
    """
    origin = request.headers.get("origin")
    if origin is None or origin not in get_settings().cors_origins:
        return {}
    return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # The response body deliberately says nothing about `exc` -- but the
    # traceback has to go somewhere, or a 500 is unattributable in
    # production. Logged with the request id the caller was handed back, so
    # a bug report quoting it leads straight to this line.
    logger.exception(
        "unhandled_error",
        method=request.method,
        path=request.url.path,
        error_type=type(exc).__name__,
    )
    fallback = AppError("An unexpected error occurred.")
    return JSONResponse(
        status_code=500,
        content=_problem_body(fallback),
        media_type="application/problem+json",
        headers=_cors_headers(request),
    )
