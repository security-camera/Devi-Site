"""Static catalogue of the bot's slash commands.

Only structure lives here: group ids, icons and command ids/names.
Every human-readable string is stored in locales/<lang>.json, so adding a
language never means touching this file.
"""

from __future__ import annotations
import os
from i18n import LOCALES_DIR, t

# Public links shown across the site.
LINKS = {
    "invite": "https://discord.com/oauth2/authorize?client_id=1230603137253900339",
    "support": "https://discord.gg/ftUm7FbJDw",
    "topgg": "https://top.gg/bot/1230603137253900339",
    "reviews": "https://top.gg/bot/1230603137253900339#reviews",
    "tos": "https://gist.github.com/security-camera/147e20418f9528e2e64d5e9e87c40977",
    "privacy": "https://gist.github.com/security-camera/c1c4ffc74fb2407b06044e4ab8607e71",
    "topgg-server": "https://top.gg/discord/servers/896841550260490240",
    "reviews-server": "https://top.gg/discord/servers/896841550260490240#reviews",
    "github": "https://github.com/security-camera/Devi-Discord-Bot",
    "github-site": "https://github.com/security-camera/Devi-Site",
    "tiktok": "https://www.tiktok.com/@devi_discord"
}

# Each group: id -> icon + ordered commands.
# Command id is the translation key (locales -> "cmd.<id>"), name is what the
# user types in Discord.
COMMAND_GROUPS = [
    {
        "id": "mentions",
        "icon": "📣",
        "commands": [
            ("mention_user", "/mention user"),
            ("mention_role", "/mention role"),
            ("mention_stop", "/mention stop"),
        ],
    },
    {
        "id": "triggers",
        "icon": "💬",
        "commands": [
            ("trigger", "/trigger"),
            ("triggers", "/triggers"),
        ],
    },
    {
        "id": "utilities",
        "icon": "🎲",
        "commands": [
            ("random", "/random"),
            ("coin", "/coin"),
            ("ball", "/ball"),
            ("avatar", "/avatar"),
            ("qr", "/qr"),
            ("preview", "/preview"),
        ],
    },
    {
        "id": "messages",
        "icon": "✉️",
        "commands": [
            ("send_message", "/send message"),
            ("send_dm", "/send dm"),
            ("send_sticky", "/send sticky"),
            ("send_allow", "/send allow"),
        ],
    },
    {
        "id": "voice",
        "icon": "🎙️",
        "commands": [
            ("join", "/join"),
            ("leave", "/leave"),
            ("tts", "/tts"),
        ],
    },
    {
        "id": "ai",
        "icon": "🧠",
        "commands": [
            ("ai_ask_text", "/ai ask text (or @Devi)"),
            ("ai_ask_voice", "/ai ask voice"),
            ("ai_clear", "/ai clear"),
        ],
    },
    {
        "id": "admin",
        "icon": "⚙️",
        "commands": [
            ("clear", "/clear"),
            ("set_log_channel", "/set_log_channel"),
            ("language", "/language"),
            ("command_id", "/command_id"),
            ("temp_role", "/temp_role"),
            ("slowmode", "/slowmode"),
            ("temp_ban", "/temp_ban"),
        ],
    },
    {
        "id": "warns",
        "icon": "⚠️",
        "commands": [
            ("warn_add", "/warn add"),
            ("warn_show", "/warn show"),
            ("warn_remove", "/warn remove"),
            ("warn_obsolete", "/warn obsolete"),
        ],
    },
    {
        "id": "giveaways",
        "icon": "🎉",
        "commands": [
            ("giveaway_start", "/giveaway start"),
            ("giveaway_end", "/giveaway end"),
            ("giveaway_reroll", "/giveaway reroll"),
            ("giveaway_list", "/giveaway list"),
        ],
    },
    {
        "id": "music",
        "icon": "🎵",
        "commands": [
            ("music_interface", "/music interface"),
            ("music_play", "/music play"),
            ("music_pause", "/music pause"),
            ("music_resume", "/music resume"),
            ("music_skip", "/music skip"),
            ("music_loop", "/music loop"),
            ("music_queue", "/music queue"),
            ("music_stop", "/music stop"),
            ("playlist_create", "/playlist create"),
            ("playlist_add", "/playlist add"),
            ("playlist_remove", "/playlist remove"),
            ("playlist_delete", "/playlist delete"),
            ("playlist_steal", "/playlist steal"),
            ("playlist_show", "/playlist show"),
            ("playlist_play", "/playlist play"),
        ],
    },
    {
        "id": "birthdays",
        "icon": "🥳",
        "commands": [
            ("birthday_set", "/birthday set"),
            ("birthday_check", "/birthday check"),
            ("birthday_remove", "/birthday remove"),
            ("birthday_channel", "/birthday channel"),
        ],
    },
    {
        "id": "tempvoice",
        "icon": "⌛",
        "commands": [
            ("voice_setup", "/voice setup"),
            ("voice_interface", "/voice interface"),
            ("voice_name", "/voice name"),
            ("voice_open", "/voice open"),
            ("voice_close", "/voice close"),
            ("voice_allow", "/voice allow"),
            ("voice_ban", "/voice ban"),
            ("voice_kick", "/voice kick"),
            ("voice_limit", "/voice limit"),
            ("voice_bitrate", "/voice bitrate"),
            ("voice_region", "/voice region"),
        ],
    },
    {
        "id": "permissions",
        "icon": "🗂️",
        "commands": [
            ("permissions_manage", "/permissions manage"),
            ("permissions_list", "/permissions list"),
        ],
    },
    {
        "id": "security",
        "icon": "🛡️",
        "commands": [
            ("honeypot_channel", "/honeypot channel"),
            ("honeypot_punishment", "/honeypot punishment"),
        ],
    },
    {
        "id": "user",
        "icon": "",
        "commands": [
            ("make_quote", "key=make_quote_name"),
            ("make_gif", "key=make_gif_name"),
        ]
    }
]

COMMAND_NAME_KEY_PREFIX = "key="


def command_name_key(name: str) -> str | None:
    """Return the locale key encoded in a command name, if present."""
    if not name.startswith(COMMAND_NAME_KEY_PREFIX):
        return None

    key = name[len(COMMAND_NAME_KEY_PREFIX):].strip()
    return "cmd." + key or None


def resolve_command_name(name: str, lang: str) -> str:
    """Resolve a command's display name while leaving literal names unchanged."""
    key = command_name_key(name)
    return t(lang, key) if key else name


def localized_command_groups(lang: str) -> list[dict[str, object]]:
    """Return command groups with localized names."""
    return [
        {
            **group,
            "commands": [
                (command_id, resolve_command_name(command_name, lang))
                for command_id, command_name in group["commands"]
            ],
        }
        for group in COMMAND_GROUPS
    ]

# Feature cards on the landing page. Each id maps to "features.<id>.title"
# and "features.<id>.text" in the locale files.
FEATURE_IDS = ["moderation", "ai", "music", "tempvoice", "giveaways", "utils", "birthdays", "security", "control"]


def command_count() -> int:
    """Total number of documented commands."""
    return sum(len(group["commands"]) for group in COMMAND_GROUPS)


def group_count() -> int:
    """Total number of command groups."""
    return len(COMMAND_GROUPS)

def locale_count() -> int:
    """Total number of locales."""
    if not os.path.isdir(LOCALES_DIR):
        return 0

    return len(sorted(
        file
        for file in os.listdir(LOCALES_DIR)
        if file.endswith(".json")
    ))
