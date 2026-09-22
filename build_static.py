"""Build a single self-contained HTML file out of the Flask site.

    python build_static.py            -> dist/index.html
    python build_static.py out.html   -> out.html

CSS and JS are inlined, and every language is embedded in the page, so the
result works from the file system, GitHub Pages or any static host.
Language links fall back to ?lang=xx; the switch itself runs in the browser.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from app import app, render_page
import i18n

BASE = Path(__file__).parent


def inline_assets(html: str) -> str:
    """Replace the stylesheet link and script tag with their contents."""
    css = (BASE / "static" / "css" / "style.css").read_text(encoding="utf-8")
    js = (BASE / "static" / "js" / "main.js").read_text(encoding="utf-8")

    html = re.sub(
        r'<link rel="stylesheet" href="[^"]*style\.css[^"]*">',
        lambda _m: "<style>\n" + css + "\n</style>",
        html,
    )
    html = re.sub(
        r'<script src="[^"]*main\.js[^"]*"></script>',
        lambda _m: "<script>\n" + js + "\n</script>",
        html,
    )
    return html


def rewrite_links(html: str) -> str:
    """Turn server routes into query strings so the file works offline."""
    for code in i18n.language_codes():
        html = html.replace('href="/%s/"' % code, 'href="?lang=%s"' % code)
    return html


def build(target: Path, lang: str | None = None) -> Path:
    lang = lang or i18n.DEFAULT_LANG
    with app.test_request_context("/%s/" % lang):
        html = render_page(lang).get_data(as_text=True)
    html = rewrite_links(inline_assets(html))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")
    return target


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "dist" / "index.html"
    path = build(out)
    print("built %s (%.1f KB)" % (path, path.stat().st_size / 1024))
