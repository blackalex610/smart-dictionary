from datetime import UTC, datetime, timedelta

from tests.factories import create_dictionary, create_user, create_word, set_review_state


async def _seed_profile(db_session, user_id, **overrides):
    import sqlalchemy as sa

    columns = {"user_id": user_id, **overrides}
    keys = ", ".join(columns.keys())
    placeholders = ", ".join(f":{k}" for k in columns)
    await db_session.execute(
        sa.text(f"insert into public.profiles ({keys}) values ({placeholders})"), columns
    )
    await db_session.flush()


async def test_queue_returns_due_and_new_words(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime.now(UTC)

    due = await create_word(db_session, dictionary.id, user_id, word="overdue")
    await set_review_state(db_session, due.id, due_at=now - timedelta(hours=2))
    await create_word(db_session, dictionary.id, user_id, word="fresh")

    client = api_client(user_id)
    response = await client.get("/api/v1/reviews/queue")
    body = response.json()

    assert response.status_code == 200
    words = [item["word"] for item in body["items"]]
    assert words == ["overdue", "fresh"]
    await client.aclose()


async def test_queue_excludes_another_users_words(db_session, api_client):
    owner = await create_user(db_session, email="owner2@example.com")
    other = await create_user(db_session, email="other2@example.com")
    await _seed_profile(db_session, other)
    dictionary = await create_dictionary(db_session, owner)
    await create_word(db_session, dictionary.id, owner)

    client = api_client(other)
    response = await client.get("/api/v1/reviews/queue")

    assert response.status_code == 200
    assert response.json()["items"] == []
    await client.aclose()


async def test_submit_review_advances_schedule_and_returns_due_at(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        "/api/v1/reviews",
        json={"word_id": str(word.id), "rating": 3, "elapsed_ms": 1500, "source": "flashcard"},
    )
    body = response.json()

    assert response.status_code == 201
    assert body["state"] == "learning"
    assert body["due_at"] is not None
    await client.aclose()


async def test_submit_review_for_unowned_word_is_404(db_session, api_client):
    owner = await create_user(db_session, email="owner3@example.com")
    other = await create_user(db_session, email="other3@example.com")
    await _seed_profile(db_session, other)
    dictionary = await create_dictionary(db_session, owner)
    word = await create_word(db_session, dictionary.id, owner)

    client = api_client(other)
    response = await client.post(
        "/api/v1/reviews", json={"word_id": str(word.id), "rating": 3, "source": "flashcard"}
    )

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    await client.aclose()


async def test_submit_review_rejects_out_of_range_rating(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)
    dictionary = await create_dictionary(db_session, user_id)
    word = await create_word(db_session, dictionary.id, user_id)

    client = api_client(user_id)
    response = await client.post(
        "/api/v1/reviews", json={"word_id": str(word.id), "rating": 9, "source": "flashcard"}
    )

    assert response.status_code == 422
    await client.aclose()


async def test_submit_review_increments_reviews_done_and_reduces_queue_cap(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id, daily_review_limit=1)
    dictionary = await create_dictionary(db_session, user_id)
    now = datetime.now(UTC)

    first = await create_word(db_session, dictionary.id, user_id, word="first")
    await set_review_state(db_session, first.id, due_at=now - timedelta(hours=1))
    second = await create_word(db_session, dictionary.id, user_id, word="second")
    await set_review_state(db_session, second.id, due_at=now - timedelta(hours=1))

    client = api_client(user_id)
    await client.post(
        "/api/v1/reviews", json={"word_id": str(first.id), "rating": 3, "source": "flashcard"}
    )

    response = await client.get("/api/v1/reviews/queue")
    words = [item["word"] for item in response.json()["items"]]
    assert "second" not in words  # daily_review_limit=1 already spent
    await client.aclose()


async def test_forecast_returns_requested_number_of_days(db_session, api_client):
    user_id = await create_user(db_session)
    await _seed_profile(db_session, user_id)

    client = api_client(user_id)
    response = await client.get("/api/v1/reviews/forecast", params={"days": 7})
    body = response.json()

    assert response.status_code == 200
    assert len(body["days"]) == 8  # today plus 7 days ahead, inclusive
    await client.aclose()
