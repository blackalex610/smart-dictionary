"""AppError -> RFC 9457 problem+json, per docs/architecture/v2-plan.md §F.

`code` is the contract the frontend maps to an i18n key in exactly one
place. Every subclass below sets a fixed `code` and `status`; call sites
raise them with just the human `detail`.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse

from app.logging import _request_id


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


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    fallback = AppError("An unexpected error occurred.")
    return JSONResponse(
        status_code=500,
        content=_problem_body(fallback),
        media_type="application/problem+json",
    )
