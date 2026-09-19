import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import Dictionary, Word, WordReview
from app.repositories import WordRepository
from tests.factories import create_dictionary, create_user, create_word


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
