"""A UTC day boundary is wrong for a study streak or a daily review cap --
see docs/architecture/v2-plan.md §E. Pure, stdlib only."""

from datetime import date, datetime
from zoneinfo import ZoneInfo


def local_today(tz_name: str, now: datetime) -> date:
    return now.astimezone(ZoneInfo(tz_name)).date()
