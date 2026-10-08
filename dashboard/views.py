"""Routes of the dashboard.

    /login                       start Discord OAuth2 (?next=/path, ?refresh=1 to re-read the server list)
    /oauth/callback              Discord sends the user back here
    /logout            (POST)    end the session
    /<lang>/servers              server picker
    /<lang>/dashboard/<guild>    settings of one server (a page that loads its data from the API below)
    /api/dashboard/<guild>...    JSON API used by that page; forwards to the bot's internal API
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from functools import wraps
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit

from flask import (
    Blueprint,
    abort,
    current_app,
    g,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import i18n
from data import LINKS

from . import oauth
from .bot_api import BotApiError
from .sessions import Session

log = logging.getLogger("devi.dashboard")
bp = Blueprint("dashboard", __name__)

LANG_COOKIE = "devi_lang"  # same cookie as app.py: the language survives the trip to Discord and back
COOKIE_MAX_AGE = 60 * 60 * 24 * 365
SNOWFLAKE = re.compile(r"^\d{15,20}$")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
API_PREFIX = "/api/dashboard/"
MAX_API_BODY = 64 * 1024
SECTION_COUNT = 7  # permissions, birthdays, logs, voice, honeypot, triggers, language

ADMINISTRATOR = 0x8
MANAGE_GUILD = 0x20


# ---------------------------------------------------------------- plumbing


def _dash():
    return current_app.extensions["devi_dashboard"]


def _short(sid: str) -> str:
    """A harmless label of a session for the log (the real id is a credential)."""
    return hashlib.sha256(sid.encode("utf-8")).hexdigest()[:8]


def current_session() -> Session | None:
    """The signed-in user's server-side session, or None."""
    if "dash_session" not in g:
        store = _dash().store
        sid = session.get("sid")
        found, why = None, "no session id in the cookie"
        if store is not None and isinstance(sid, str):
            found, why = store.lookup(sid)
        if found is None:
            if sid is not None or "user" in session:
                session.pop("sid", None)  # the server forgot this session: stop pretending
                session.pop("user", None)
                log.info("session rejected: %s (%s)", why, _short(sid) if isinstance(sid, str) else "-")
            elif g.get("cookie_unreadable"):
                log.info("session rejected: the session cookie is unreadable (SECRET_KEY changed or cookie expired)")
        g.dash_session = found
    return g.dash_session


def pick_lang(requested: str | None = None) -> str:
    return i18n.pick_language(requested, request.cookies.get(LANG_COOKIE), request.headers.get("Accept-Language"))


