"""Runtime-editable settings overlay.

Defaults come from secret_config.py (gitignored, holds the credentials). The
review portal's Settings panel can override the MySQL ledger fields at runtime,
and those overrides are persisted to app_settings.json (also gitignored) so they
survive a restart. secret_config.py is never rewritten.

Lookup order for a setting:  app_settings.json  →  secret_config.py  →  hard default.
"""
import os
import re
import json
import threading

try:
    import secret_config as _cfg
except Exception:
    _cfg = None

BASE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE, "app_settings.json")

_lock = threading.RLock()
_cache = None

# The only settings the UI is allowed to change, with their hard defaults (used
# when secret_config.py does not define them). MYSQL_PASSWORD is write-only: it
# is never sent back to the browser, only updated when a new value is supplied.
MYSQL_DEFAULTS = {
    "MYSQL_ENABLED": False,
    "MYSQL_HOST": "localhost",
    "MYSQL_PORT": 3306,
    "MYSQL_USER": "root",
    "MYSQL_PASSWORD": "",
    "MYSQL_DB": "working_fund_db",
    "MYSQL_TABLE": "transactions_2025",
}

_TABLE_RE = re.compile(r"^[A-Za-z0-9_]+$")


def valid_table_name(name):
    """A table name safe to interpolate into SQL (identifiers can't be bound)."""
    return bool(name) and bool(_TABLE_RE.match(str(name))) and len(str(name)) <= 64


def _config_default(name, hard=None):
    return getattr(_cfg, name, hard) if _cfg else hard


def _load():
    global _cache
    with _lock:
        if _cache is None:
            try:
                with open(SETTINGS_PATH, encoding="utf-8") as f:
                    data = json.load(f)
                _cache = data if isinstance(data, dict) else {}
            except Exception:
                _cache = {}
        return _cache


def get(name, default=None):
    """Resolve a setting: overlay first, then secret_config, then default."""
    overlay = _load()
    if name in overlay and overlay[name] is not None:
        return overlay[name]
    if name in MYSQL_DEFAULTS:
        return _config_default(name, MYSQL_DEFAULTS[name])
    return _config_default(name, default)


def mysql_config(include_password=False):
    """Current MySQL settings for the API.

    The password is omitted by default; instead a `passwordSet` flag tells the UI
    whether one is stored, so the field can show a placeholder without leaking it.
    """
    cfg = {
        "MYSQL_ENABLED": bool(get("MYSQL_ENABLED")),
        "MYSQL_HOST": str(get("MYSQL_HOST", "") or ""),
        "MYSQL_PORT": int(get("MYSQL_PORT", 3306) or 3306),
        "MYSQL_USER": str(get("MYSQL_USER", "") or ""),
        "MYSQL_DB": str(get("MYSQL_DB", "") or ""),
        "MYSQL_TABLE": str(get("MYSQL_TABLE", "") or ""),
    }
    password = str(get("MYSQL_PASSWORD", "") or "")
    if include_password:
        cfg["MYSQL_PASSWORD"] = password
    else:
        cfg["passwordSet"] = bool(password)
    return cfg


def update(values):
    """Merge user-supplied MySQL settings into the overlay and persist.

    Unknown keys are ignored. An empty or absent MYSQL_PASSWORD leaves the stored
    one untouched (the field is write-only), so blanks never wipe the password.
    """
    values = values or {}
    with _lock:
        overlay = dict(_load())
        for key, default in MYSQL_DEFAULTS.items():
            if key not in values:
                continue
            raw = values[key]
            if key == "MYSQL_PASSWORD":
                if raw:                       # only overwrite when a value is given
                    overlay[key] = str(raw)
                continue
            if key == "MYSQL_PORT":
                try:
                    overlay[key] = int(raw)
                except (TypeError, ValueError):
                    continue
            elif key == "MYSQL_ENABLED":
                overlay[key] = bool(raw)
            elif key == "MYSQL_TABLE":
                if valid_table_name(raw):
                    overlay[key] = str(raw).strip()
            else:
                overlay[key] = str(raw).strip()

        _persist(overlay)
        return mysql_config()


def _persist(overlay):
    global _cache
    _cache = overlay
    tmp = SETTINGS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(overlay, f, indent=2)
    os.replace(tmp, SETTINGS_PATH)


# --- Working fund -----------------------------------------------------------
# The starting amount is kept per mission+period (a fresh fund each period), and
# the balance mode decides whether the dashboard counts only recorded (DB)
# transactions or also those still sitting in the review queue.

def balance_mode():
    return "all" if get("FUND_BALANCE_MODE", "recorded") == "all" else "recorded"


def set_balance_mode(mode):
    with _lock:
        overlay = dict(_load())
        overlay["FUND_BALANCE_MODE"] = "all" if str(mode) == "all" else "recorded"
        _persist(overlay)
        return overlay["FUND_BALANCE_MODE"]


def _fund_key(mission, period):
    return f"{mission}:{period}"


# A fresh working fund defaults to 7.5M XOF until the user sets it explicitly.
DEFAULT_FUND_START = 7_500_000


def fund_start(mission, period):
    starts = get("WF_START", {}) or {}
    key = _fund_key(mission, period)
    if key in starts:
        try:
            return int(starts[key])
        except (TypeError, ValueError):
            return DEFAULT_FUND_START
    return DEFAULT_FUND_START


def set_fund_start(mission, period, value):
    with _lock:
        overlay = dict(_load())
        starts = dict(overlay.get("WF_START", {}) or {})
        try:
            starts[_fund_key(mission, period)] = int(value)
        except (TypeError, ValueError):
            starts[_fund_key(mission, period)] = 0
        overlay["WF_START"] = starts
        _persist(overlay)
        return starts[_fund_key(mission, period)]
