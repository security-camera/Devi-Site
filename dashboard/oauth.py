"""Discord OAuth2 (authorization code flow) with the `identify` and `guilds` scopes.

The access token is used once during sign-in, to read the user's profile and
server list, and is revoked right after. Nothing that could act on the user's
behalf is stored. Who may do what on a server is decided by the bot on every
request, so a stale server list can never grant access.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import requests

from .settings import Settings

log = logging.getLogger("devi.dashboard")

USER_AGENT = "DeviSite (https://github.com/security-camera/Devi-Site, 1.0)"
TIMEOUT = (3.05, 10)
SCOPES = ("identify", "guilds")
GUILDS_PER_PAGE = 200
MAX_GUILD_PAGES = 5  # 1000 servers is far beyond what Discord allows a user to join
CDN = "https://cdn.discordapp.com"


class OAuthError(Exception):
    """Discord refused a request or could not be reached."""


def authorize_url(settings: Settings, redirect_uri: str, state: str, prompt: str) -> str:
    query = urlencode(
        {
            "client_id": settings.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": " ".join(SCOPES),
            "state": state,
            # "none" skips the consent screen for people who already authorized the app.
            "prompt": prompt,
        }
    )
    return f"{settings.discord_authorize}?{query}"


def _call(method: str, url: str, **kwargs: Any) -> requests.Response:
    headers = kwargs.pop("headers", {})
    headers.setdefault("User-Agent", USER_AGENT)
    try:
        return requests.request(method, url, headers=headers, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as error:
        raise OAuthError(f"cannot reach Discord: {error}") from error


def _json(response: requests.Response, what: str) -> Any:
    if response.status_code != 200:
        raise OAuthError(f"{what} failed with HTTP {response.status_code}: {response.text[:200]}")
    try:
        return response.json()
    except ValueError as error:
        raise OAuthError(f"{what} returned invalid JSON") from error


def exchange_code(settings: Settings, redirect_uri: str, code: str) -> str:
    response = _call(
        "POST",
        f"{settings.discord_api}/oauth2/token",
        data={
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )
    payload = _json(response, "token exchange")
    token = payload.get("access_token")
    granted = set(str(payload.get("scope", "")).split())
    if not token or not set(SCOPES) <= granted:
        raise OAuthError("token exchange did not grant the required scopes")
    return str(token)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def fetch_user(settings: Settings, token: str) -> dict[str, Any]:
    raw = _json(_call("GET", f"{settings.discord_api}/users/@me", headers=_bearer(token)), "user lookup")
    user_id = str(raw["id"])
    return {
        "id": user_id,
        "name": raw.get("global_name") or raw.get("username") or user_id,
        "avatar": avatar_url(user_id, raw.get("avatar"), raw.get("discriminator")),
    }


def fetch_guilds(settings: Settings, token: str) -> list[dict[str, Any]]:
    guilds: list[dict[str, Any]] = []
    after: str | None = None

    for _ in range(MAX_GUILD_PAGES):
        params: dict[str, Any] = {"limit": GUILDS_PER_PAGE}
        if after:
            params["after"] = after
        page = _json(
            _call("GET", f"{settings.discord_api}/users/@me/guilds", headers=_bearer(token), params=params),
            "server list",
        )
        for raw in page:
            guilds.append(
                {
                    "id": str(raw["id"]),
                    "name": raw.get("name") or str(raw["id"]),
                    "icon": icon_url(str(raw["id"]), raw.get("icon")),
                    "owner": bool(raw.get("owner")),
                    "permissions": int(raw.get("permissions") or 0),
                }
            )
        if len(page) < GUILDS_PER_PAGE:
            break
        after = str(page[-1]["id"])

    return guilds


def revoke_token(settings: Settings, token: str) -> None:
    """Best effort: a failure only means the token expires on its own in a week."""
    try:
        _call(
            "POST",
            f"{settings.discord_api}/oauth2/token/revoke",
            data={
                "client_id": settings.client_id,
                "client_secret": settings.client_secret,
                "token": token,
                "token_type_hint": "access_token",
            },
        )
    except OAuthError as error:
        log.warning("could not revoke the OAuth token: %s", error)


def avatar_url(user_id: str, avatar_hash: str | None, discriminator: str | None = None) -> str:
    if avatar_hash:
        return f"{CDN}/avatars/{user_id}/{avatar_hash}.png?size=64"
    if discriminator and discriminator != "0":
        index = int(discriminator) % 5  # legacy usernames
    else:
        index = (int(user_id) >> 22) % 6
    return f"{CDN}/embed/avatars/{index}.png"


def icon_url(guild_id: str, icon_hash: str | None) -> str | None:
    return f"{CDN}/icons/{guild_id}/{icon_hash}.png?size=128" if icon_hash else None
