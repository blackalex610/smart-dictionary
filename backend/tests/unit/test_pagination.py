import pytest

from app.pagination import Cursor, decode_cursor, encode_cursor


def test_round_trip():
    cursor = encode_cursor("2026-09-15T10:00:00+00:00", "11111111-1111-1111-1111-111111111111")
    decoded = decode_cursor(cursor)
    assert decoded == Cursor(
        value="2026-09-15T10:00:00+00:00", id="11111111-1111-1111-1111-111111111111"
    )


def test_cursor_is_url_safe():
    cursor = encode_cursor("has/slashes+plus", "id")
    assert "/" not in cursor
    assert "+" not in cursor


def test_decode_rejects_garbage():
    with pytest.raises(ValueError):
        decode_cursor("not-a-real-cursor")


def test_decode_rejects_missing_fields():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"v": "only-value"}).encode()).decode()
    with pytest.raises(ValueError):
        decode_cursor(bad)


def test_decode_rejects_non_string_value():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"v": 123, "i": "id"}).encode()).decode()
    with pytest.raises(ValueError):
        decode_cursor(bad)


def test_decode_rejects_non_string_id():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"v": "value", "i": None}).encode()).decode()
    with pytest.raises(ValueError):
        decode_cursor(bad)
