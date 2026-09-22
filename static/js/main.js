/* =========================================================
   Devi — landing page behaviour
   1. theme switch (stored in localStorage)
   2. language switch without a page reload
   3. command search and group filter
   4. one hero animation on load
   ========================================================= */

(function () {
    "use strict";

    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- translations shipped with the page ---------- */

    let catalogs = {};
    const dataNode = document.getElementById("i18n-data");

    if (dataNode) {
        try {
            catalogs = JSON.parse(dataNode.textContent);
        } catch (e) {
            catalogs = {};
        }
    }

    const defaultLang = Object.keys(catalogs)[0] || "en";
    let currentLang = root.getAttribute("data-lang") || defaultLang;
    const params = {
        count: Number(document.body.getAttribute("data-command-count") || 0)
    };

    function lookup(lang, key) {
        let node = catalogs[lang];
        const parts = key.split(".");

        for (let i = 0; i < parts.length; i++) {
            if (!node || typeof node !== "object" || !(parts[i] in node)) {
                return null;
            }
            node = node[parts[i]];
        }

        return typeof node === "string" ? node : null;
    }

    function t(key, extra) {
        let value = lookup(currentLang, key);

        if (value === null) {
            value = lookup(defaultLang, key);
        }
        if (value === null) {
            return key;
        }

        const merged = extra || params;

        return value.replace(/\{(\w+)\}/g, function (match, name) {
            return name in merged ? merged[name] : match;
        });
    }

    /* ---------- language switching ---------- */

    function applyLanguage(lang) {
        if (!catalogs[lang]) {
            return;
        }

        currentLang = lang;
        root.setAttribute("lang", lang);
        root.setAttribute("data-lang", lang);

        const meta = (catalogs[lang] && catalogs[lang]._meta) || {};
        root.setAttribute("dir", meta.dir || "ltr");

        document.querySelectorAll("[data-i18n]").forEach(function (node) {
            node.textContent = t(node.getAttribute("data-i18n"));
        });

        // Attributes are declared as data-i18n-attr="placeholder:key|title:key".
        document.querySelectorAll("[data-i18n-attr]").forEach(function (node) {
            node.getAttribute("data-i18n-attr")
                .split("|")
                .forEach(function (pair) {
                    const split = pair.indexOf(":");

                    if (split < 0) {
                        return;
                    }

                    node.setAttribute(
                        pair.slice(0, split).trim(),
                        t(pair.slice(split + 1).trim())
                    );
                });
        });

        const description = document.querySelector('meta[name="description"]');
        if (description) {
            description.setAttribute("content", t("site.description"));
        }

        const picker = document.getElementById("lang-picker");
        if (picker) {
            const flag = picker.querySelector(".picker__flag");
            const code = picker.querySelector(".picker__code");

            if (flag) {
                flag.textContent = meta.flag || "";
            }
            if (code) {
                code.textContent = meta.short || lang.toUpperCase();
            }

            picker.querySelectorAll(".picker__item").forEach(function (item) {
                item.classList.toggle(
                    "is-current",
                    item.getAttribute("data-lang") === lang
                );
            });

            picker.open = false;
        }

        try {
            document.cookie =
                "devi_lang=" + lang + ";path=/;max-age=31536000;samesite=Lax";
        } catch (e) {
            /* cookies can be blocked */
        }

        refreshThemeLabel();
        runFilter();
    }

    document.querySelectorAll(".picker__item").forEach(function (link) {
        link.addEventListener("click", function (event) {
            const lang = link.getAttribute("data-lang");

            if (!catalogs[lang]) {
                return; // let the browser follow the link
            }

            event.preventDefault();
            applyLanguage(lang);

            if (window.history && window.history.pushState) {
                window.history.pushState({ lang: lang }, "", link.getAttribute("href"));
            }
        });
    });

    // Close the picker when clicking outside of it.
    document.addEventListener("click", function (event) {
        const picker = document.getElementById("lang-picker");

        if (picker && picker.open && !picker.contains(event.target)) {
            picker.open = false;
        }
    });

    /* ---------- theme ---------- */

    const themeToggle = document.getElementById("theme-toggle");

    function currentTheme() {
        const set = root.getAttribute("data-theme");

        if (set) {
            return set;
        }

        return window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
    }

    function refreshThemeLabel() {
        if (!themeToggle) {
            return;
        }

        const light = currentTheme() === "light";
        const label = light ? t("nav.to_dark") : t("nav.to_light");

        themeToggle.setAttribute("title", label);
        themeToggle.setAttribute("aria-label", label);
        themeToggle.setAttribute("aria-pressed", light ? "true" : "false");
    }

    if (themeToggle) {
        themeToggle.addEventListener("click", function () {
            const next = currentTheme() === "light" ? "dark" : "light";

            root.setAttribute("data-theme", next);

            try {
                localStorage.setItem("devi-theme", next);
            } catch (e) {
                /* storage can be unavailable */
            }

            refreshThemeLabel();
        });

        refreshThemeLabel();
    }

    /* ---------- command search and filter ---------- */

    const search = document.getElementById("cmd-search");
    const counter = document.getElementById("cmd-count");
    const empty = document.getElementById("cmd-empty");
    const groups = Array.prototype.slice.call(document.querySelectorAll(".cmd-group"));
    const chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
    let activeGroup = "all";

    function normalize(value) {
        return value
            .toLowerCase()
            .replace(/^\//, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function runFilter() {
        if (!groups.length) {
            return;
        }

        const query = normalize(search ? search.value : "");
        let shown = 0;

        groups.forEach(function (group) {
            const id = group.getAttribute("data-group");
            const groupTitle = normalize(group.querySelector(".cmd-group__title").textContent);
            let inGroup = 0;

            group.querySelectorAll(".cmd").forEach(function (item) {
                const name = normalize(item.getAttribute("data-name") || "");
                const desc = normalize(item.querySelector(".cmd__desc").textContent);
                const matchesGroup = activeGroup === "all" || activeGroup === id;
                const matchesQuery =
                    !query ||
                    name.indexOf(query) >= 0 ||
                    desc.indexOf(query) >= 0 ||
                    groupTitle.indexOf(query) >= 0;
                const visible = matchesGroup && matchesQuery;

                item.hidden = !visible;

                if (visible) {
                    inGroup += 1;
                }
            });

            group.hidden = inGroup === 0;
            shown += inGroup;
        });

        if (empty) {
            empty.hidden = shown !== 0;
        }
        if (counter) {
            counter.textContent = shown ? t("commands.found", { count: shown }) : "";
        }
    }

    if (search) {
        search.addEventListener("input", runFilter);
        search.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                search.value = "";
                runFilter();
            }
        });
    }

    chips.forEach(function (chip) {
        chip.addEventListener("click", function () {
            activeGroup = chip.getAttribute("data-filter");

            chips.forEach(function (other) {
                const active = other === chip;

                other.classList.toggle("is-active", active);
                other.setAttribute("aria-pressed", active ? "true" : "false");
            });

            runFilter();
        });
    });

    runFilter();

    /* ---------- hero: one typing sequence on load ---------- */

    const typed = document.getElementById("demo-typed");
    const caret = document.getElementById("demo-caret");
    const suggest = document.getElementById("demo-suggest");
    const message = document.getElementById("demo-msg");
    const placeholder = document.getElementById("demo-placeholder");

    function showResult() {
        if (typed) {
            typed.textContent = "";
        }
        if (caret) {
            caret.classList.remove("is-shown");
        }
        if (suggest) {
            suggest.classList.remove("is-shown");
        }
        if (placeholder) {
            placeholder.classList.remove("is-hidden");
        }
        if (message) {
            message.classList.add("is-shown");
        }
    }

    function playIntro() {
        if (!typed || !message) {
            return;
        }

        const text = t("hero.demo_command");
        let index = 0;

        if (caret) {
            caret.classList.add("is-shown");
        }
        if (placeholder) {
            placeholder.classList.add("is-hidden");
        }

        function step() {
            typed.textContent = text.slice(0, index);

            if (index === 1 && suggest) {
                suggest.classList.add("is-shown");
            }

            index += 1;

            if (index <= text.length) {
                window.setTimeout(step, 65);
            } else {
                window.setTimeout(showResult, 750);
            }
        }

        window.setTimeout(step, 550);
    }

    if (reduceMotion) {
        showResult();
    } else {
        playIntro();
    }
})();