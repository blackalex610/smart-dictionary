from sqlalchemy import text

from tests.factories import create_user


async def test_api_client_hits_me_endpoint_as_the_given_user(db_session, api_client):
    user_id = await create_user(db_session, email="fixture@example.com")
    await db_session.execute(
        text("insert into public.profiles (user_id) values (:id)"),
        {"id": user_id},
    )
    await db_session.flush()

    client = api_client(user_id, email="fixture@example.com")
    response = await client.get("/api/v1/me")

    assert response.status_code == 200
    assert response.json()["email"] == "fixture@example.com"
    await client.aclose()


async def test_api_client_without_a_profile_row_gets_404(db_session, api_client):
    user_id = await create_user(db_session, email="noprofile@example.com")

    client = api_client(user_id)
    response = await client.get("/api/v1/me")

    assert response.status_code == 404
    await client.aclose()
