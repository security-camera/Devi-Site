# Contributing to Devi — Website and Dashboard

Thank you for considering a contribution to the Devi website. This guide describes the project structure, local setup, implementation conventions, validation steps, and pull request expectations.

Before changing the code, read the [README](README.md) and the repository's [LICENSE](LICENSE.md). The README documents the application, dashboard integration, language system, static build, and deployment model.

## 1. What belongs in this repository?

`Devi-Site` contains the Flask website and browser-based dashboard for the [Devi Discord bot](https://github.com/security-camera/Devi-Discord-Bot). It includes:

- The public landing page, command catalogue, links page, themes, and language switcher.
- The optional Discord OAuth2 sign-in flow and server-side dashboard sessions.
- Dashboard pages and browser-side settings forms.
- The website's internal API, which forwards dashboard operations to the bot's private HTTP API.
- Static assets, templates, and translations.

The Discord bot, its commands, permission checks, database, and internal dashboard API are maintained in the separate [Devi-Discord-Bot repository](https://github.com/security-camera/Devi-Discord-Bot).

When a change affects communication between the website and the bot, check both repositories. For example, adding a dashboard section usually requires a coordinated change to the bot API, website routes, JavaScript UI, and dashboard translations. See [Adding a dashboard section](README.md#adding-a-dashboard-section) in the README.

For substantial changes, open an issue or discuss the approach with the maintainer before implementation. This is especially useful for changes to authentication, session handling, authorization, API contracts, or the dashboard structure. Small documentation fixes and straightforward bug fixes can be submitted directly.

## 2. License and contribution rights

The project is distributed under the **Devi Non-Commercial License (DNCL) 2.0**. It is a source-available license, not a standard permissive open-source license.

Section 14 of [LICENSE](LICENSE.md) applies to contributions:

- Unless otherwise agreed in writing, contributions to the official Devi project must be capable of being distributed under DNCL 2.0 and any other license selected by the Copyright Holder for the project.
- By submitting a contribution, you represent that you have the necessary rights to submit it and authorize its inclusion in the project.
- Submission does not, by itself, transfer ownership of your contribution to the Copyright Holder.

Only submit code, translations, documentation, images, fonts, and other materials that you created or are authorized to contribute under terms compatible with the project. Retain required third-party notices and licenses.

Read the complete license before submitting changes. DNCL 2.0 permits use of the original Devi software, including certain internal commercial uses, but restricts commercial forks and specified commercial derivative uses. Do not assume that permission to use the original website or bot grants permission to create or distribute a commercial derivative.

## 3. Development environment

### Requirements

- Python 3.10 or newer (the source uses modern Python syntax and type annotations).
- pip and a virtual environment.
- A browser for manually checking the landing page and dashboard.
- A Discord application and a test Discord server only when working on OAuth2 sign-in or the live dashboard.
- A running test instance of Devi-Discord-Bot when exercising dashboard operations end to end.

The Python dependencies listed by the repository are Flask, Requests, and python-dotenv. The browser code uses plain JavaScript, CSS, and HTML templates; there is no Node.js package manifest or frontend build tool in the repository.

### Clone and install

Run these commands from the repository root:

```bash
git clone https://github.com/security-camera/Devi-Site.git
cd Devi-Site
python -m venv .venv
```

Activate the environment and install the dependencies:

**Windows PowerShell**

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**Linux / macOS**

```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### Run the landing page

The landing page does not require Discord OAuth2 or a running bot API. Start the Flask development server from the repository root:

```bash
python app.py
```

Open `http://127.0.0.1:5000`. The development server uses debug mode by default. Set `FLASK_DEBUG=0` to disable it. Do not expose the development server to the public internet or use it as the production WSGI server.

### Configure the dashboard locally

The dashboard stays disabled until the required credentials are configured. To enable it, copy `env_example.env` to `.env` in the repository root and fill in the values:

**Windows PowerShell**

```powershell
Copy-Item env_example.env .env
```

**Linux / macOS**

```bash
cp env_example.env .env
```

The main settings are:

| Variable                | Purpose                                                                                                 |
|-------------------------|---------------------------------------------------------------------------------------------------------|
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret from the Discord Developer Portal.                                                 |
| `DISCORD_REDIRECT_URI`  | OAuth2 callback URL registered in the Discord application. Use the exact URL configured in the portal.  |
| `BOT_API_TOKEN`         | Shared secret matching `DASHBOARD_API_TOKEN` in the bot configuration.                                  |
| `BOT_API_URL`           | Bot's internal API URL; defaults to `http://127.0.0.1:8765`.                                            |
| `DISCORD_CLIENT_ID`     | Optional Discord application ID; otherwise it is derived from the invite URL in `data.py`.              |
| `SECRET_KEY`            | Optional Flask session-signing key. If omitted, a key is generated and stored in `instance/secret_key`. |
| `DEVI_SESSION_DAYS`     | Session lifetime in days; defaults to `7`.                                                              |
| `DEVI_SESSION_DB`       | SQLite session database path; defaults to `instance/sessions.sqlite3`.                                  |
| `DEVI_LOG_LEVEL`        | Dashboard log level; defaults to `INFO`.                                                                |

`DISCORD_CONNECTION` is an optional value used by the Discord connection verification route. `FLASK_DEBUG` and `PORT` control the local development server.

Use a dedicated test Discord application, test server, bot instance, API token, and session database. Never point local experiments at production infrastructure or reuse production secrets. The `.env` file and `instance/` directory are excluded from Git; do not force-add them.

For the OAuth2 flow, register `https://<your-test-domain>/oauth/callback` as a redirect URI in the Discord Developer Portal and set the same value in `DISCORD_REDIRECT_URI`. For local HTTP testing, configure a matching local redirect URI in the Discord application. The cookie's `Secure` flag is enabled when the redirect URI uses HTTPS.

The bot API should remain on localhost or a private network. The site sends the shared bearer token to that API; it must not be exposed as a public endpoint. The website authenticates the user and forwards the user's Discord ID, but the bot is responsible for checking whether that user may view or change a particular server setting.

## 4. Project structure

| Path                    | Responsibility                                                                                  |
|-------------------------|-------------------------------------------------------------------------------------------------|
| `app.py`                | Flask routes for the landing page, links, and public JSON endpoints; initializes the dashboard. |
| `data.py`               | Static command catalogue, public links, and feature identifiers.                                |
| `i18n.py`               | Locale discovery, translation lookup, fallback, and catalogue generation.                       |
| `dashboard/views.py`    | Sign-in, server picker, dashboard pages, and dashboard JSON routes.                             |
| `dashboard/oauth.py`    | Discord OAuth2 authorization-code flow and profile/server lookups.                              |
| `dashboard/sessions.py` | Server-side SQLite session storage.                                                             |
| `dashboard/settings.py` | Environment configuration and secret-key handling.                                              |
| `dashboard/bot_api.py`  | HTTP client for the bot's private API.                                                          |
| `templates/`            | Jinja templates for the landing page and dashboard.                                             |
| `static/css/`           | Landing-page and dashboard stylesheets.                                                         |
| `static/js/`            | Browser-side landing-page and dashboard behavior.                                               |
| `locales/`              | Landing-page translations.                                                                      |
| `locales/dashboard/`    | Dashboard translations, kept separately from landing-page strings.                              |
| `assets/`               | Screenshots and other website assets.                                                           |
| `build_static.py`       | Produces a self-contained static version of the landing page.                                   |
| `env_example.env`       | Example configuration; contains no production secrets.                                          |

Keep new functionality in the module responsible for it. Avoid adding unrelated features to `app.py` or duplicating OAuth, session, or bot API logic in individual route handlers.

## 5. Implementation guidelines

### Python and Flask

- Follow the style of the surrounding code. Use four spaces for indentation, `snake_case` for functions and variables, and `PascalCase` for classes.
- Keep route handlers focused on HTTP input/output and orchestration. Put reusable logic in the relevant dashboard module or a shared helper.
- Use Flask's existing request, response, template, and blueprint patterns. Preserve route methods and response formats unless an API change is intentional and coordinated.
- Set timeouts for outbound HTTP requests. Handle network failures and invalid responses without exposing credentials or internal exception details to visitors.
- Do not add a new dependency for functionality already supported by the standard library or existing dependencies without a clear reason.
- Keep changes scoped. Avoid reformatting or renaming unrelated code in a bug-fix pull request.

### Browser code, templates, and styles

- The frontend is plain JavaScript without a bundler. Keep browser code compatible with the existing scripts and avoid introducing a mandatory build step without discussing it first.
- Use the existing Jinja templates and shared partials rather than duplicating page headers, navigation, or footer markup.
- Keep styles in the appropriate stylesheet (`static/css/style.css` or `static/css/dashboard.css`) and reuse existing CSS variables and component conventions.
- Keep dashboard behavior in `static/js/dashboard.js`; landing-page behavior belongs in `static/js/main.js`.
- Prefer semantic HTML and accessible controls. Preserve keyboard navigation, visible focus, labels, and responsive behavior.
- Do not put untrusted text into the DOM as HTML. Use safe text rendering and the existing DOM helper patterns in `dashboard.js`; do not use `innerHTML` with user-controlled values.
- Preserve the Content Security Policy model. Dashboard pages use a nonce for inline scripts and restrict framing and other browser capabilities; do not weaken these protections to make a change work.

### Dashboard authorization and security

Security-sensitive behavior must remain enforced on the server, not only in the browser:

- Do not treat a server list, hidden section, disabled button, or client-side check as proof of permission.
- The bot makes the authoritative decision about which server sections a user may access and which settings they may change. Keep the bot-side authorization checks in place for every operation.
- Preserve the CSRF checks for state-changing dashboard requests. Browser requests that modify data must send the session's `X-CSRF-Token` header.
- Preserve safe redirect handling. Never turn `next`, callback, or other user-controlled URL parameters into an unrestricted external redirect.
- Do not store Discord OAuth access tokens. The current flow uses the token for the sign-in lookups and discards it; do not add token persistence without an explicit security review.
- Do not log session IDs, cookies, OAuth codes, bot API tokens, client secrets, or other credentials. Log only the minimum information needed for diagnosis.
- Keep the bot API private. Do not change the default loopback binding or deployment instructions in a way that exposes it to the internet.
- Preserve secure cookie settings, session ID hashing, session expiry, and `Cache-Control: no-store` behavior for authenticated pages.

A dashboard/API change should be checked against the corresponding bot implementation in `Devi-Discord-Bot`, particularly the authorization behavior and request/response contract.

### Dashboard API integration

`dashboard/bot_api.py` is the website's client for the bot API. The website forwards a request with the shared bearer token and the signed-in user's Discord ID. The bot performs the final authorization check.

When changing an API route or payload:

1. Confirm the bot API endpoint, method, request body, and response shape.
2. Update the corresponding forwarding route in `dashboard/views.py`.
3. Update `static/js/dashboard.js` to send and handle the new data.
4. Preserve status codes and localized error handling.
5. Test both successful and denied requests against a test bot instance.

Do not silently change an endpoint or payload that the bot and site both depend on.

### Localization

All user-visible text should use the existing localization system. Avoid hardcoding text in Python routes, templates, or JavaScript.

The repository keeps landing-page and dashboard translations in separate directories:

- `locales/<language>.json` — landing page, links page, command descriptions, metadata, and shared page text.
- `locales/dashboard/<language>.json` — dashboard-specific navigation, sections, forms, and errors.

Current locale codes in the repository are `bg`, `de`, `en`, `es-419`, `fi`, `ru`, and `uk`.

When adding or changing a string:

1. Add or update the key in the default English locale (`locales/en.json`).
2. Keep the nested key structure consistent in the other landing-page locale files.
3. For dashboard strings, update the matching `locales/dashboard/*.json` files. A missing dashboard catalogue falls back to English, but complete translations are preferred.
4. Preserve interpolation placeholders such as `{name}`, `{count}`, or `{guild}` exactly.
5. Preserve the `_meta` fields (`name`, `english_name`, `short`, `flag`, and `dir`) when editing language metadata.
6. Use valid UTF-8 JSON. Follow the four-space indentation used by the existing files.

To add a language, create `locales/<code>.json` using `locales/en.json` as the template. For a translated dashboard, also create `locales/dashboard/<code>.json` using the English dashboard catalogue. Set `_meta.dir` to `rtl` for a right-to-left language. The language is discovered from the files; do not hardcode a separate language list unless there is a specific implementation reason.

The website's own language list is separate from the languages supported by the Discord bot. The dashboard's **Language** setting is populated by the bot API and must not be modified by adding a website locale alone.

### Commands and links on the landing page

The command catalogue and public links are maintained in `data.py`:

- When adding a displayed bot command, add it to the appropriate `COMMAND_GROUPS` entry and add its description to every landing-page locale under `cmd.<key>`.
- When adding a public link, add it to `LINKS` and add `links_page.items.<key>.title` and `links_page.items.<key>.description` to the locale files.
- Keep user-facing names and descriptions in translation files, not in `data.py`.

### Configuration and dependencies

- Document every new environment variable in `env_example.env`, including whether it is required and its default behavior.
- Do not add secrets or real environment values to the example file.
- Add Python dependencies to `requirements.txt` only when required. Keep version constraints consistent with the project's current dependency policy.
- Remember that `.env`, `instance/`, bytecode, and other runtime data are excluded by `.gitignore`.
- Do not commit the session database, generated secret key, logs, local virtual environments, or deployment-specific files.

## 6. Validation and testing

The repository currently has no checked-in automated test suite, test-runner configuration, CI workflow, or frontend package/build configuration. Do not assume that pytest, Ruff, Black, ESLint, or Prettier is installed or configured.

Run the following checks from the repository root before submitting changes.

### Compile Python files

```bash
python -m compileall -q app.py dashboard data.py i18n.py build_static.py
```

### Validate both sets of locale files

```bash
python -c "import json; from pathlib import Path; files = list(Path('locales').glob('*.json')) + list(Path('locales/dashboard').glob('*.json')); [json.loads(p.read_text(encoding='utf-8-sig')) for p in files]; print(f'Validated {len(files)} locale files')"
```

### Build the static landing page

The static build checks that the landing page can be rendered with its templates and assets:

```bash
python build_static.py out.html
```

Run this in a local environment where the dashboard is not configured. The static build is for the landing page only; it does not include the live dashboard or server-side routes.

### Manual smoke tests

Test the parts affected by your change:

- Landing page: load the page, switch languages, switch themes, and check the layout at desktop and narrow/mobile widths.
- Links and public JSON routes: check valid and unknown link/locale keys and verify the expected status codes.
- Localization: verify the new or changed strings in each locale you edited, including placeholder replacement and right-to-left layout if relevant.
- Dashboard sign-in: test the OAuth callback, session creation, refresh, expiry, and sign-out where relevant.
- Dashboard security: verify unauthenticated requests, missing or invalid CSRF headers, denied permissions, and safe redirect handling.
- Dashboard settings: test against a separate bot instance and confirm that both successful updates and bot/API errors are handled correctly.
- Static build: open the generated HTML directly or serve it from a static host and verify manual language switching.

List the checks you actually ran in your pull request. If an integration test was not possible because you lacked a Discord application, test bot, API credentials, or access to an external service, state that clearly.

## 7. Commits and pull requests

Create a focused branch from `master`. The following branch prefixes are suggested, not mandatory:

- `feat/` — new functionality.
- `fix/` — bug fixes.
- `docs/` — documentation changes.
- `i18n/` — localization changes.
- `refactor/` — internal restructuring without intended behavior changes.

Keep commits and pull requests focused on one logical change. Avoid mixing unrelated UI redesigns, API changes, and refactoring in a single pull request.

A pull request should include:

- A clear description of the issue and the proposed solution.
- Links to related issues or discussions, if any.
- The affected parts of the site (landing page, translations, dashboard, OAuth/session flow, API integration, static build, and so on).
- Any new or changed environment variables, dependencies, API contracts, or deployment requirements.
- The validation steps you performed and their results.
- Screenshots or a short recording for visible UI changes, where useful.

Before submitting, inspect the complete diff. Make sure it contains no `.env` file, credentials, session data, generated secrets, local runtime files, AI instructions (`CLAUDE.md` or `AGENTS.md`) or unrelated changes. Be prepared to address review feedback and update the pull request.

## 8. Reporting security issues

Do not disclose credentials, session data, private user information, or exploitable vulnerability details in a public issue or pull request. Report suspected security vulnerabilities privately to the maintainer through GitHub rather than publishing reproduction details before they can be reviewed.

---

By contributing, you confirm that you have read and will comply with the applicable terms in [LICENSE](LICENSE.md).
