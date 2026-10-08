"""Devi dashboard: Discord OAuth2 sign-in, server picker and per-server settings.

Usage (app.py):

    from dashboard import init_app as init_dashboard
    init_dashboard(app)
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import timedelta

from flask import Flask, session
from markupsafe import Markup

from .bot_api import BotApi
from .sessions import SessionStore
from .settings import Settings, load_secret_key, load_settings

__all__ = ["init_app"]

# Characters that could end a <script> block or confuse a JS parser inside inline JSON.
_JSON_ESCAPES = {
    ord("<"): "\\u003C",
    ord(">"): "\\u003E",
    ord("&"): "\\u0026",
    0x2028: "\\u2028",
    0x2029: "\\u2029",
}


def _setup_logging() -> None:
    """Make the dashboard's own log lines (sign-ins, rejected sessions) show up in the service log.

    Without a handler Python only prints warnings, and the reason a visitor had to sign in
    again is an INFO line. DEVI_LOG_LEVEL=WARNING silences them again.
    """
    log = logging.getLogger("devi.dashboard")
    if log.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(handler)
    log.setLevel((os.environ.get("DEVI_LOG_LEVEL") or "INFO").upper())
    log.propagate = False


@dataclass
class Dashboard:
    settings: Settings
    store: SessionStore | None  # None while the dashboard is not configured
    bot: BotApi


def _json_script(value: object) -> Markup:
    """Compact JSON that is safe inside <script type="application/json">."""
    return Markup(json.dumps(value, ensure_ascii=False, separators=(",", ":")).translate(_JSON_ESCAPES))


def init_app(app: Flask) -> Dashboard:
    _setup_logging()
    settings = load_settings()

    # Nothing is written to disk until the dashboard is configured, so importing the app
    # (for example from build_static.py) has no side effects.
    if settings.enabled and not app.secret_key:
        app.secret_key = load_secret_key()
    app.config.update(
        SESSION_COOKIE_NAME="devi_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=settings.secure_cookies,
        PERMANENT_SESSION_LIFETIME=timedelta(days=settings.session_days),
    )
    app.config.setdefault("MAX_CONTENT_LENGTH", 1024 * 1024)

    dashboard = Dashboard(
        settings=settings,
        store=SessionStore(settings.session_db, settings.session_days * 86400) if settings.enabled else None,
        bot=BotApi(settings.bot_api_url, settings.bot_api_token),
    )
    app.extensions["devi_dashboard"] = dashboard
    app.jinja_env.filters["json_script"] = _json_script

    @app.context_processor
    def dashboard_context() -> dict:
        # `current_user` comes from the signed cookie only, so the landing page
        # can show "Log in" or "Dashboard" without touching the session database.
        return {"dashboard_enabled": settings.enabled, "current_user": session.get("user")}

    from .views import bp

    app.register_blueprint(bp)
    return dashboard
