from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LOCALES_DIR = Path(__file__).parent / "locales"
DEFAULT_LANG = "en"

# Cache: lang code -> parsed dictionary.
_CACHE: dict[str, dict[str, Any]] = {}
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _load(lang: str) -> dict[str, Any]:
    """Read a locale file from disk, caching the result."""
    if lang in _CACHE:
        return _CACHE[lang]
    path = LOCALES_DIR / f"{lang}.json"
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8-sig") as fh:
        data = json.load(fh)
    _CACHE[lang] = data
    return data


def reload_locales() -> None:
    """Drop the cache so edited locale files are picked up."""
    _CACHE.clear()


def available_languages() -> list[dict[str, str]]:
    """Every language found on disk, default one first, then alphabetical."""
    langs = []
    for path in sorted(LOCALES_DIR.glob("*.json")):
        code = path.stem
        meta = _load(code).get("_meta", {})
        langs.append(
            {
                "code": code,
                "name": meta.get("name", code.upper()),
                "english_name": meta.get("english_name", code.upper()),
                "short": meta.get("short", code.upper()),
                "flag": meta.get("flag", "🏳️"),
                "dir": meta.get("dir", "ltr"),
            }
        )
    langs.sort(key=lambda item: (item["code"] != DEFAULT_LANG, item["code"]))
    return langs


def language_codes() -> list[str]:
    return [lang["code"] for lang in available_languages()]


def is_supported(lang: str | None) -> bool:
    return bool(lang) and (LOCALES_DIR / f"{lang}.json").is_file()


def _lookup(data: dict[str, Any], key: str) -> Any:
    """Resolve a dotted key inside a nested dict."""
    node: Any = data
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def t(lang: str, key: str, **params: Any) -> str:
    """Translate a key, falling back to the default language, then to the key.

    Placeholders are written as {name} and filled from params.
    """
    value = _lookup(_load(lang), key)
    if value is None and lang != DEFAULT_LANG:
        value = _lookup(_load(DEFAULT_LANG), key)
    if value is None:
        return key
    if not isinstance(value, str):
        return value
    if params:
        return _PLACEHOLDER.sub(lambda m: str(params.get(m.group(1), m.group(0))), value)
    return value


def catalog(lang: str) -> dict[str, Any]:
    """Full dictionary for a language, merged over the default one.

    Used to ship every string to the browser so switching languages does not
    need a round trip.
    """
    merged = json.loads(json.dumps(_load(DEFAULT_LANG)))
    _deep_update(merged, _load(lang))
    return merged


def all_catalogs() -> dict[str, dict[str, Any]]:
    return {code: catalog(code) for code in language_codes()}


def _deep_update(base: dict[str, Any], extra: dict[str, Any]) -> None:
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value


def pick_language(url_lang: str | None, cookie_lang: str | None,
                  accept_language: str | None) -> str:
    """Choose a language: URL wins, then cookie, then browser, then default."""
    if is_supported(url_lang):
        return url_lang  # type: ignore[return-value]
    if is_supported(cookie_lang):
        return cookie_lang  # type: ignore[return-value]
    for code in _parse_accept_language(accept_language):
        if is_supported(code):
            return code
        base = code.split("-")[0]
        if is_supported(base):
            return base
    return DEFAULT_LANG


def _parse_accept_language(header: str | None) -> list[str]:
    """Return language tags from an Accept-Language header, best first."""
    if not header:
        return []
    items: list[tuple[float, str]] = []
    for chunk in header.split(","):
        parts = chunk.strip().split(";q=")
        code = parts[0].strip().lower()
        if not code or code == "*":
            continue
        try:
            quality = float(parts[1]) if len(parts) > 1 else 1.0
        except ValueError:
            quality = 1.0
        items.append((quality, code))
    items.sort(key=lambda item: item[0], reverse=True)
    return [code for _, code in items]
