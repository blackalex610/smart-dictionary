"""Opaque keyset-pagination cursors. No OFFSET anywhere in this codebase --
see docs/architecture/v2-plan.md §E -- so every paginated list encodes its
last row's (sort_value, id) into this cursor instead."""

import base64
import binascii
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Cursor:
    value: str
    id: str


def encode_cursor(value: str, id_: str) -> str:
    raw = json.dumps({"v": value, "i": id_}).encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str) -> Cursor:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode())
        data = json.loads(raw)
        return Cursor(value=data["v"], id=data["i"])
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise ValueError("Invalid pagination cursor") from exc
