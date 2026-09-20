from fastapi import APIRouter

from app.api.v1 import me, reviews, words

router = APIRouter(prefix="/api/v1")
router.include_router(me.router)
router.include_router(reviews.router)
router.include_router(words.router)
