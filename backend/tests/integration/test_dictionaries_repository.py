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
