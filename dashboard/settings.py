"""Dashboard configuration, read from the environment.

    DISCORD_CLIENT_SECRET  OAuth2 client secret (required)
    DISCORD_CLIENT_ID      defaults to the client id inside data.LINKS["invite"]
    DISCORD_REDIRECT_URI   e.g. https://example.org/oauth/callback; it must also be
                           added under OAuth2 > Redirects in the Discord Developer
                           Portal. Defaults to the address Flask sees, which is wrong
                           behind a reverse proxy, so set it in production.
    BOT_API_URL            default http://127.0.0.1:8765
    BOT_API_TOKEN          must equal DASHBOARD_API_TOKEN of the bot (required)
    SECRET_KEY             signs the session cookie; generated into instance/ if unset
    DEVI_SESSION_DB        default instance/sessions.sqlite3
    DEVI_SESSION_DAYS      how many days a session lives after its last use, default 7; every visit
                           starts the countdown again, so people who use the dashboard stay signed in
    DEVI_LOG_LEVEL         default INFO; sign-ins and the reason a session was rejected are logged

The dashboard stays switched off until the client secret and the bot token are set,
so the landing page keeps working on a machine that has no dashboard configuration.
"""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path

from data import LINKS

BASE_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = BASE_DIR / "instance"


@dataclass(frozen=True)
class Settings:
    client_id: str
    client_secret: str
    redirect_uri: str | None
    bot_api_url: str
    bot_api_token: str
    session_db: Path
    session_days: int
    # Overridable so tests can point the site at a fake Discord.
    discord_api: str
    discord_authorize: str

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret and self.bot_api_token)

    @property
    def secure_cookies(self) -> bool:
        return bool(self.redirect_uri and self.redirect_uri.startswith("https://"))


def _client_id_from_invite() -> str:
    match = re.search(r"client_id=(\d+)", LINKS.get("invite", ""))
    return match.group(1) if match else ""


def _days(raw: str | None, default: int) -> int:
    try:
        return max(1, int(raw)) if raw else default
    except ValueError:
        return default


def load_settings() -> Settings:
    env = os.environ.get
    return Settings(
        client_id=(env("DISCORD_CLIENT_ID") or _client_id_from_invite()).strip(),
        client_secret=(env("DISCORD_CLIENT_SECRET") or "").strip(),
        redirect_uri=(env("DISCORD_REDIRECT_URI") or "").strip() or None,
        bot_api_url=(env("BOT_API_URL") or "http://127.0.0.1:8765").strip().rstrip("/"),
        bot_api_token=(env("BOT_API_TOKEN") or "").strip(),
        session_db=Path(env("DEVI_SESSION_DB") or INSTANCE_DIR / "sessions.sqlite3"),
        session_days=_days(env("DEVI_SESSION_DAYS"), 7),
        discord_api=(env("DISCORD_API_BASE") or "https://discord.com/api/v10").rstrip("/"),
        discord_authorize=env("DISCORD_AUTHORIZE_URL") or "https://discord.com/oauth2/authorize",
    )


def load_secret_key() -> str:
    """SECRET_KEY from the environment, else a key kept in instance/secret_key.

    Without a stable key every restart (and every worker) would sign cookies
    differently and log everybody out.
    """
    configured = os.environ.get("SECRET_KEY", "").strip()
    if configured:
        return configured

    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    path = INSTANCE_DIR / "secret_key"
    if not path.is_file():
        # Write to a private temp file and hard-link it into place: the link is atomic and
        # fails if another worker got there first, so nobody ever reads a half-written key.
        temp = INSTANCE_DIR / f".secret_key.{os.getpid()}"
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(secrets.token_urlsafe(48))
        try:
            os.link(temp, path)
        except FileExistsError:
            pass
        finally:
            temp.unlink(missing_ok=True)
    return path.read_text(encoding="utf-8").strip()
