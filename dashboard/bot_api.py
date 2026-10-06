"""Client for the bot's internal HTTP API (cogs/dashboard_api.py in the bot repository).

The bot decides what a user may see and change; this module only carries the
request there: the shared secret proves the call comes from this site, and the
`X-Discord-User-Id` header says which signed-in user is asking.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

log = logging.getLogger("devi.dashboard")

TIMEOUT = (3.05, 10)


class BotApiError(Exception):
    """An error to show to the user: `code` is a key of dashboard.errors.* in the locales."""

    def __init__(self, status: int, code: str, detail: str | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.detail = detail


class BotApi:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._http = requests.Session()
        self._http.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/json"})

    def request(
        self,
        method: str,
        path: str,
        *,
        user_id: str,
        json: Any = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = self._http.request(
                method,
                self.base_url + path,
                headers={"X-Discord-User-Id": str(user_id)},
                json=json,
                params=params,
                timeout=TIMEOUT,
            )
        except requests.RequestException as error:
            log.warning("bot API unreachable: %s", error)
            raise BotApiError(502, "bot_unavailable") from error

        try:
            payload = response.json()
        except ValueError:
            log.error("bot API sent a non-JSON answer (HTTP %s) for %s %s", response.status_code, method, path)
            raise BotApiError(502, "bot_error") from None
        if not isinstance(payload, dict):
            raise BotApiError(502, "bot_error")

        if response.status_code == 401:
            log.error("the bot API rejected our token: BOT_API_TOKEN must equal DASHBOARD_API_TOKEN of the bot")
            raise BotApiError(502, "bot_misconfigured")
        if response.status_code >= 500:
            log.error("bot API error %s for %s %s: %s", response.status_code, method, path, payload)
            raise BotApiError(502, "bot_error")
        if response.status_code >= 400:
            detail = payload.get("detail")
            raise BotApiError(
                response.status_code,
                str(payload.get("error") or "bot_error"),
                str(detail) if detail else None,
            )
        return payload

    def access(self, user_id: str, guild_ids: list[str]) -> dict[str, list[str]]:
        """{guild id: sections the user may open}, only for servers where the bot is present."""
        payload = self.request("POST", "/v1/access", user_id=user_id, json={"guild_ids": guild_ids[:400]})
        guilds = payload.get("guilds")
        if not isinstance(guilds, dict):
            raise BotApiError(502, "bot_error")
        return {str(gid): list(info.get("sections", [])) for gid, info in guilds.items()}
