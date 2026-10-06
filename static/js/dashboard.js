/* =========================================================
   Devi — dashboard
   Loads the settings of one server from /api/dashboard/<id> and lets the
   user change them. Plain JavaScript, no build step.

   Strings live in the dashboard.* part of the locale catalogues
   (locales/dashboard/<lang>.json). main.js owns the language picker and the
   theme switch; this file only re-renders when the language changes.
   ========================================================= */

(function () {
    "use strict";

    const root = document.getElementById("dash");
    if (!root) {
        return;
    }

    const content = document.getElementById("dash-content");
    const nav = document.getElementById("dash-nav");
    const guildBox = document.getElementById("dash-guild");
    const toasts = document.getElementById("toasts");
    const html = document.documentElement;

    const apiBase = root.dataset.api;
    const csrfToken = root.dataset.csrf;
    const loginUrl = root.dataset.loginUrl;
    const serversUrl = root.dataset.serversUrl;
    const inviteUrl = root.dataset.inviteUrl;

    /* ---------- translations ---------- */

    let catalogs = {};
    try {
        catalogs = JSON.parse(document.getElementById("i18n-data").textContent);
    } catch (error) {
        catalogs = {};
    }

    const defaultLang = Object.keys(catalogs)[0] || "en";
    let lang = html.getAttribute("data-lang") || defaultLang;

    function lookup(code, key) {
        let node = catalogs[code] && catalogs[code].dashboard;

        for (const part of key.split(".")) {
            if (!node || typeof node !== "object" || !(part in node)) {
                return null;
            }
            node = node[part];
        }

        return typeof node === "string" ? node : null;
    }

    function has(key) {
        return lookup(lang, key) !== null || lookup(defaultLang, key) !== null;
    }

    function t(key, params) {
        let value = lookup(lang, key);

        if (value === null) {
            value = lookup(defaultLang, key);
        }
        if (value === null) {
            return key;
        }

        return value.replace(/\{(\w+)\}/g, function (match, name) {
            return params && name in params ? String(params[name]) : match;
        });
    }

    /* ---------- DOM helpers ---------- */

    const PROPERTIES = ["value", "checked", "disabled", "selected", "hidden"];

    function append(node, child) {
        if (child === null || child === undefined || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            child.forEach(function (item) {
                append(node, item);
            });
            return;
        }
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }

    // h("div", { class: "x", onclick: fn }, child, [children], "text")
    function h(tag, attrs) {
        const node = document.createElement(tag);

        if (attrs) {
            Object.keys(attrs).forEach(function (key) {
                const value = attrs[key];

                if (value === null || value === undefined || value === false) {
                    return;
                }
                if (key === "class") {
                    node.className = value;
                } else if (key === "style") {
                    // CSSOM calls are allowed by the page's CSP, inline style attributes are not.
                    Object.keys(value).forEach(function (name) {
                        node.style.setProperty(name, value[name]);
                    });
                } else if (key.indexOf("on") === 0 && typeof value === "function") {
                    node.addEventListener(key.slice(2), value);
                } else if (PROPERTIES.indexOf(key) >= 0) {
                    node[key] = value;
                } else {
                    node.setAttribute(key, value === true ? "" : String(value));
                }
            });
        }

        for (let i = 2; i < arguments.length; i++) {
            append(node, arguments[i]);
        }

        return node;
    }

    function button(label, classes, onclick, disabled) {
        return h("button", { class: "btn " + classes, type: "button", onclick: onclick, disabled: !!disabled }, label);
    }

    function debounce(fn, wait) {
        let timer = 0;

        return function () {
            const args = arguments;

            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(null, args);
            }, wait);
        };
    }

    function initials(name) {
        const letters = name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(function (word) {
                const match = word.match(/[\p{L}\p{N}]/u);
                return match ? match[0] : "";
            })
            .join("");

        return (letters || name.trim().slice(0, 1) || "?").toUpperCase();
    }

    /* ---------- talking to the site's API ---------- */

    class ApiError extends Error {
        constructor(status, code, detail) {
            super(code);
            this.status = status;
            this.code = code;
            this.detail = detail || null;
        }
    }

    async function api(method, suffix, body) {
        const headers = { Accept: "application/json", "X-CSRF-Token": csrfToken };
        const options = { method: method, headers: headers, credentials: "same-origin" };

        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetch(apiBase + suffix, options);
        } catch (error) {
            throw new ApiError(0, "network");
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok) {
            throw new ApiError(response.status, (payload && payload.error) || "server", payload && payload.detail);
        }

        return payload;
    }

    // Codes the bot or the site can send that all read the same to the user.
    const ERROR_ALIASES = {
        bot_error: "server",
        bot_misconfigured: "server",
        internal: "server",
        http_error: "server",
        triggers_unavailable: "server",
        invalid_json: "invalid_request",
        invalid_id: "invalid_request",
        invalid_user: "invalid_request",
        invalid_guild: "invalid_request",
        invalid_guild_ids: "invalid_request",
        invalid_changes: "invalid_request",
        invalid_scope: "invalid_request",
        invalid_mask: "invalid_request",
        duplicate_target: "invalid_request"
    };

    // Errors that mention a limit; the number comes from the bot's snapshot.
    const LIMIT_OF = {
        name_template_too_long: "max_name_template",
        pattern_too_long: "max_pattern",
        response_too_long: "max_response",
        too_many_responses: "max_responses",
        too_many_triggers: "max_triggers"
    };

    function errorMessage(error) {
        const code = ERROR_ALIASES[error.code] || error.code;
        const params = { detail: error.detail || "" };

        if (LIMIT_OF[code] && state.data) {
            params.max = state.data.limits[LIMIT_OF[code]];
        }

        return has("errors." + code) ? t("errors." + code, params) : t("errors.server");
    }

    function toast(kind, text) {
        const node = h("div", { class: "toast toast--" + kind, role: kind === "error" ? "alert" : null }, text);

        toasts.append(node);
        while (toasts.children.length > 3) {
            toasts.firstChild.remove();
        }
        setTimeout(function () {
            node.remove();
        }, kind === "error" ? 7000 : 3000);
    }

    function fail(error) {
        if (error.code === "unauthenticated") {
            window.location.assign(loginUrl);
            return;
        }

        toast("error", errorMessage(error));

        // The user lost access or the bot left: show the real state instead of a stale editor.
        if (error.code === "forbidden" || error.code === "guild_not_found") {
            load();
        }
    }

    /* ---------- state ---------- */

    const ORDER = ["permissions", "birthdays", "logs", "voice", "triggers"];
    const ICONS = { permissions: "🗂️", birthdays: "🥳", logs: "📝", voice: "⌛", triggers: "💬" };
    const KIND_PREFIX = { text: "# ", forum: "# ", voice: "🔊 ", stage: "🎙️ " };

    const state = {
        phase: "loading", // loading | ready | error
        problem: null, // forbidden | not_found | unavailable | server
        data: null, // the snapshot from the bot
        section: null,
        busy: {},
        logs: null,
        birthdays: null,
        voice: null,
        perms: null,
        triggers: null
    };

    function available() {
        return ORDER.filter(function (name) {
            return state.data.sections.indexOf(name) >= 0;
        });
    }

    function settings(name) {
        return state.data.settings[name];
    }

    function channelById(id) {
        return state.data.channels.find(function (channel) {
            return channel.id === id;
        }) || null;
    }

    function roleById(id) {
        return state.data.roles.find(function (role) {
            return role.id === id;
        }) || null;
    }

    function problemOf(error) {
        if (error.status === 403) {
            return "forbidden";
        }
        if (error.status === 404) {
            return "not_found";
        }
        if (error.code === "bot_unavailable" || error.code === "network") {
            return "unavailable";
        }
        return "server";
    }

    async function load() {
        state.phase = "loading";
        render();

        try {
            state.data = await api("GET", "");
            initForms();
            state.phase = "ready";
            state.section = pickSection();
        } catch (error) {
            if (error.code === "unauthenticated") {
                window.location.assign(loginUrl);
                return;
            }
            state.phase = "error";
            state.problem = problemOf(error);
        }

        render();
    }

    function pickSection() {
        const wanted = window.location.hash.slice(1);
        const names = available();

        return names.indexOf(wanted) >= 0 ? wanted : names[0];
    }

    function initForms() {
        const current = state.data.settings;

        state.busy = {};
        state.logs = { value: current.logs ? current.logs.channel_id || "" : "" };
        state.birthdays = { value: current.birthdays ? current.birthdays.channel_id || "" : "" };
        state.voice = current.voice ? voiceDraft(current.voice) : null;
        state.perms = current.permissions ? buildPerms(current.permissions, null) : null;
        state.triggers = { query: "", creating: null, editing: null, removing: {} };
    }

    function isDirty(name) {
        if (!state.data || available().indexOf(name) < 0) {
            return false;
        }

        switch (name) {
            case "logs":
            case "birthdays":
                return state[name].value !== (settings(name).channel_id || "");
            case "voice":
                return voiceDirty();
            case "permissions":
                return dirtyEntries().length > 0;
            case "triggers": {
                const tr = state.triggers;
                const filled = tr.creating && (tr.creating.pattern.trim() || tr.creating.replies.some(function (r) {
                    return r.trim();
                }));
                return !!filled || !!(tr.editing && triggerEdited(tr.editing));
            }
            default:
                return false;
        }
    }

    window.addEventListener("beforeunload", function (event) {
        if (state.phase === "ready" && ORDER.some(isDirty)) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    /* ---------- rendering: shell ---------- */

    function render(focusId) {
        renderGuild();

        if (state.phase === "loading") {
            nav.hidden = true;
            content.replaceChildren(skeleton());
            return;
        }
        if (state.phase === "error") {
            nav.hidden = true;
            content.replaceChildren(problemView());
            return;
        }

        renderNav();
        content.replaceChildren(PANELS[state.section]());

        if (focusId) {
            const target = document.getElementById(focusId);
            if (target) {
                target.focus();
            }
        }
    }

    function guildIcon(guild) {
        if (guild.icon) {
            return h("img", {
                class: "guild-icon guild-icon--sm",
                src: guild.icon,
                alt: "",
                width: 40,
                height: 40,
                referrerpolicy: "no-referrer"
            });
        }
        return h("span", { class: "guild-icon guild-icon--sm guild-icon--fallback", "aria-hidden": "true" }, initials(guild.name));
    }

    function renderGuild() {
        if (state.data) {
            guildBox.replaceChildren(guildIcon(state.data.guild), h("h1", { class: "dash__name" }, state.data.guild.name));
            document.title = state.data.guild.name + " · Devi";
        }
    }

    function renderNav() {
        nav.hidden = false;
        nav.replaceChildren.apply(
            nav,
            available().map(function (name) {
                return h(
                    "a",
                    {
                        class: "dash-tab",
                        href: "#" + name,
                        "aria-current": name === state.section ? "page" : null,
                        onclick: function (event) {
                            event.preventDefault();
                            go(name);
                        }
                    },
                    h("span", { class: "dash-tab__icon", "aria-hidden": "true" }, ICONS[name]),
                    h("span", null, t("sections." + name + ".name")),
                    isDirty(name) ? h("span", { class: "dash-tab__dot", "aria-hidden": "true" }) : null
                );
            })
        );

        // On phones the tabs scroll sideways: bring the active one into view (without moving the page).
        const active = nav.querySelector('[aria-current="page"]');
        if (active && nav.scrollWidth > nav.clientWidth) {
            const left = active.offsetLeft;
            const right = left + active.offsetWidth;

            if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
                nav.scrollLeft = left - (nav.clientWidth - active.offsetWidth) / 2;
            }
        }
    }

    function go(name) {
        if (name === state.section) {
            return;
        }

        state.section = name;
        try {
            window.history.replaceState(null, "", "#" + name);
        } catch (error) {
            /* the hash is only a convenience */
        }

        render();

        const title = document.getElementById("title-" + name);
        if (title) {
            title.focus({ preventScroll: true });
        }
    }

    window.addEventListener("hashchange", function () {
        const name = window.location.hash.slice(1);

        if (state.phase === "ready" && name !== state.section && available().indexOf(name) >= 0) {
            state.section = name;
            render();
        }
    });

    function skeleton() {
        return h(
            "div",
            { class: "skeleton", role: "status" },
            h("span", { class: "visually-hidden" }, t("guild.loading")),
            h("div", { class: "skeleton__block skeleton__block--title" }),
            h("div", { class: "skeleton__block" }),
            h("div", { class: "skeleton__block skeleton__block--short" })
        );
    }

    function problemView() {
        const texts = {
            forbidden: ["guild.forbidden_title", "guild.forbidden_text"],
            not_found: ["guild.not_found_title", "guild.not_found_text"]
        };
        const pair = texts[state.problem] || ["guild.unavailable_title", "guild.unavailable_text"];
        const actions = [];

        if (state.problem === "not_found") {
            actions.push(h("a", { class: "btn btn--solid", href: inviteUrl, rel: "noopener" }, t("guild.invite")));
        } else if (state.problem !== "forbidden") {
            actions.push(button(t("common.retry"), "btn--solid", load));
        }
        actions.push(h("a", { class: "btn btn--line", href: serversUrl }, t("guild.back")));

        return h("div", { class: "state" }, h("h2", null, t(pair[0])), h("p", null, t(pair[1])), h("div", { class: "state__actions" }, actions));
    }

    /* ---------- rendering: shared pieces ---------- */

    // parts: { status, body, foot, flush }
    function frame(name, parts) {
        const status = parts.status
            ? h("span", { class: "status" + (parts.status.on ? " status--on" : "") }, parts.status.text)
            : null;

        return h(
            "section",
            { class: "panel", "aria-labelledby": "title-" + name },
            h(
                "div",
                { class: "panel__head" },
                h(
                    "div",
                    null,
                    h("h2", { class: "panel__title", id: "title-" + name, tabindex: "-1" }, t("sections." + name + ".title")),
                    h("p", { class: "panel__lead" }, t("sections." + name + ".lead"))
                ),
                status
            ),
            h("div", { class: "panel__body" + (parts.flush ? " panel__body--flush" : "") }, parts.body),
            parts.foot ? h("div", { class: "panel__foot" }, parts.foot) : null
        );
    }

    // opts: { id, label, control, hint, extra }
    function field(opts) {
        return h(
            "div",
            { class: "field" },
            h("label", { class: "field__label", for: opts.id }, opts.label),
            opts.control,
            opts.hint ? h("p", { class: "field__hint", id: opts.id + "-hint" }, opts.hint) : null,
            opts.extra || null
        );
    }

    function channelText(channel, requireSend) {
        let text = (KIND_PREFIX[channel.kind] || "") + channel.name;

        if (requireSend && channel.kind === "text" && !channel.can_send) {
            text += " (" + t("channels.no_access") + ")";
        }
        return text;
    }

    // opts: { id, kinds, value, placeholder, requireSend, exclude, onchange }
    function channelSelect(opts) {
        const list = state.data.channels.filter(function (channel) {
            return opts.kinds.indexOf(channel.kind) >= 0 && !(opts.exclude && opts.exclude.has(channel.id));
        });
        const names = {};
        state.data.categories.forEach(function (category) {
            names[category.id] = category.name;
        });

        const groups = [];
        const byKey = {};
        list.forEach(function (channel) {
            const key = channel.category_id || "";

            if (!(key in byKey)) {
                byKey[key] = { key: key, items: [] };
                groups.push(byKey[key]);
            }
            byKey[key].items.push(channel);
        });

        const nodes = [h("option", { value: "", selected: opts.value === "" }, opts.placeholder)];

        // The saved channel may have been deleted since: keep it visible instead of silently dropping it.
        if (opts.value && !list.some(function (channel) {
            return channel.id === opts.value;
        })) {
            nodes.push(h("option", { value: opts.value, selected: true }, t("channels.missing", { id: opts.value })));
        }

        const flat = groups.length === 1 && groups[0].key === "";
        groups.forEach(function (group) {
            const items = group.items.map(function (channel) {
                return h("option", { value: channel.id, selected: channel.id === opts.value }, channelText(channel, opts.requireSend));
            });

            nodes.push(flat ? items : h("optgroup", { label: group.key ? names[group.key] || "" : t("channels.no_category") }, items));
        });

        return h(
            "div",
            { class: "select-wrap" },
            h("select", {
                class: "select",
                id: opts.id,
                onchange: function (event) {
                    opts.onchange(event.target.value);
                }
            }, nodes)
        );
    }

    function categorySelect(opts) {
        const nodes = [h("option", { value: "", selected: opts.value === "" }, opts.placeholder)];

        if (opts.value && !state.data.categories.some(function (category) {
            return category.id === opts.value;
        })) {
            nodes.push(h("option", { value: opts.value, selected: true }, t("channels.missing", { id: opts.value })));
        }
        state.data.categories.forEach(function (category) {
            nodes.push(h("option", { value: category.id, selected: category.id === opts.value }, category.name));
        });

        return h(
            "div",
            { class: "select-wrap" },
            h("select", {
                class: "select",
                id: opts.id,
                disabled: !!opts.disabled,
                onchange: function (event) {
                    opts.onchange(event.target.value);
                }
            }, nodes)
        );
    }

    /* ---------- panel: log channel and birthday channel ---------- */

    const CHANNEL_PANELS = {
        logs: { path: "/log-channel", label: "logs.label", off: "logs.off", hint: "logs.hint" },
        birthdays: { path: "/birthday-channel", label: "birthdays.label", off: "birthdays.off", hint: "birthdays.hint" }
    };

    function channelPanel(name) {
        const cfg = CHANNEL_PANELS[name];
        const form = state[name];
        const saved = settings(name).channel_id || "";
        const busy = !!state.busy[name];
        const id = "field-" + name;

        const warning = h("div", { class: "note note--warn", role: "note" }, t("channels.cant_send"));
        const save = button(busy ? t("common.saving") : t("common.save"), "btn--solid", function () {
            saveChannel(name);
        });
        const discard = button(t("common.discard"), "btn--line", function () {
            form.value = saved;
            render();
        });

        // Selecting only touches the buttons and the warning, so the select keeps keyboard focus.
        function sync() {
            const chosen = channelById(form.value);
            const changed = form.value !== saved;

            warning.hidden = !(chosen && chosen.kind === "text" && !chosen.can_send);
            save.disabled = !changed || busy;
            discard.disabled = !changed || busy;
            renderNav();
        }

        const select = channelSelect({
            id: id,
            kinds: ["text"],
            value: form.value,
            placeholder: t(cfg.off),
            requireSend: true,
            onchange: function (value) {
                form.value = value;
                sync();
            }
        });

        const hintParams = name === "birthdays" ? { hour: settings("birthdays").hour_utc } : {};
        const view = frame(name, {
            status: { on: !!saved, text: saved ? t("common.status_on") : t("common.status_off") },
            body: [field({ id: id, label: t(cfg.label), control: select, hint: t(cfg.hint, hintParams) }), warning],
            foot: [save, discard]
        });

        sync();
        return view;
    }

    async function saveChannel(name) {
        if (state.busy[name]) {
            return;
        }

        const form = state[name];
        state.busy[name] = true;
        render();

        try {
            const result = await api("PUT", CHANNEL_PANELS[name].path, { channel_id: form.value || null });

            settings(name).channel_id = result.channel_id;
            form.value = result.channel_id || "";
            toast("ok", form.value ? t("common.saved") : t("common.turned_off"));
        } catch (error) {
            fail(error);
        } finally {
            state.busy[name] = false;
            render();
        }
    }

    /* ---------- panel: temporary voice channels ---------- */

    function voiceDraft(voice) {
        return {
            lobby: voice.lobby_channel_id || "",
            category: voice.category_id || "",
            template: voice.name_template || ""
        };
    }

    function voiceDirty() {
        const saved = settings("voice");
        const form = state.voice;

        if (form.lobby !== (saved.lobby_channel_id || "")) {
            return true;
        }
        // Category and name only matter while a lobby is set.
        return form.lobby !== "" && (
            form.category !== (saved.category_id || "") ||
            form.template.trim() !== (saved.name_template || "").trim()
        );
    }

    function voicePanel() {
        const saved = settings("voice");
        const form = state.voice;
        const busy = !!state.busy.voice;
        const limits = state.data.limits;

        const botNote = h("div", { class: "note note--warn", role: "note" }, t("voice.bot_perms"));
        const preview = h("p", { class: "field__preview" });
        const save = button(busy ? t("common.saving") : t("common.save"), "btn--solid", saveVoice);
        const discard = button(t("common.discard"), "btn--line", function () {
            state.voice = voiceDraft(saved);
            render();
        });

        const category = categorySelect({
            id: "field-category",
            value: form.category,
            placeholder: t("voice.category_same"),
            disabled: !form.lobby,
            onchange: function (value) {
                form.category = value;
                sync();
            }
        });

        const template = h("input", {
            class: "input mono",
            type: "text",
            id: "field-template",
            value: form.template,
            placeholder: saved.default_name_template,
            maxlength: limits.max_name_template,
            autocomplete: "off",
            spellcheck: "false",
            disabled: !form.lobby,
            "aria-describedby": "field-template-hint",
            oninput: function (event) {
                form.template = event.target.value;
                sync();
            }
        });

        function sync() {
            const changed = voiceDirty();
            const name = (form.template.trim() || saved.default_name_template)
                .replace(/\[user\]|\{user\}/gi, t("voice.sample_name"))
                .slice(0, 100);
            const parts = t("voice.preview", { name: "\u0001" }).split("\u0001");

            category.querySelector("select").disabled = !form.lobby;
            template.disabled = !form.lobby;
            botNote.hidden = !form.lobby || saved.bot_can_manage;
            preview.hidden = !form.lobby;
            preview.replaceChildren(parts[0], h("b", null, name), parts[1] || "");
            save.disabled = !changed || busy;
            discard.disabled = !changed || busy;
            renderNav();
        }

        const lobby = channelSelect({
            id: "field-lobby",
            kinds: ["voice"],
            value: form.lobby,
            placeholder: t("voice.lobby_none"),
            onchange: function (value) {
                form.lobby = value;
                render("field-lobby");
            }
        });

        const view = frame("voice", {
            status: { on: !!saved.lobby_channel_id, text: saved.lobby_channel_id ? t("common.status_on") : t("common.status_off") },
            body: [
                field({ id: "field-lobby", label: t("voice.lobby_label"), control: lobby, hint: t("voice.lobby_hint") }),
                field({ id: "field-category", label: t("voice.category_label"), control: category }),
                field({ id: "field-template", label: t("voice.template_label"), control: template, hint: t("voice.template_hint"), extra: preview }),
                botNote
            ],
            foot: [save, discard]
        });

        sync();
        return view;
    }

    async function saveVoice() {
        if (state.busy.voice) {
            return;
        }

        const form = state.voice;
        state.busy.voice = true;
        render();

        try {
            const result = await api("PUT", "/temp-voice", {
                lobby_channel_id: form.lobby || null,
                category_id: form.category || null,
                name_template: form.template.trim() || null
            });

            state.data.settings.voice = result;
            state.voice = voiceDraft(result);
            toast("ok", result.lobby_channel_id ? t("common.saved") : t("common.turned_off"));
        } catch (error) {
            fail(error);
        } finally {
            state.busy.voice = false;
            render();
        }
    }

    /* ---------- panel: permissions ---------- */

    function entryKey(scope, id) {
        return scope + ":" + id;
    }

    function buildPerms(snapshot, previous) {
        const guildId = state.data.guild.id;
        const entries = new Map();

        function put(scope, id, mask, meta) {
            const key = entryKey(scope, id);
            const before = previous && previous.entries.get(key);
            const merged = Object.assign({}, meta || {});

            // The bot only knows names of cached members; keep the one we got from the search.
            if (before && before.meta.name && !merged.name) {
                merged.name = before.meta.name;
                merged.username = before.meta.username;
                merged.avatar = merged.avatar || before.meta.avatar;
            }
            entries.set(key, { scope: scope, id: id, base: mask, mask: mask, meta: merged, added: false });
        }

        put("guild", guildId, snapshot.guild);
        Object.keys(snapshot.roles).forEach(function (id) {
            put("role", id, snapshot.roles[id]);
        });
        Object.keys(snapshot.channels).forEach(function (id) {
            put("channel", id, snapshot.channels[id]);
        });
        snapshot.users.forEach(function (user) {
            put("user", user.id, user.mask, { name: user.name, username: user.username, avatar: user.avatar });
        });

        return {
            entries: entries,
            selected: previous && entries.has(previous.selected) ? previous.selected : entryKey("guild", guildId),
            find: { query: "", results: null, seq: 0 }
        };
    }

    function flagValue(name) {
        const flag = state.data.permission_flags.find(function (item) {
            return item.name === name;
        });
        return flag ? flag.value : 0;
    }

    function isAdmin(mask) {
        const admin = flagValue("Admin");
        return (mask & admin) === admin;
    }

    function countFlags(mask) {
        return state.data.permission_flags.filter(function (flag) {
            return flag.kind !== "admin" && (mask & flag.value) === flag.value;
        }).length;
    }

    function dirtyEntries() {
        return Array.from(state.perms.entries.values()).filter(function (entry) {
            return entry.mask !== entry.base;
        });
    }

    // Entries shown in the list: saved ones, plus those added during this visit.
    function listed(scope) {
        const order = {};
        const source = scope === "role" ? state.data.roles : scope === "channel" ? state.data.channels : [];
        source.forEach(function (item, index) {
            order[item.id] = index;
        });

        return Array.from(state.perms.entries.values())
            .filter(function (entry) {
                return entry.scope === scope && (entry.base !== 0 || entry.mask !== 0 || entry.added);
            })
            .sort(function (a, b) {
                if (scope === "user") {
                    return String(a.meta.name || a.id).localeCompare(String(b.meta.name || b.id));
                }
                const left = a.id in order ? order[a.id] : Infinity;
                const right = b.id in order ? order[b.id] : Infinity;
                return left === right ? 0 : left - right;
            });
    }

    function entryName(entry) {
        if (entry.scope === "guild") {
            return t("permissions.guild_name");
        }
        if (entry.scope === "role") {
            const role = roleById(entry.id);
            return role ? role.name : null;
        }
        if (entry.scope === "channel") {
            const channel = channelById(entry.id);
            return channel ? channel.name : null;
        }
        return entry.meta.name || entry.meta.username || null;
    }

    function entryIcon(entry) {
        if (entry.scope === "guild") {
            return h("span", { class: "target__icon", "aria-hidden": "true" }, "🌐");
        }
        if (entry.scope === "role") {
            const role = roleById(entry.id);
            return h("span", { class: "role-dot", "aria-hidden": "true", style: role && role.color ? { "--dot": role.color } : null });
        }
        if (entry.scope === "channel") {
            const channel = channelById(entry.id);
            return h("span", { class: "target__icon", "aria-hidden": "true" }, channel ? (KIND_PREFIX[channel.kind] || "# ").trim() : "#");
        }
        return entry.meta.avatar
            ? h("img", { class: "avatar-xs", src: entry.meta.avatar, alt: "", width: 22, height: 22, referrerpolicy: "no-referrer" })
            : h("span", { class: "target__icon", "aria-hidden": "true" }, "👤");
    }

    function entrySummary(entry) {
        if (entry.mask === 0) {
            return t("permissions.summary_none");
        }
        if (isAdmin(entry.mask)) {
            return t("permissions.summary_full");
        }
        return t("permissions.summary_count", { count: countFlags(entry.mask) });
    }

    function addEntry(scope, id, meta) {
        const key = entryKey(scope, id);

        if (!state.perms.entries.has(key)) {
            state.perms.entries.set(key, { scope: scope, id: id, base: 0, mask: 0, meta: meta || {}, added: true });
        }
        state.perms.selected = key;
        state.perms.find = { query: "", results: null, seq: state.perms.find.seq + 1 };
        render();
    }

    function targetRow(entry) {
        const key = entryKey(entry.scope, entry.id);
        const name = entryName(entry);

        return h(
            "button",
            {
                class: "target",
                type: "button",
                "aria-pressed": key === state.perms.selected ? "true" : "false",
                onclick: function () {
                    state.perms.selected = key;
                    render();
                }
            },
            entryIcon(entry),
            h(
                "span",
                { class: "target__text" },
                h("span", { class: "target__name" }, name !== null ? name : h("code", null, entry.id)),
                h("span", { class: "target__sum" }, entrySummary(entry))
            ),
            entry.mask !== entry.base ? h("span", { class: "target__dot", "aria-hidden": "true" }) : null
        );
    }

    function targetGroup(scope, adder) {
        const rows = listed(scope);

        return h(
            "div",
            { class: "targets__group" },
            h("p", { class: "targets__title" }, t("permissions.scope." + scope)),
            rows.length ? rows.map(targetRow) : h("p", { class: "targets__empty" }, t("permissions.empty_group")),
            adder
        );
    }

    function roleAdder() {
        const taken = new Set(listed("role").map(function (entry) {
            return entry.id;
        }));
        const free = state.data.roles.filter(function (role) {
            return !taken.has(role.id);
        });

        if (!free.length) {
            return null;
        }

        return h(
            "div",
            { class: "select-wrap targets__add" },
            h(
                "select",
                {
                    class: "select",
                    "aria-label": t("permissions.add_role"),
                    onchange: function (event) {
                        if (event.target.value) {
                            addEntry("role", event.target.value);
                        }
                    }
                },
                h("option", { value: "", selected: true }, t("permissions.add_role")),
                free.map(function (role) {
                    return h("option", { value: role.id }, role.name);
                })
            )
        );
    }

    function channelAdder() {
        const taken = new Set(listed("channel").map(function (entry) {
            return entry.id;
        }));

        return h(
            "div",
            { class: "targets__add" },
            channelSelect({
                id: "add-channel",
                kinds: ["text", "voice", "stage", "forum"],
                value: "",
                placeholder: t("permissions.add_channel"),
                exclude: taken,
                onchange: function (value) {
                    if (value) {
                        addEntry("channel", value);
                    }
                }
            })
        );
    }

    /* member search */

    function searchHint() {
        const query = state.perms.find.query.trim();

        if (!query) {
            return false;
        }
        // One typed character: explain why nothing happens yet. Otherwise wait for the answer.
        return query.length < 2 || state.perms.find.results !== null;
    }

    function resultItems() {
        const find = state.perms.find;
        const query = find.query.trim();

        if (query.length < 2) {
            return h("li", { class: "results__note" }, t("permissions.find_min"));
        }
        if (!find.results || !find.results.length) {
            return h("li", { class: "results__note" }, t("permissions.find_none"));
        }

        return find.results.map(function (member) {
            return h(
                "li",
                null,
                h(
                    "button",
                    {
                        class: "result",
                        type: "button",
                        onclick: function () {
                            addEntry("user", member.id, { name: member.name, username: member.username, avatar: member.avatar });
                        }
                    },
                    member.avatar ? h("img", { class: "avatar-xs", src: member.avatar, alt: "", width: 22, height: 22, referrerpolicy: "no-referrer" }) : null,
                    h("span", null, member.name),
                    h("span", { class: "result__sub" }, "@" + member.username)
                )
            );
        });
    }

    function updateResults() {
        const box = document.getElementById("member-results");

        if (box && state.perms) {
            box.hidden = !searchHint();
            box.replaceChildren.apply(box, [].concat(resultItems()));
        }
    }

    const runSearch = debounce(async function () {
        const find = state.perms && state.perms.find;

        if (!find) {
            return;
        }

        const query = find.query.trim();
        if (query.length < 2) {
            find.results = null;
            updateResults();
            return;
        }

        const ticket = ++find.seq;
        try {
            const answer = await api("GET", "/members?q=" + encodeURIComponent(query));

            if (ticket !== find.seq) {
                return;
            }
            find.results = answer.members;
        } catch (error) {
            if (ticket !== find.seq) {
                return;
            }
            find.results = [];
            if (error.code === "unauthenticated") {
                fail(error);
            }
        }

        updateResults();
    }, 250);

    function memberAdder() {
        const find = state.perms.find;

        return h(
            "div",
            { class: "search targets__add" },
            h("input", {
                class: "input",
                type: "search",
                id: "member-search",
                value: find.query,
                placeholder: t("permissions.find_placeholder"),
                autocomplete: "off",
                "aria-label": t("permissions.find_member"),
                "aria-controls": "member-results",
                oninput: function (event) {
                    find.query = event.target.value;
                    find.results = null;
                    updateResults();
                    runSearch();
                },
                onkeydown: function (event) {
                    if (event.key === "Escape") {
                        find.query = "";
                        find.results = null;
                        render("member-search");
                    }
                }
            }),
            h("ul", { class: "results", id: "member-results", hidden: !searchHint() }, resultItems())
        );
    }

    /* editor */

    function toggleFlag(entry, flag, on) {
        // "All permissions" is the combination of every allowed action, exactly like the bot's own panel.
        const bits = flag.kind === "admin" ? flagValue("Admin") : flag.value;

        entry.mask = on ? entry.mask | bits : entry.mask & ~bits;
        render("perm-" + flag.name);
    }

    function permRow(entry, flag) {
        const id = "perm-" + flag.name;
        const checked = flag.kind === "admin" ? isAdmin(entry.mask) : (entry.mask & flag.value) === flag.value;
        const input = h("input", {
            type: "checkbox",
            id: id,
            checked: checked,
            onchange: function () {
                toggleFlag(entry, flag, input.checked);
            }
        });

        return h(
            "label",
            { class: "perm", for: id },
            h("span", { class: "switch" }, input),
            h(
                "span",
                { class: "perm__text" },
                h(
                    "span",
                    { class: "perm__label" },
                    t("permissions.flag." + flag.name + ".label"),
                    h("span", { class: "perm__code" }, "bot." + flag.name)
                ),
                h("span", { class: "perm__desc" }, t("permissions.flag." + flag.name + ".desc"))
            )
        );
    }

    function editor(entry) {
        const name = entryName(entry);
        const groups = [
            ["admin", "permissions.group_full"],
            ["allow", "permissions.group_allow"],
            ["restrict", "permissions.group_restrict"]
        ].map(function (pair) {
            const flags = state.data.permission_flags.filter(function (flag) {
                return flag.kind === pair[0];
            });

            return flags.length
                ? h("div", { class: "perm-group" }, h("p", { class: "perm-group__title" }, t(pair[1])), flags.map(function (flag) {
                    return permRow(entry, flag);
                }))
                : null;
        });

        return h(
            "div",
            { class: "editor" },
            h(
                "div",
                { class: "editor__head" },
                h("div", { class: "editor__title" }, entryIcon(entry), h("span", null, name !== null ? name : h("code", null, entry.id))),
                h("p", { class: "editor__hint" }, t("permissions.scope_hint." + entry.scope))
            ),
            groups,
            entry.mask !== 0
                ? h("div", null, button(t("permissions.clear"), "btn--line btn--sm", function () {
                    entry.mask = 0;
                    render();
                }))
                : null
        );
    }

    function saveBar() {
        const count = dirtyEntries().length;

        if (!count) {
            return null;
        }

        const busy = !!state.busy.permissions;
        return h(
            "div",
            { class: "savebar", role: "group" },
            h("span", { class: "savebar__text" }, t("common.unsaved", { count: count })),
            h(
                "div",
                { class: "savebar__actions" },
                button(t("common.discard"), "btn--line btn--sm", discardPerms, busy),
                button(busy ? t("common.saving") : t("common.save"), "btn--solid btn--sm", savePerms, busy)
            )
        );
    }

    function discardPerms() {
        const perms = state.perms;

        perms.entries.forEach(function (entry, key) {
            entry.mask = entry.base;
            if (entry.added && entry.base === 0) {
                perms.entries.delete(key);
            }
        });
        if (!perms.entries.has(perms.selected)) {
            perms.selected = entryKey("guild", state.data.guild.id);
        }
        render();
    }

    async function savePerms() {
        const perms = state.perms;
        const changes = dirtyEntries().map(function (entry) {
            return entry.scope === "guild"
                ? { scope: "guild", mask: entry.mask }
                : { scope: entry.scope, id: entry.id, mask: entry.mask };
        });

        if (!changes.length || state.busy.permissions) {
            return;
        }

        state.busy.permissions = true;
        render();

        try {
            let latest = null;

            // The bot takes at most 25 changes per request; every batch is applied all-or-nothing.
            for (let start = 0; start < changes.length; start += 25) {
                const batch = changes.slice(start, start + 25);

                latest = await api("PATCH", "/permissions", { changes: batch });
                batch.forEach(function (change) {
                    const entry = perms.entries.get(entryKey(change.scope, change.id || state.data.guild.id));

                    if (entry) {
                        entry.base = change.mask;
                    }
                });
            }

            state.data.settings.permissions = latest;
            state.perms = buildPerms(latest, perms);
            toast("ok", t("common.saved"));
        } catch (error) {
            fail(error);
        } finally {
            state.busy.permissions = false;
            render();
        }
    }

    function permissionsPanel() {
        const perms = state.perms;
        const selected = perms.entries.get(perms.selected);

        const targets = h(
            "div",
            { class: "targets" },
            h("div", { class: "targets__group" }, targetRow(perms.entries.get(entryKey("guild", state.data.guild.id)))),
            targetGroup("role", roleAdder()),
            targetGroup("channel", channelAdder()),
            targetGroup("user", memberAdder())
        );

        return h(
            "div",
            null,
            frame("permissions", {
                flush: true,
                body: h("div", { class: "perms" }, targets, selected ? editor(selected) : h("p", { class: "editor__empty" }, t("permissions.pick_hint")))
            }),
            saveBar()
        );
    }

    /* ---------- panel: triggers ---------- */

    // Which field of the trigger form an error code belongs to.
    const FIELD_OF = {
        empty_pattern: "pattern",
        pattern_too_long: "pattern",
        invalid_regex: "pattern",
        trigger_exists: "pattern",
        no_responses: "replies",
        empty_response: "replies",
        response_too_long: "replies",
        too_many_responses: "replies",
        duplicate_response: "replies"
    };

    function newDraft(original, pattern, replies) {
        return { original: original, pattern: pattern, replies: replies, error: null, busy: false };
    }

    function triggerEdited(draft) {
        const saved = settings("triggers").find(function (item) {
            return item.pattern === draft.original;
        });

        return !!saved && (
            draft.pattern !== saved.pattern ||
            draft.replies.length !== saved.responses.length ||
            draft.replies.some(function (reply, index) {
                return reply !== saved.responses[index];
            })
        );
    }

    function startCreate() {
        state.triggers.creating = newDraft(null, "", [""]);
        state.triggers.editing = null;
        render("tf-new-pattern");
    }

    function startEdit(item) {
        state.triggers.editing = newDraft(item.pattern, item.pattern, item.responses.slice());
        state.triggers.creating = null;
        render("tf-edit-pattern");
    }

    function cancelDraft(draft) {
        if (draft.original === null) {
            state.triggers.creating = null;
        } else {
            state.triggers.editing = null;
        }
        render();
    }

    async function submitTrigger(draft) {
        const isNew = draft.original === null;
        const uid = isNew ? "new" : "edit";
        const pattern = draft.pattern.trim();
        const replies = draft.replies.map(function (reply) {
            return reply.trim();
        }).filter(Boolean);

        if (draft.busy) {
            return;
        }

        draft.error = null;
        if (!pattern) {
            draft.error = { field: "pattern", message: t("errors.empty_pattern") };
        } else if (!replies.length) {
            draft.error = { field: "replies", message: t("errors.no_responses") };
        } else if (new Set(replies).size !== replies.length) {
            draft.error = { field: "replies", message: t("errors.duplicate_response") };
        }
        if (draft.error) {
            render(draft.error.field === "pattern" ? "tf-" + uid + "-pattern" : "tf-" + uid + "-reply-0");
            return;
        }

        draft.busy = true;
        render();

        try {
            const body = isNew ? { pattern: pattern, responses: replies } : { pattern: draft.original, responses: replies };

            if (!isNew && pattern !== draft.original) {
                body.new_pattern = pattern;
            }

            const result = await api(isNew ? "POST" : "PUT", "/triggers", body);

            state.data.settings.triggers = result.triggers;
            state.triggers[isNew ? "creating" : "editing"] = null;
            toast("ok", isNew ? t("triggers.created") : t("common.saved"));
            render();
        } catch (error) {
            draft.busy = false;

            const field = FIELD_OF[error.code];
            if (field) {
                draft.error = { field: field, message: errorMessage(error) };
                render(field === "pattern" ? "tf-" + uid + "-pattern" : null);
            } else {
                fail(error);
                render();
            }
        }
    }

    async function removeTrigger(item) {
        const tr = state.triggers;

        if (tr.removing[item.pattern]) {
            return;
        }
        tr.removing[item.pattern] = true;

        try {
            const result = await api("POST", "/triggers/delete", { pattern: item.pattern });

            state.data.settings.triggers = result.triggers;
            if (tr.editing && tr.editing.original === item.pattern) {
                tr.editing = null;
            }
            toast("ok", t("common.deleted"));
        } catch (error) {
            fail(error);
        } finally {
            delete tr.removing[item.pattern];
            render();
        }
    }

    function triggerForm(draft) {
        const limits = state.data.limits;
        const isNew = draft.original === null;
        const uid = isNew ? "new" : "edit";
        const patternError = draft.error && draft.error.field === "pattern" ? draft.error.message : null;
        const repliesError = draft.error && draft.error.field === "replies" ? draft.error.message : null;

        const pattern = h("input", {
            class: "input mono",
            type: "text",
            id: "tf-" + uid + "-pattern",
            value: draft.pattern,
            placeholder: t("triggers.pattern_placeholder"),
            maxlength: limits.max_pattern,
            autocomplete: "off",
            spellcheck: "false",
            "aria-invalid": patternError ? "true" : null,
            "aria-describedby": "tf-" + uid + "-pattern-hint",
            oninput: function (event) {
                draft.pattern = event.target.value;
            }
        });

        const replies = draft.replies.map(function (text, index) {
            return h(
                "div",
                { class: "reply" },
                h("textarea", {
                    class: "textarea",
                    id: "tf-" + uid + "-reply-" + index,
                    rows: 2,
                    maxlength: limits.max_response,
                    value: text,
                    placeholder: t("triggers.reply_placeholder"),
                    "aria-label": t("triggers.reply_n", { n: index + 1 }),
                    "aria-invalid": repliesError ? "true" : null,
                    oninput: function (event) {
                        draft.replies[index] = event.target.value;
                    }
                }),
                draft.replies.length > 1
                    ? h("button", {
                        class: "icon-btn",
                        type: "button",
                        title: t("triggers.remove_reply"),
                        "aria-label": t("triggers.remove_reply") + " " + (index + 1),
                        onclick: function () {
                            draft.replies.splice(index, 1);
                            render();
                        }
                    }, "×")
                    : null
            );
        });

        return h(
            "form",
            {
                class: "trigger-form",
                novalidate: true,
                onsubmit: function (event) {
                    event.preventDefault();
                    submitTrigger(draft);
                }
            },
            h(
                "div",
                { class: "field" },
                h("label", { class: "field__label", for: "tf-" + uid + "-pattern" }, t("triggers.pattern")),
                pattern,
                h("p", { class: "field__hint", id: "tf-" + uid + "-pattern-hint" }, t("triggers.pattern_hint")),
                patternError ? h("p", { class: "field__error", role: "alert" }, patternError) : null
            ),
            h(
                "div",
                { class: "field" },
                h("span", { class: "field__label" }, t("triggers.replies")),
                h("p", { class: "field__hint" }, t("triggers.replies_hint")),
                h("div", { class: "replies" }, replies),
                repliesError ? h("p", { class: "field__error", role: "alert" }, repliesError) : null,
                draft.replies.length < limits.max_responses
                    ? h("div", null, button(t("triggers.add_reply"), "btn--line btn--sm", function () {
                        draft.replies.push("");
                        render("tf-" + uid + "-reply-" + (draft.replies.length - 1));
                    }))
                    : null
            ),
            h(
                "div",
                { class: "trigger-form__actions" },
                h("button", { class: "btn btn--solid", type: "submit", disabled: draft.busy }, draft.busy ? t("common.saving") : isNew ? t("triggers.create") : t("common.save")),
                button(t("common.cancel"), "btn--line", function () {
                    cancelDraft(draft);
                }, draft.busy)
            )
        );
    }

    function triggerCard(item) {
        const editing = state.triggers.editing;

        if (editing && editing.original === item.pattern) {
            return h("li", { class: "trigger trigger--editing" }, triggerForm(editing));
        }

        // Deleting asks for a second click on the same button; it disarms itself after a few seconds.
        const remove = button(t("common.delete"), "btn--danger btn--sm", null);
        remove.addEventListener("click", function () {
            if (remove.classList.contains("is-armed")) {
                removeTrigger(item);
                return;
            }
            remove.classList.add("is-armed");
            remove.textContent = t("triggers.confirm_delete");
            setTimeout(function () {
                remove.classList.remove("is-armed");
                remove.textContent = t("common.delete");
            }, 4000);
        });

        return h(
            "li",
            { class: "trigger" },
            h(
                "div",
                { class: "trigger__row" },
                h(
                    "div",
                    { class: "trigger__top" },
                    h("code", { class: "pattern mono" }, item.pattern),
                    h("div", { class: "trigger__actions" }, button(t("common.edit"), "btn--line btn--sm", function () {
                        startEdit(item);
                    }), remove)
                ),
                h("p", { class: "trigger__preview" }, item.responses[0]),
                h("span", { class: "trigger__meta" }, t("triggers.reply_count", { count: item.responses.length }))
            )
        );
    }

    function triggersPanel() {
        const tr = state.triggers;
        const limits = state.data.limits;
        const all = settings("triggers");
        const list = h("ul", { class: "trigger-list", id: "trigger-list" });

        // Filtering only rebuilds the list, so the search box keeps focus and caret.
        function fillList() {
            const query = tr.query.trim().toLowerCase();
            const shown = query
                ? all.filter(function (item) {
                    return item.pattern.toLowerCase().indexOf(query) >= 0 || item.responses.some(function (reply) {
                        return reply.toLowerCase().indexOf(query) >= 0;
                    });
                })
                : all;
            const items = [];

            if (tr.creating) {
                items.push(h("li", { class: "trigger trigger--new" }, triggerForm(tr.creating)));
            }
            shown.forEach(function (item) {
                items.push(triggerCard(item));
            });

            list.replaceChildren.apply(list, items);
            empty.hidden = !!(items.length || tr.creating);
            empty.replaceChildren(
                h("p", { class: "empty__title" }, all.length ? t("triggers.no_match") : t("triggers.empty_title")),
                all.length ? null : h("p", null, t("triggers.empty_text"))
            );
        }

        const empty = h("div", { class: "empty" });
        const search = h("input", {
            class: "input toolbar__search",
            type: "search",
            id: "trigger-search",
            value: tr.query,
            placeholder: t("triggers.search"),
            "aria-label": t("triggers.search"),
            oninput: function (event) {
                tr.query = event.target.value;
                fillList();
            }
        });

        const toolbar = h(
            "div",
            { class: "toolbar" },
            search,
            h("span", { class: "toolbar__count" }, t("triggers.count", { count: all.length, max: limits.max_triggers })),
            button(t("triggers.new"), "btn--solid btn--sm", startCreate, !!tr.creating || all.length >= limits.max_triggers)
        );

        const view = frame("triggers", { body: [toolbar, list, empty] });
        fillList();
        return view;
    }

    const PANELS = {
        permissions: permissionsPanel,
        birthdays: function () {
            return channelPanel("birthdays");
        },
        logs: function () {
            return channelPanel("logs");
        },
        voice: voicePanel,
        triggers: triggersPanel
    };

    /* ---------- start ---------- */

    // main.js switches the language without reloading and only touches static text;
    // everything this file draws is rebuilt here.
    new MutationObserver(function () {
        const next = html.getAttribute("data-lang");

        if (next && next !== lang) {
            lang = next;
            render();
        }
    }).observe(html, { attributes: true, attributeFilter: ["data-lang"] });

    load();
})();
