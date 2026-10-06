"""Server-side sessions kept in SQLite (standard library only).

The Flask cookie only carries a random session id. The user's profile and server
list live here: a server list can be far larger than the 4 KB a cookie allows,
and this way the cookie never exposes it. SQLite is shared safely between
worker processes, unlike an in-memory dict.

Session ids are stored hashed, so a copy of the database cannot be used to hijack
a session.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Session:
    sid: str
    csrf: str
    user: dict[str, Any]
    guilds: list[dict[str, Any]]
    expires_at: float


def _digest(sid: str) -> str:
    return hashlib.sha256(sid.encode("utf-8")).hexdigest()


class SessionStore:
    def __init__(self, path: Path, ttl_seconds: int) -> None:
        self.path = Path(path)
        self.ttl = ttl_seconds
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                       key        TEXT PRIMARY KEY,
                       user_id    TEXT NOT NULL,
                       csrf       TEXT NOT NULL,
                       user       TEXT NOT NULL,
                       guilds     TEXT NOT NULL,
                       expires_at REAL NOT NULL
                   )"""
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        # isolation_level=None: autocommit, every statement is its own transaction.
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        return conn

    def create(self, user: dict[str, Any], guilds: list[dict[str, Any]]) -> Session:
        """Start a session. Older sessions of the same user are dropped."""
        sid = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        now = time.time()
        with closing(self._connect()) as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= ? OR user_id = ?", (now, user["id"]))
            conn.execute(
                "INSERT INTO sessions (key, user_id, csrf, user, guilds, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    _digest(sid),
                    user["id"],
                    csrf,
                    json.dumps(user, ensure_ascii=False),
                    json.dumps(guilds, ensure_ascii=False),
                    now + self.ttl,
                ),
            )
        return Session(sid, csrf, user, guilds, now + self.ttl)

    def get(self, sid: str) -> Session | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT csrf, user, guilds, expires_at FROM sessions WHERE key = ? AND expires_at > ?",
                (_digest(sid), time.time()),
            ).fetchone()
        if row is None:
            return None
        return Session(sid, row["csrf"], json.loads(row["user"]), json.loads(row["guilds"]), row["expires_at"])

    def delete(self, sid: str) -> None:
        with closing(self._connect()) as conn:
            conn.execute("DELETE FROM sessions WHERE key = ?", (_digest(sid),))
