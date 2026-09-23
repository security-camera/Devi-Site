"""Devi — landing page.

Run locally:
    pip install -r requirements.txt
    python app.py
    open http://127.0.0.1:5000

Routes:
    /            redirects to the best language for the visitor
    /<lang>/     the landing page in that language
    /api/locales returns every translation as JSON
"""

from __future__ import annotations

import os
from datetime import datetime

from flask import (
    Flask,
    abort,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

import data
import i18n
from i18n import LOCALES_DIR

app = Flask(__name__)

LANG_COOKIE = "devi_lang"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365

def _locale_count() -> int:
    if not os.path.isdir(LOCALES_DIR):
        return 0

    return len(sorted(
        file
        for file in os.listdir(LOCALES_DIR)
        if file.endswith(".json")
    ))

def render_page(lang: str):
    """Render the landing page in the given language."""
    translate = lambda key, **params: i18n.t(lang, key, **params)  # noqa: E731
    languages = i18n.available_languages()
    current = next(item for item in languages if item["code"] == lang)

    html = render_template(
        "index.html",
        lang=lang,
        current_language=current,
        languages=languages,
        t=translate,
        groups=data.COMMAND_GROUPS,
        feature_ids=data.FEATURE_IDS,
        links=data.LINKS,
        command_count=data.command_count(),
        group_count=data.group_count(),
        language_count=_locale_count(),
        catalogs=i18n.all_catalogs(),
    )
    response = make_response(html)
    response.set_cookie(
        LANG_COOKIE, lang, max_age=COOKIE_MAX_AGE, samesite="Lax", path="/"
    )
    return response


@app.route("/")
def root():
    """Send the visitor to their language, honouring ?lang= if present."""
    lang = i18n.pick_language(
        request.args.get("lang"),
        request.cookies.get(LANG_COOKIE),
        request.headers.get("Accept-Language"),
    )
    return redirect(url_for("landing", lang=lang))


@app.route("/<lang>/")
def landing(lang: str):
    if not i18n.is_supported(lang):
        abort(404)
    return render_page(lang)


@app.route("/api/locales")
def api_locales():
    """Every translation, for clients that want to switch without a reload."""
    return jsonify(i18n.all_catalogs())


@app.errorhandler(404)
def not_found(_error):
    lang = i18n.pick_language(
        None,
        request.cookies.get(LANG_COOKIE),
        request.headers.get("Accept-Language"),
    )
    return render_template("404.html", lang=lang, t=lambda key, **p: i18n.t(lang, key, **p)), 404


@app.context_processor
def inject_globals():
    return {"links": data.LINKS, "year": datetime.now().year}


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    if debug:
        # Pick up locale edits without restarting the process.
        i18n.reload_locales()
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=debug)
