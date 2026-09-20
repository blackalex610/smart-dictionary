from tests.factories import create_dictionary, create_user, create_word


async def test_create_word_in_dictionary(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "ubiquitous", "definition": "everywhere", "part_of_speech": "adjective"},
    )
    body = response.json()

    assert response.status_code == 201
    assert body["word"] == "ubiquitous"
    assert body["dictionary_id"] == str(dictionary.id)
    await client.aclose()


async def test_create_word_in_unowned_dictionary_is_404(db_session, api_client):
    owner = await create_user(db_session, email="ownerw1@example.com")
    other = await create_user(db_session, email="otherw1@example.com")
    dictionary = await create_dictionary(db_session, owner)

    client = api_client(other)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "x", "definition": "y"},
    )

    assert response.status_code == 404
    await client.aclose()


async def test_create_duplicate_word_returns_409(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    await create_word(db_session, dictionary.id, user_id, word="cat", part_of_speech="noun")

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words",
        json={"word": "cat", "definition": "an animal", "part_of_speech": "noun"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "DUPLICATE_WORD"
    await client.aclose()


async def test_list_words_paginates(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    for i in range(3):
        await create_word(db_session, dictionary.id, user_id, word=f"w{i}")

    client = api_client(user_id)
    response = await client.get(f"/api/v1/dictionaries/{dictionary.id}/words", params={"limit": 2})
    body = response.json()

    assert response.status_code == 200
    assert len(body["items"]) == 2
    assert body["has_more"] is True
    assert body["next_cursor"] is not None
    await client.aclose()


async def test_get_word_by_id(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.get(f"/api/v1/words/{word.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(word.id)
    await client.aclose()


async def test_patch_word(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.patch(f"/api/v1/words/{word.id}", json={"definition": "updated"})

    assert response.status_code == 200
    assert response.json()["definition"] == "updated"
    await client.aclose()


async def test_delete_word_soft_deletes(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.delete(f"/api/v1/words/{word.id}")
    assert response.status_code == 204

    follow_up = await client.get(f"/api/v1/words/{word.id}")
    assert follow_up.status_code == 404
    await client.aclose()


async def test_bulk_create_words(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words:bulk",
        json={"rows": [{"word": "one", "definition": "1"}, {"word": "two", "definition": "2"}]},
    )
    body = response.json()

    assert response.status_code == 200
    assert len(body["results"]) == 2
    assert all(r["error"] is None for r in body["results"])
    await client.aclose()


async def test_bulk_create_rejects_more_than_max_rows(db_session, api_client):
    user_id = await create_user(db_session)
    dictionary = await create_dictionary(db_session, user_id)

    client = api_client(user_id)
    rows = [{"word": f"w{i}", "definition": "d"} for i in range(501)]
    response = await client.post(
        f"/api/v1/dictionaries/{dictionary.id}/words:bulk", json={"rows": rows}
    )

    assert response.status_code == 422
    await client.aclose()


async def test_move_word_to_another_dictionary(db_session, api_client):
    user_id = await create_user(db_session)
    source = await create_dictionary(db_session, user_id, name="Source")
    target = await create_dictionary(db_session, user_id, name="Target")
    word = await create_word(db_session, source.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        f"/api/v1/words/{word.id}:move", json={"dictionary_id": str(target.id)}
    )

    assert response.status_code == 200
    assert response.json()["dictionary_id"] == str(target.id)
    await client.aclose()
