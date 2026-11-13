"""
Routes:
    /            the landing page
    /links the page that lists every entry of data.LINKS with a title and a description
    /links/<link> redirects user to data.LINKS[<link>]
    /.well-known/discord verification for connect domain to a discord profile
    /api/locales returns every translation as JSON
    /api/locales/<locale> returns locale as JSON
    /api/links returns every link as JSON
    /api/links/<link> returns link as JSON
    /api/commands returns data.COMMAND_GROUPS as JSON
    /login, /oauth/callback, /logout, /dashboard, /dashboard/<guild>
                  the dashboard, see dashboard/views.py

Query:
    ?lang
"""

from __future__ import annotations

import os
from datetime import datetime
from urllib.parse import urlsplit

from flask import (
    Flask,
    abort,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
    g
)

import data
import i18n
from i18n import LOCALES_DIR

from data import LINKS, localized_command_groups
from dashboard import init_app as init_dashboard
from dotenv import load_dotenv

load_dotenv(".env")

app = Flask(__name__)
init_dashboard(app)

LANG_COOKIE = "devi_lang"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365

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
        command_name_key=data.command_name_key,
        feature_ids=data.FEATURE_IDS,
        links=data.LINKS,
        command_count=data.command_count(),
        group_count=data.group_count(),
        language_count=data.locale_count(),
        catalogs=i18n.all_catalogs(),
    )
    response = make_response(html)
    response.set_cookie(
        LANG_COOKIE, lang, max_age=COOKIE_MAX_AGE, samesite="Lax", path="/"
    )
    return response


def render_links_page(lang: str):
    """Render the page that lists every entry of data.LINKS in the given language."""
    languages = i18n.available_languages()
    current = next(item for item in languages if item["code"] == lang)

    # The same slim catalogues the dashboard ships (top bar, footer, theme button)
    # plus the strings of this page, so the language picker works without a reload.
    catalogs = {
        code: {**catalog, "links_page": i18n.catalog(code).get("links_page", {})}
        for code, catalog in i18n.dashboard_catalogs(lang).items()
    }

    # `id` is the key of data.LINKS and of links_page.items.<id> in the locale files.
    link_cards = [
        {"id": key, "url": url, "host": urlsplit(url).netloc}
        for key, url in LINKS.items()
    ]

    response = make_response(
        render_template(
            "links.html",
            lang=lang,
            current_language=current,
            languages=languages,
            t=lambda key, **params: i18n.t(lang, key, **params),
            catalogs=catalogs,
            link_cards=link_cards,
        )
    )
    response.set_cookie(
        LANG_COOKIE, lang, max_age=COOKIE_MAX_AGE, samesite="Lax", path="/"
    )
    return response

def best_language(requested: str | None = None) -> str:
    return i18n.pick_language(
        requested,
        request.cookies.get(LANG_COOKIE),
        request.headers.get("Accept-Language"),
    )


@app.route("/")
def landing():
    requested = request.args.get("lang")
    lang = best_language(requested)
    if requested != lang:
        return redirect(url_for("landing", lang=lang))
    return render_page(lang)

@app.route("/links", strict_slashes=False)
def links_page():
    requested = request.args.get("lang")
    lang = best_language(requested)
    if requested != lang:
        return redirect(url_for("links_page", lang=lang))
    return render_links_page(lang)

@app.route("/.well-known/discord")
def discord_connection():
    return os.environ.get("DISCORD_CONNECTION", "NO_CONNECTION")

@app.route("/api/locales")
def api_locales():
    lang = request.args.get("lang")
    if lang is None:
        return jsonify(i18n.all_catalogs())
    if not i18n.is_supported(lang):
        abort(404)
    return jsonify(i18n.catalog(lang))

@app.route("/links/<link>")
def links_link(link: str):
    if link not in LINKS:
        abort(404)
    return redirect(LINKS[link])

@app.route("/api/links")
def api_links():
    return jsonify(LINKS)

@app.route("/api/links/<link>")
def api_link(link: str):
    target = LINKS.get(link)

    if not target:
        abort(404)

    return jsonify(target)

@app.route("/api/commands")
def api_commands():
    lang = best_language(request.args.get("lang"))
    return jsonify(localized_command_groups(lang))

@app.errorhandler(404)
def not_found(_error):
    lang = best_language(request.args.get("lang"))
    return render_template("404.html", lang=lang, t=lambda key, **p: i18n.t(lang, key, **p)), 404

@app.errorhandler(403)
def forbidden(_error):
    lang = best_language(request.args.get("lang"))

    target = getattr(g, "forbidden_next", None)

    if not isinstance(target, str) or not target.startswith("/") or target.startswith("//") or "\\" in target:
        target = url_for("dashboard.servers", lang=lang)

    login_url = url_for("dashboard.login", lang=lang, next=target)

    return render_template("403.html", lang=lang, login_url=login_url, t=lambda key, **p: i18n.t(lang, key, **p),), 403

@app.context_processor
def inject_globals():
    return {"links": LINKS, "year": datetime.now().year}

@app.context_processor
def inject_template_helpers():
    def lang_url(language: str) -> str:
        endpoint = request.endpoint or "landing"
        values = dict(request.view_args or {})
        values.update(request.args.to_dict())
        values["lang"] = language
        return url_for(endpoint, **values)

    return {
        "lang_url": lang_url,
    }


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    if debug:
        # Pick up locale edits without restarting the process.
        i18n.reload_locales()
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=debug)
