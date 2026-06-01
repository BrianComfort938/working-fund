"""Best-effort local MySQL ledger for approved transactions.

Mirrors each approved transaction into a local MySQL table (the same
`transactions_2025` schema used by the finance CLI). Configuration lives in
secret_config.py (no environment variables).

This module never raises into the caller: if MySQL is disabled, pymysql is not
installed, or the server is unreachable, write() simply returns False and logs a
warning, so approving a transaction always succeeds.
"""

try:
    import secret_config as _cfg
except Exception:
    _cfg = None

# pymysql is optional — only needed on machines that run the local ledger.
try:
    import pymysql
except Exception:
    pymysql = None

# Review-app method names -> the numeric codes the transactions_2025 table uses
# (0 = CASH, 1 = WAVE, 2 = ORANGE), matching the existing finance CLI data.
METHOD_TO_CODE = {"cash": "0", "wave": "1", "orange": "2"}


def _get(name, default=None):
    return getattr(_cfg, name, default) if _cfg else default


def is_enabled():
    """True only if configured on, pymysql present, and a host is set."""
    return bool(_get("MYSQL_ENABLED", False)) and pymysql is not None and bool(_get("MYSQL_HOST", ""))


def _mysql_datetime(recorded_at):
    """Turn the review app's ISO timestamp into 'YYYY-MM-DD HH:MM:SS' for a
    MySQL DATE/DATETIME column. Falls back to the date portion, then the raw
    value, so a write is never lost to a formatting quirk."""
    if not recorded_at:
        return None
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        s = str(recorded_at)
        return s[:10] if len(s) >= 10 else s


def write(tx, fund_period):
    """Insert one approved transaction. Returns True on success, False otherwise.
    Best-effort: all errors are caught and logged, never raised."""
    if not is_enabled():
        return False

    table = _get("MYSQL_TABLE", "transactions_2025")
    method = METHOD_TO_CODE.get(tx.get("method", ""), tx.get("method", ""))
    params = (
        tx.get("beneficiary", ""),
        tx.get("description", ""),
        int(tx.get("amount", 0) or 0),
        tx.get("accountCode", ""),
        method,
        fund_period,
        _mysql_datetime(tx.get("recordedAt")),
    )

    conn = None
    try:
        conn = pymysql.connect(
            host=_get("MYSQL_HOST", "localhost"),
            port=int(_get("MYSQL_PORT", 3306)),
            user=_get("MYSQL_USER", "root"),
            password=_get("MYSQL_PASSWORD", ""),
            database=_get("MYSQL_DB", "working_fund_db"),
            connect_timeout=5,
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            # Backtick-quote the table name (identifier can't be parameterized);
            # all VALUES are bound parameters, so the row data is never inlined.
            cur.execute(
                f"INSERT INTO `{table}` "
                "(`beneficiary`, `description`, `amount`, `account`, "
                "`method`, `wf_period`, `date`) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                params,
            )
        conn.commit()
        return True
    except Exception as e:
        try:
            from flask import current_app
            current_app.logger.warning("MySQL ledger write failed: %s", e)
        except Exception:
            print(f"[MySQL Error] {e}")
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
