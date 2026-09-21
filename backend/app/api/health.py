from fastapi import APIRouter, Request
from sqlalchemy import text

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up. No dependency checks -- a slow database
    should not make the orchestrator kill and restart a healthy process."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> dict[str, str]:
    """Readiness: can this instance actually serve traffic. Checks the
    database and the JWKS cache, since every authenticated request needs
    both."""
    engine = request.app.state.engine
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))

    verifier = request.app.state.jwt_verifier
    verifier.ensure_jwks_reachable()

    return {"status": "ok"}
