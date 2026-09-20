from tests.factories import create_user


async def test_full_flow_across_all_new_routers(db_session, api_client):
    user_id = await create_user(db_session)
    import sqlalchemy as sa

    await db_session.execute(
        sa.text("insert into public.profiles (user_id) values (:id)"), {"id": user_id}
    )
    await db_session.flush()

    client = api_client(user_id)

    dict_response = await client.post("/api/v1/dictionaries", json={"name": "Smoke Test"})
    assert dict_response.status_code == 201
    dictionary_id = dict_response.json()["id"]

    word_response = await client.post(
        f"/api/v1/dictionaries/{dictionary_id}/words",
        json={"word": "smoke", "definition": "a test word"},
    )
    assert word_response.status_code == 201
    word_id = word_response.json()["id"]

    queue_response = await client.get("/api/v1/reviews/queue")
    assert queue_response.status_code == 200
    assert any(item["word_id"] == word_id for item in queue_response.json()["items"])

    review_response = await client.post(
        "/api/v1/reviews", json={"word_id": word_id, "rating": 3, "source": "flashcard"}
    )
    assert review_response.status_code == 201

    forecast_response = await client.get("/api/v1/reviews/forecast")
    assert forecast_response.status_code == 200

    await client.aclose()
