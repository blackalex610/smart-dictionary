import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, literal, or_, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import WORDS_LIST_DEFAULT_LIMIT, WORDS_LIST_MAX_LIMIT
from app.models import Word, WordReview
from app.pagination import decode_cursor, encode_cursor


class WordRepository:
    """The only place words SQL is written. Every query scopes to the owning
    user and filters out soft-deleted rows -- a dictionary id reaching a
    handler from a URL is caller-supplied, so it can never be the only
    predicate. `list_page` is the one exception: it takes no user_id because
    its caller (the words service) resolves the dictionary through
    DictionaryRepository.get(dictionary_id, user_id) first, so an unowned
    dictionary is already a 404 before any word row is read."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        dictionary_id: uuid.UUID,
        user_id: uuid.UUID,
        word: str,
        definition: str,
        *,
        part_of_speech: str | None = None,
        example: str | None = None,
        translation: str | None = None,
    ) -> Word:
        row = Word(
            dictionary_id=dictionary_id,
            user_id=user_id,
            word=word,
            definition=definition,
            part_of_speech=part_of_speech,
            example=example,
            translation=translation,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def get(self, word_id: uuid.UUID, user_id: uuid.UUID) -> Word | None:
        result: Word | None = await self._session.scalar(
            select(Word).where(
                Word.id == word_id, Word.user_id == user_id, Word.deleted_at.is_(None)
            )
        )
        return result

    async def list_for_dictionary(self, dictionary_id: uuid.UUID, user_id: uuid.UUID) -> list[Word]:
        result = await self._session.scalars(
            select(Word)
            .where(
                Word.dictionary_id == dictionary_id,
                Word.user_id == user_id,
                Word.deleted_at.is_(None),
            )
            .order_by(Word.created_at.desc(), Word.id)
        )
        return list(result)

    async def soft_delete(self, word_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        word = await self.get(word_id, user_id)
        if word is None:
            return False
        word.deleted_at = datetime.now(UTC)
        await self._session.flush()
        return True

    async def list_page(
        self,
        dictionary_id: uuid.UUID,
        *,
        cursor: str | None = None,
        limit: int = WORDS_LIST_DEFAULT_LIMIT,
        q: str | None = None,
        part_of_speech: str | None = None,
        difficulty: int | None = None,
        state: str | None = None,
        sort: str = "created",
    ) -> tuple[list[Word], str | None, bool]:
        limit = min(limit, WORDS_LIST_MAX_LIMIT)
        stmt = select(Word).where(Word.dictionary_id == dictionary_id, Word.deleted_at.is_(None))

        if q:
            pattern = f"%{q.lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Word.word).like(pattern),
                    func.lower(Word.definition).like(pattern),
                )
            )
        if part_of_speech:
            stmt = stmt.where(Word.part_of_speech == part_of_speech)
        if difficulty is not None:
            stmt = stmt.where(Word.difficulty == difficulty)
        if state:
            stmt = stmt.join(WordReview, WordReview.word_id == Word.id).where(
                WordReview.state == state
            )

        # Deliberately Any: the two sort modes order by a plain column and by
        # a SQL function expression, which have no common concrete type in
        # SQLAlchemy's stubs.
        order_col: Any
        tiebreak_col: Any = Word.id
        if sort == "alpha":
            order_col = func.lower(Word.word)
            stmt = stmt.order_by(order_col.asc(), tiebreak_col.asc())
        else:
            order_col = Word.created_at
            stmt = stmt.order_by(order_col.desc(), tiebreak_col.desc())

        if cursor is not None:
            decoded = decode_cursor(cursor)
            cursor_id = uuid.UUID(decoded.id)
            row_tuple = tuple_(order_col, tiebreak_col)
            if sort == "alpha":
                stmt = stmt.where(row_tuple > tuple_(literal(decoded.value), literal(cursor_id)))
            else:
                cursor_value = datetime.fromisoformat(decoded.value)
                stmt = stmt.where(row_tuple < tuple_(literal(cursor_value), literal(cursor_id)))

        rows = list(await self._session.scalars(stmt.limit(limit + 1)))
        has_more = len(rows) > limit
        page = rows[:limit]

        next_cursor = None
        if has_more and page:
            last = page[-1]
            value = last.word.lower() if sort == "alpha" else last.created_at.isoformat()
            next_cursor = encode_cursor(value, str(last.id))

        return page, next_cursor, has_more

    async def bulk_create(
        self, dictionary_id: uuid.UUID, user_id: uuid.UUID, rows: list[dict[str, object]]
    ) -> list[dict[str, object]]:
        """Each row gets its own SAVEPOINT -- a duplicate in the middle of an
        import must not discard the rows around it."""
        results: list[dict[str, object]] = []
        for row in rows:
            try:
                async with self._session.begin_nested():
                    word = Word(dictionary_id=dictionary_id, user_id=user_id, **row)
                    self._session.add(word)
                    await self._session.flush()
                results.append({"word": word, "error": None})
            except IntegrityError:
                results.append({"word": None, "error": "DUPLICATE_WORD"})
        return results

    async def move(
        self, word_id: uuid.UUID, user_id: uuid.UUID, dictionary_id: uuid.UUID
    ) -> Word | None:
        word = await self.get(word_id, user_id)
        if word is None:
            return None
        word.dictionary_id = dictionary_id
        await self._session.flush()
        return word
