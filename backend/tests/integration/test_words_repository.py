import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import Dictionary, Word, WordReview
from app.repositories import WordRepository
from app.repositories.dictionaries import DictionaryRepository
from tests.factories import create_dictionary, create_user, create_word, set_review_state


async def test_create_and_get(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)

    word = await repo.create(dictionary.id, user_id, "serendipity", "a happy accident")

    fetched = await repo.get(word.id, user_id)
    assert fetched is not None
    assert fetched.word == "serendipity"
    assert fetched.part_of_speech is None


async def test_word_review_row_is_created_by_trigger(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    review = await db_session.scalar(select(WordReview).where(WordReview.word_id == word.id))
    assert review is not None
    assert review.state == "new"
    assert review.due_at is None
    assert float(review.ease_factor) == pytest.approx(2.50)


async def test_widened_part_of_speech_values_are_accepted(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)

    word = await repo.create(
        dictionary.id, user_id, "however", "in spite of that", part_of_speech="conjunction"
    )
    assert word.part_of_speech == "conjunction"


async def test_invalid_part_of_speech_is_rejected(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)

    with pytest.raises(IntegrityError):
        await repo.create(dictionary.id, user_id, "x", "y", part_of_speech="not-a-real-pos")


async def test_duplicate_word_within_dictionary_is_rejected(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "cat", "an animal", part_of_speech="noun")

    with pytest.raises(IntegrityError):
        await repo.create(dictionary.id, user_id, "CAT", "an animal", part_of_speech="noun")


async def test_same_word_allowed_across_different_dictionaries(db_session):
    user_id = await create_user(db_session)
    dict_a = await create_dictionary(db_session, user_id, name="A")
    dict_b = await create_dictionary(db_session, user_id, name="B")
    repo = WordRepository(db_session)

    await repo.create(dict_a.id, user_id, "cat", "an animal")
    other = await repo.create(dict_b.id, user_id, "cat", "an animal")
    assert other.word == "cat"


async def test_list_for_dictionary_is_scoped_to_owner(db_session):
    """A dictionary id reaches a handler from the URL, so it is caller-supplied.
    Listing must still be bounded by the authenticated user, not by the id
    alone -- otherwise guessing a dictionary id reads someone else's words."""
    owner = await create_user(db_session, email="owner@example.com")
    other = await create_user(db_session, email="other@example.com")
    dictionary = await create_dictionary(db_session, owner)
    await create_word(db_session, dictionary.id, owner, word="private")

    repo = WordRepository(db_session)

    assert [w.word for w in await repo.list_for_dictionary(dictionary.id, owner)] == ["private"]
    assert await repo.list_for_dictionary(dictionary.id, other) == []


async def test_list_for_dictionary_excludes_soft_deleted(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    kept = await repo.create(dictionary.id, user_id, "kept", "still here")
    removed = await repo.create(dictionary.id, user_id, "gone", "not here anymore")

    await repo.soft_delete(removed.id, user_id)

    assert [w.id for w in await repo.list_for_dictionary(dictionary.id, user_id)] == [kept.id]


async def test_soft_delete_hides_word(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, user_id, "gone", "not here anymore")

    assert await repo.soft_delete(word.id, user_id) is True
    assert await repo.get(word.id, user_id) is None


async def test_legacy_insert_via_folder_creates_dictionary(db_session):
    """Simulates the pre-cutover frontend, which writes `folder` and knows
    nothing about `dictionary_id` -- the sync_word_dictionary trigger from
    migration 0002 must still make this work."""
    user_id = await create_user(db_session)

    await db_session.execute(
        text(
            "insert into public.words (user_id, word, definition, part_of_speech, folder) "
            "values (:user_id, 'legacy', 'a legacy word', 'noun', 'My Legacy Folder')"
        ),
        {"user_id": user_id},
    )

    dictionary = await db_session.scalar(
        select(Dictionary).where(
            Dictionary.user_id == user_id, Dictionary.name == "My Legacy Folder"
        )
    )
    assert dictionary is not None

    word = await db_session.scalar(select(Word).where(Word.word == "legacy"))
    assert word is not None
    assert word.dictionary_id == dictionary.id
    assert word.user_id == user_id


async def test_legacy_insert_without_folder_uses_general(db_session):
    user_id = await create_user(db_session)

    await db_session.execute(
        text(
            "insert into public.words (user_id, word, definition, part_of_speech) "
            "values (:user_id, 'no-folder', 'no folder given', 'noun')"
        ),
        {"user_id": user_id},
    )

    word = await db_session.scalar(select(Word).where(Word.word == "no-folder"))
    assert word is not None
    dictionary = await db_session.get(Dictionary, word.dictionary_id)
    assert dictionary is not None
    assert dictionary.name == "General"


async def test_list_page_first_page_created_sort(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("alpha", "beta", "gamma"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    page, next_cursor, has_more = await repo.list_page(dictionary.id, limit=2)

    assert [w.word for w in page] == ["gamma", "beta"]
    assert has_more is True
    assert next_cursor is not None


async def test_list_page_second_page_continues_from_cursor(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("alpha", "beta", "gamma"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    _first_page, cursor, _ = await repo.list_page(dictionary.id, limit=2)
    second_page, _cursor2, has_more2 = await repo.list_page(dictionary.id, limit=2, cursor=cursor)

    assert [w.word for w in second_page] == ["alpha"]
    assert has_more2 is False


async def test_list_page_alpha_sort(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    for name in ("zebra", "apple", "mango"):
        await repo.create(dictionary.id, user_id, name, f"def of {name}")

    page, _cursor, _has_more = await repo.list_page(dictionary.id, sort="alpha", limit=10)
    assert [w.word for w in page] == ["apple", "mango", "zebra"]


async def test_list_page_filters_by_search_term(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "cat", "a small animal")
    await repo.create(dictionary.id, user_id, "dog", "a loyal animal")
    await repo.create(dictionary.id, user_id, "car", "a vehicle")

    page, _c, _h = await repo.list_page(dictionary.id, q="animal", limit=10)
    assert {w.word for w in page} == {"cat", "dog"}


async def test_list_page_filters_by_part_of_speech(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "run", "to move fast", part_of_speech="verb")
    await repo.create(dictionary.id, user_id, "fast", "quick", part_of_speech="adjective")

    page, _c, _h = await repo.list_page(dictionary.id, part_of_speech="verb", limit=10)
    assert [w.word for w in page] == ["run"]


async def test_list_page_filters_by_review_state(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, user_id, "learned", "already reviewed")
    await repo.create(dictionary.id, user_id, "brandnew", "never reviewed")
    await set_review_state(db_session, word.id, state="review")

    page, _c, _h = await repo.list_page(dictionary.id, state="review", limit=10)
    assert [w.word for w in page] == ["learned"]


async def test_bulk_create_reports_per_row_result(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "existing", "already here", part_of_speech="noun")

    results = await repo.bulk_create(
        dictionary.id,
        user_id,
        [
            {"word": "new1", "definition": "d1"},
            {"word": "existing", "definition": "dup", "part_of_speech": "noun"},
            {"word": "new2", "definition": "d2"},
        ],
    )

    assert results[0]["word"] is not None and results[0]["error"] is None
    assert results[1]["word"] is None and results[1]["error"] == "DUPLICATE_WORD"
    assert results[2]["word"] is not None and results[2]["error"] is None


async def test_move_changes_dictionary(db_session):
    user_id = await create_user(db_session)
    dict_repo = DictionaryRepository(db_session)
    source = await dict_repo.create(user_id, "Source")
    target = await dict_repo.create(user_id, "Target")
    repo = WordRepository(db_session)
    word = await repo.create(source.id, user_id, "movable", "can be moved")

    moved = await repo.move(word.id, user_id, target.id)

    assert moved is not None
    assert moved.dictionary_id == target.id


async def test_move_returns_none_for_unowned_word(db_session):
    owner = await create_user(db_session, email="owner4@example.com")
    other = await create_user(db_session, email="other4@example.com")
    dictionary = await create_dictionary(db_session, owner)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, owner, "x", "y")

    other_dict = await DictionaryRepository(db_session).create(other, "Other's dict")
    assert await repo.move(word.id, other, other_dict.id) is None


async def test_update_changes_fields(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, user_id, "old", "old definition")

    updated = await repo.update(word.id, user_id, word="new", definition="new definition")

    assert updated is not None
    assert updated.word == "new"
    assert updated.definition == "new definition"


async def test_update_returns_none_for_unowned_word(db_session):
    owner = await create_user(db_session, email="owner5@example.com")
    other = await create_user(db_session, email="other5@example.com")
    dictionary = await create_dictionary(db_session, owner)
    repo = WordRepository(db_session)
    word = await repo.create(dictionary.id, owner, "x", "y")

    assert await repo.update(word.id, other, word="z") is None


async def test_count_for_user_excludes_soft_deleted(db_session):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    repo = WordRepository(db_session)
    await repo.create(dictionary.id, user_id, "kept", "d")
    removed = await repo.create(dictionary.id, user_id, "removed", "d")
    await repo.soft_delete(removed.id, user_id)

    assert await repo.count_for_user(user_id) == 1
