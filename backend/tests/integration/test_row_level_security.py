"""RLS is defence-in-depth, not the enforcement path (the FastAPI service
connects with a role that bypasses it -- see docs/architecture/v2-plan.md
§E). Ownership-under-RLS is exercised end to end once real endpoints exist
in integration/test_authorization.py (Phase 4+). Here we only confirm every
new table actually has RLS turned on and carries the policies §J calls for,
so a future table can't quietly ship exposed by omission.
"""

import pytest
from sqlalchemy import text

TABLES_WITH_OWNER_POLICIES = {
    "dictionaries": 4,
    "word_reviews": 1,
    "review_log": 1,
    "quiz_attempts": 3,
    "quiz_answers": 1,
}

TABLES_WITH_NO_POLICIES = ["ai_requests", "ai_cache", "import_jobs"]


@pytest.mark.parametrize("table_name", list(TABLES_WITH_OWNER_POLICIES) + TABLES_WITH_NO_POLICIES)
async def test_rls_is_enabled(db_session, table_name):
    enabled = await db_session.scalar(
        text("select relrowsecurity from pg_class where oid = cast(:name as regclass)"),
        {"name": f"public.{table_name}"},
    )
    assert enabled is True, f"{table_name} does not have row level security enabled"


@pytest.mark.parametrize("table_name,expected_count", TABLES_WITH_OWNER_POLICIES.items())
async def test_owner_scoped_policies_exist(db_session, table_name, expected_count):
    count = await db_session.scalar(
        text("select count(*) from pg_policies where schemaname = 'public' and tablename = :t"),
        {"t": table_name},
    )
    assert count == expected_count


@pytest.mark.parametrize("table_name", TABLES_WITH_NO_POLICIES)
async def test_backend_only_tables_have_no_policies(db_session, table_name):
    count = await db_session.scalar(
        text("select count(*) from pg_policies where schemaname = 'public' and tablename = :t"),
        {"t": table_name},
    )
    assert count == 0