def safe_next(value: str | None) -> str | None:
    """Only site-local paths: anything else would make /login an open redirect."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return None
    parts = urlsplit(value)
    return None if parts.scheme or parts.netloc else value


def invite_url(guild_id: str | None = None) -> str:
    base = LINKS["invite"]
    if not guild_id:
        return base
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{urlencode({'guild_id': guild_id, 'disable_guild_select': 'true'})}"


def _switch_language_here(code: str) -> str:
    return url_for(request.endpoint, **{**(request.view_args or {}), "lang": code})


def render(template: str, lang: str, status: int = 200, switch: Callable[[str], str] | None = None, **context: Any):
    languages = i18n.available_languages()
    current = next((item for item in languages if item["code"] == lang), languages[0])
    sess = current_session()
    response = make_response(
        render_template(
            template,
            lang=lang,
            current_language=current,
            languages=languages,
            t=lambda key, **params: i18n.t(lang, key, **params),
            catalogs=i18n.dashboard_catalogs(lang),
            lang_url=switch or _switch_language_here,
            csrf_token=sess.csrf if sess else "",
            csp_nonce=g.csp_nonce,
            **context,
        ),
        status,
    )
    response.set_cookie(LANG_COOKIE, lang, max_age=COOKIE_MAX_AGE, samesite="Lax", path="/")
    return response


def message(kind: str, status: int, lang: str):
    """A small full-page notice: login failed, login cancelled, dashboard not set up."""
    return render("dashboard/message.html", lang, status, switch=lambda code: url_for("landing", lang=code), kind=kind)


def login_required_page(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapper(*args: Any, **kwargs: Any):
        if current_session() is None:
            return redirect(url_for("dashboard.login", next=request.path, lang=kwargs.get("lang")))
        return view(*args, **kwargs)

    return wrapper


# -------------------------------------------------------- request hooks


@bp.before_request
def prepare():
    g.csp_nonce = secrets.token_urlsafe(16)
    # A session cookie arrived but Flask found nothing readable in it: its signature does not match
    # the current SECRET_KEY (changed or regenerated?) or the cookie's own lifetime has passed.
    g.cookie_unreadable = bool(request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])) and not session
    if request.path.startswith(API_PREFIX):
        return _guard_api()
    return None


def _guard_api():
    sess = current_session()
    if sess is None:
        return jsonify(error="unauthenticated"), 401
    if request.method not in SAFE_METHODS:
        if request.content_length and request.content_length > MAX_API_BODY:
            return jsonify(error="payload_too_large"), 413
        if not request.is_json:
            return jsonify(error="invalid_request"), 400
        sent = request.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(sent.encode("utf-8"), sess.csrf.encode("utf-8")):
            return jsonify(error="csrf"), 403
    return None


@bp.after_request
def harden(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if response.mimetype == "text/html":
        response.headers["Content-Security-Policy"] = "; ".join(
            [
                "default-src 'self'",
                f"script-src 'self' 'nonce-{g.get('csp_nonce', '')}'",
                "style-src 'self' https://fonts.googleapis.com",
                "font-src https://fonts.gstatic.com",
                "img-src 'self' https://cdn.discordapp.com https://media.discordapp.net",
                "connect-src 'self'",
                "frame-ancestors 'none'",
                "base-uri 'none'",
                "form-action 'self'",
            ]
        )
    return response


# ---------------------------------------------------------------- sign-in


def _redirect_uri() -> str:
    return _dash().settings.redirect_uri or url_for("dashboard.oauth_callback", _external=True)


def _start_oauth(flow: dict[str, Any]):
    settings = _dash().settings
    flow["state"] = secrets.token_urlsafe(24)
    session["oauth"] = flow
    return redirect(oauth.authorize_url(settings, _redirect_uri(), flow["state"], flow["prompt"]))


@bp.get("/login")
def login():
    lang = pick_lang(request.args.get("lang"))
    if not _dash().settings.enabled:
        return message("not_configured", 503, lang)

    target = safe_next(request.args.get("next"))
    refresh = bool(request.args.get("refresh"))
    if current_session() and not refresh:
        return redirect(target or url_for("dashboard.servers", lang=lang))

    return _start_oauth({"next": target, "lang": lang, "prompt": "none", "retried": False})


@bp.get("/oauth/callback")
def oauth_callback():
    dash = _dash()
    if not dash.settings.enabled:
        return message("not_configured", 503, pick_lang())

    flow = session.pop("oauth", None)
    lang = flow.get("lang") if isinstance(flow, dict) else None
    lang = lang if i18n.is_supported(lang) else pick_lang()

    sent_state = request.args.get("state", "")
    if not isinstance(flow, dict) or not hmac.compare_digest(
        sent_state.encode("utf-8"), str(flow.get("state", "")).encode("utf-8")
    ):
        return message("login_failed", 400, lang)

    error = request.args.get("error")
    if error:
        if error == "access_denied":
            return message("login_cancelled", 200, lang)
        if flow.get("prompt") == "none" and not flow.get("retried"):
            # The silent attempt failed (for example the app was never authorized): ask properly, once.
            return _start_oauth({**flow, "prompt": "consent", "retried": True})
        return message("login_failed", 400, lang)

    code = request.args.get("code")
    if not code:
        return message("login_failed", 400, lang)

    # The token only lives for these three calls and is not stored (and not revoked, see oauth.py).
    try:
        token = oauth.exchange_code(dash.settings, _redirect_uri(), code)
        user = oauth.fetch_user(dash.settings, token)
        guilds = oauth.fetch_guilds(dash.settings, token)
    except (oauth.OAuthError, KeyError, ValueError) as problem:
        log.warning("sign-in failed: %s", problem)
        return message("login_failed", 502, lang)

    created = dash.store.create(user, guilds)
    session.clear()  # new session id on every sign-in
    session.permanent = True
    session["sid"] = created.sid
    session["user"] = {"id": user["id"], "name": user["name"], "avatar": user["avatar"]}
    log.info("signed in: user %s, %d servers, session %s", user["id"], len(guilds), _short(created.sid))

    return redirect(flow.get("next") or url_for("dashboard.servers", lang=lang))


@bp.post("/logout")
def logout():
    if not _dash().settings.enabled:
        return redirect(url_for("landing", lang=pick_lang()))

    sess = current_session()
    if sess is not None:
        if not hmac.compare_digest(request.form.get("csrf", "").encode("utf-8"), sess.csrf.encode("utf-8")):
            abort(400)
        _dash().store.delete(sess.sid)
    session.clear()
    return redirect(url_for("landing", lang=pick_lang()))


# ------------------------------------------------------------------ pages


def _can_manage(guild: dict[str, Any]) -> bool:
    """Discord's own rule for adding a bot: owner, Administrator or Manage Server."""
    return bool(guild.get("owner")) or bool(int(guild.get("permissions", 0)) & (ADMINISTRATOR | MANAGE_GUILD))


