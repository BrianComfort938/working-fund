import os
import re
import json
import threading
from datetime import datetime

try:
    import secret_config as _cfg
except Exception:
    _cfg = None

BASE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE, "app_settings.json")

_lock = threading.RLock()
_cache = None

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
    overlay = _load()
    if name in overlay and overlay[name] is not None:
        return overlay[name]
    if name in MYSQL_DEFAULTS:
        return _config_default(name, MYSQL_DEFAULTS[name])
    return _config_default(name, default)

def mysql_config(include_password=False):
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
    values = values or {}
    with _lock:
        overlay = dict(_load())
        for key, default in MYSQL_DEFAULTS.items():
            if key not in values:
                continue
            raw = values[key]
            if key == "MYSQL_PASSWORD":
                if raw:
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

def _as_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0

def _clean_counts(counts):
    out = {}
    for key, val in (counts or {}).items():
        n = _as_int(val)
        if n:
            out[str(key)] = n
    return out

def get_cash(mission, period):
    store = get("WF_CASH", {}) or {}
    entry = store.get(_fund_key(mission, period))
    if isinstance(entry, dict):
        return {
            "counts": _clean_counts(entry.get("counts")),
            "wave": _as_int(entry.get("wave")),
            "orange": _as_int(entry.get("orange")),
            "updatedAt": entry.get("updatedAt") or "",
        }
    return {"counts": {}, "wave": 0, "orange": 0, "updatedAt": ""}

def set_cash(mission, period, counts, wave, orange):
    with _lock:
        overlay = dict(_load())
        store = dict(overlay.get("WF_CASH", {}) or {})
        store[_fund_key(mission, period)] = {
            "counts": _clean_counts(counts),
            "wave": _as_int(wave),
            "orange": _as_int(orange),
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
        }
        overlay["WF_CASH"] = store
        _persist(overlay)
        return get_cash(mission, period)
