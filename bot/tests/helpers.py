"""
Shared test setup: environment (must be set before ``db`` is imported) and helpers.
"""

import asyncio
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode

_db_file = Path(tempfile.mkdtemp()) / "test.db"
os.environ.update(
    {
        "DB_URL": os.environ.get("TEST_DB_URL", f"sqlite+aiosqlite:///{_db_file}"),
        "BOT_TOKEN": "123456:TEST-TOKEN",
        "WISH_VALIDATE_TG_IDS": "1",
        "AUTHOR_SUPPORT_LINK": "https://example.com",
        "STATE_STORAGE_REDIS_URL": "",
        "DB_NULL_POOL": "1",
    }
)
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

TOKEN = os.environ["BOT_TOKEN"]


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def init_data(user_id: int, start_param: str | None = None) -> str:
    fields = {
        "auth_date": str(int(time.time())),
        "user": json.dumps({"id": user_id, "first_name": "Test", "language_code": "en"}),
    }
    if start_param:
        fields["start_param"] = start_param
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)
