from tests.factories import create_dictionary, create_user, create_word


async def test_create_first_dictionary_is_default(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)

    response = await client.post("/api/v1/dictionaries", json={"name": "My Words"})
    body = response.json()

    assert response.status_code == 201
    assert body["is_default"] is True
    await client.aclose()


async def test_create_second_dictionary_is_not_default(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)
    await client.post("/api/v1/dictionaries", json={"name": "First"})

    response = await client.post("/api/v1/dictionaries", json={"name": "Second"})
    assert response.json()["is_default"] is False
    await client.aclose()


async def test_create_duplicate_name_returns_validation_error(db_session, api_client):
    user_id = await create_user(db_session)
    client = api_client(user_id)
    await client.post("/api/v1/dictionaries", json={"name": "IELTS"})

    response = await client.post("/api/v1/dictionaries", json={"name": "ielts"})

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"
    assert response.json()["errors"][0]["field"] == "name"
    await client.aclose()


async def test_list_dictionaries_includes_counts(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id, name="Has Words")
    await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.get("/api/v1/dictionaries")
    items = response.json()["items"]

    assert response.status_code == 200
    match = next(i for i in items if i["id"] == str(dictionary.id))
    assert match["word_count"] == 1
    assert match["due_count"] == 0
    await client.aclose()


async def test_patch_dictionary_sets_new_default(db_session, api_client):
    user_id = await create_user(db_session)
    await create_dictionary(db_session, user_id, name="First", is_default=True)
    second = await create_dictionary(db_session, user_id, name="Second")

    client = api_client(user_id)
    response = await client.patch(f"/api/v1/dictionaries/{second.id}", json={"is_default": True})

    assert response.status_code == 200
    assert response.json()["is_default"] is True
    await client.aclose()


async def test_delete_dictionary_soft_deletes(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.delete(f"/api/v1/dictionaries/{dictionary.id}")
    assert response.status_code == 204

    follow_up = await client.get(f"/api/v1/dictionaries/{dictionary.id}")
    assert follow_up.status_code == 404
    await client.aclose()


async def test_get_unowned_dictionary_is_404(db_session, api_client):
    owner = await create_user(db_session, email="ownerd1@example.com")
    other = await create_user(db_session, email="otherd1@example.com")
    dictionary = await create_dictionary(db_session, owner)

    client = api_client(other)
    response = await client.get(f"/api/v1/dictionaries/{dictionary.id}")
    assert response.status_code == 404
    await client.aclose()
