import pytest
from sqlalchemy.exc import IntegrityError

from app.repositories import DictionaryRepository
from tests.factories import create_dictionary, create_user


async def test_create_and_get(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)

    dictionary = await repo.create(user_id, "English B2")

    fetched = await repo.get(dictionary.id, user_id)
    assert fetched is not None
    assert fetched.name == "English B2"
    assert fetched.is_default is False
    assert fetched.deleted_at is None


async def test_get_is_scoped_to_owner(db_session):
    owner = await create_user(db_session, email="owner@example.com")
    other = await create_user(db_session, email="other@example.com")
    dictionary = await create_dictionary(db_session, owner)

    repo = DictionaryRepository(db_session)
    assert await repo.get(dictionary.id, other) is None


async def test_list_for_user_excludes_soft_deleted(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    kept = await repo.create(user_id, "Kept")
    removed = await repo.create(user_id, "Removed")

    await repo.soft_delete(removed.id, user_id)
    listed = await repo.list_for_user(user_id)

    assert [d.id for d in listed] == [kept.id]


async def test_name_unique_per_user_case_insensitive(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    await repo.create(user_id, "IELTS")

    with pytest.raises(IntegrityError):
        await repo.create(user_id, "ielts")


async def test_only_one_default_per_user(db_session):
    user_id = await create_user(db_session)
    await create_dictionary(db_session, user_id, name="First", is_default=True)

    with pytest.raises(IntegrityError):
        await create_dictionary(db_session, user_id, name="Second", is_default=True)


async def test_deleted_name_is_reusable(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    original = await repo.create(user_id, "Reuse Me")
    await repo.soft_delete(original.id, user_id)

    recreated = await repo.create(user_id, "Reuse Me")
    assert recreated.id != original.id


async def test_update_changes_name(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    dictionary = await repo.create(user_id, "Old Name")

    updated = await repo.update(dictionary.id, user_id, name="New Name")
    assert updated is not None
    assert updated.name == "New Name"


async def test_set_default_unsets_previous_default(db_session):
    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    first = await repo.create(user_id, "First", is_default=True)
    second = await repo.create(user_id, "Second")

    result = await repo.set_default(second.id, user_id)

    assert result is not None
    assert result.is_default is True
    refreshed_first = await repo.get(first.id, user_id)
    assert refreshed_first is not None
    assert refreshed_first.is_default is False


async def test_counts_for_reports_word_and_due_counts(db_session):
    from datetime import UTC, datetime, timedelta

    from tests.factories import create_word, set_review_state

    user_id = await create_user(db_session)
    repo = DictionaryRepository(db_session)
    dictionary = await repo.create(user_id, "Counted")

    due = await create_word(db_session, dictionary.id, user_id, word="due")
    await set_review_state(db_session, due.id, due_at=datetime.now(UTC) - timedelta(hours=1))
    await create_word(db_session, dictionary.id, user_id, word="notdue")

    word_count, due_count = await repo.counts_for(dictionary.id)
    assert word_count == 2
    assert due_count == 1
