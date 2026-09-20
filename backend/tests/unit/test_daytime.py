from datetime import UTC, datetime

from app.services.daytime import local_today


def test_local_today_matches_utc_when_timezone_is_utc():
    now = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)
    assert local_today("UTC", now) == now.date()


def test_local_today_rolls_over_before_midnight_utc_for_eastern_timezone():
    # 23:30 UTC on the 15th is already 02:30 on the 16th in Sofia (UTC+3)
    now = datetime(2026, 9, 15, 23, 30, tzinfo=UTC)
    assert local_today("Europe/Sofia", now).day == 16


def test_local_today_stays_on_previous_day_for_western_timezone():
    # 02:00 UTC is still 21:00 the previous day in New York (UTC-5)
    now = datetime(2026, 9, 15, 2, 0, tzinfo=UTC)
    assert local_today("America/New_York", now).day == 14
