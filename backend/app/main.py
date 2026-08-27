from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1.router import router as v1_router
from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.errors import AppError, app_error_handler, unhandled_error_handler
from app.logging import configure_logging, get_logger, request_id_middleware
from app.security.jwt import JwtVerifier

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    app.state.engine = make_engine(settings)
    app.state.session_factory = make_session_factory(app.state.engine)
    app.state.jwt_verifier = JwtVerifier(settings)
    logger.info("startup", environment=settings.environment)
    try:
        yield
    finally:
        await app.state.engine.dispose()


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()

    app = FastAPI(title="Smart Dictionary API", lifespan=lifespan)

    app.middleware("http")(request_id_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Starlette's add_exception_handler is typed for the base Exception;
    # registering a handler typed to a specific subclass is the documented
    # pattern but a known mypy false positive.
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(health_router)
    app.include_router(v1_router)

    return app


app = create_app()