def _initials(name: str) -> str:
    words = [word for word in re.split(r"\s+", name.strip()) if word]
    letters = [next((ch for ch in word if ch.isalnum()), "") for word in words[:2]]
    return ("".join(letters) or name.strip()[:1] or "?").upper()


@bp.get("/<lang>/servers")
@login_required_page
def servers(lang: str):
    if not i18n.is_supported(lang):
        abort(404)

    sess = current_session()
    guilds = sorted(sess.guilds, key=lambda item: item["name"].lower())

    sections: dict[str, list[str]] = {}
    unavailable = False
    if guilds:
        try:
            sections = _dash().bot.access(sess.user["id"], [item["id"] for item in guilds])
        except BotApiError:
            unavailable = True

    openable: list[dict[str, Any]] = []
    invitable: list[dict[str, Any]] = []
    for item in guilds:
        card = {**item, "initials": _initials(item["name"])}
        allowed = sections.get(item["id"])
        if allowed is not None:
            if allowed:
                card["limited"] = len(allowed) < SECTION_COUNT
                openable.append(card)
        elif _can_manage(item) and not unavailable:
            card["invite_url"] = invite_url(item["id"])
            invitable.append(card)

    return render(
        "dashboard/servers.html",
        lang,
        openable=openable,
        invitable=invitable,
        unavailable=unavailable,
        invite_url=invite_url(),
        refresh_url=url_for("dashboard.login", refresh=1, next=request.path, lang=lang),
    )


@bp.get("/<lang>/dashboard/<guild_id>")
@login_required_page
def guild_page(lang: str, guild_id: str):
    if not i18n.is_supported(lang) or not SNOWFLAKE.match(guild_id):
        abort(404)

    known = next((item for item in current_session().guilds if item["id"] == guild_id), None)
    return render(
        "dashboard/guild.html",
        lang,
        guild_id=guild_id,
        guild=known and {**known, "initials": _initials(known["name"])},
        invite_url=invite_url(guild_id),
    )


# ------------------------------------------------------------------- API


def _forward(guild_id: str, method: str, suffix: str = "", *, body: bool = False, params: dict[str, Any] | None = None):
    if not SNOWFLAKE.match(guild_id):
        return jsonify(error="guild_not_found"), 404
    try:
        payload = _dash().bot.request(
            method,
            f"/v1/guilds/{guild_id}{suffix}",
            user_id=current_session().user["id"],
            json=request.get_json(silent=True) if body else None,
            params=params,
        )
    except BotApiError as error:
        answer: dict[str, Any] = {"error": error.code}
        if error.detail:
            answer["detail"] = error.detail
        return jsonify(answer), error.status
    return jsonify(payload)


@bp.get(API_PREFIX + "<guild_id>")
def api_snapshot(guild_id: str):
    return _forward(guild_id, "GET")


@bp.put(API_PREFIX + "<guild_id>/log-channel")
def api_log_channel(guild_id: str):
    return _forward(guild_id, "PUT", "/log-channel", body=True)


@bp.put(API_PREFIX + "<guild_id>/birthday-channel")
def api_birthday_channel(guild_id: str):
    return _forward(guild_id, "PUT", "/birthday-channel", body=True)


@bp.put(API_PREFIX + "<guild_id>/temp-voice")
def api_temp_voice(guild_id: str):
    return _forward(guild_id, "PUT", "/temp-voice", body=True)


@bp.put(API_PREFIX + "<guild_id>/honeypot")
def api_honeypot(guild_id: str):
    return _forward(guild_id, "PUT", "/honeypot", body=True)


@bp.put(API_PREFIX + "<guild_id>/language")
def api_language(guild_id: str):
    return _forward(guild_id, "PUT", "/language", body=True)


@bp.patch(API_PREFIX + "<guild_id>/permissions")
def api_permissions(guild_id: str):
    return _forward(guild_id, "PATCH", "/permissions", body=True)


@bp.get(API_PREFIX + "<guild_id>/members")
def api_members(guild_id: str):
    return _forward(guild_id, "GET", "/members", params={"q": request.args.get("q", "")[:100]})


@bp.post(API_PREFIX + "<guild_id>/triggers")
def api_trigger_create(guild_id: str):
    return _forward(guild_id, "POST", "/triggers", body=True)


@bp.put(API_PREFIX + "<guild_id>/triggers")
def api_trigger_update(guild_id: str):
    return _forward(guild_id, "PUT", "/triggers", body=True)


@bp.post(API_PREFIX + "<guild_id>/triggers/delete")
def api_trigger_delete(guild_id: str):
    return _forward(guild_id, "POST", "/triggers/delete", body=True)
