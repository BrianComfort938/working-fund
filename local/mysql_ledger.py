"""Local MySQL ledger.

Approved transactions are mirrored into a MySQL table so the office can keep its
own SQL copy. Connection details and the table name come from settings.py (which
the review portal's Settings panel can edit at runtime). The table is created
automatically on first use, so a fresh database needs no manual setup.
"""
import settings

try:
    import pymysql
except Exception:
    pymysql = None

METHOD_TO_CODE = {"cash": "0", "wave": "1", "orange": "2"}

DEFAULT_TABLE = "transactions_2025"


def _get(name, default=None):
    return settings.get(name, default)


def is_enabled():
    return bool(_get("MYSQL_ENABLED", False)) and pymysql is not None and bool(_get("MYSQL_HOST", ""))


def driver_available():
    """True when pymysql is importable (the connector is installed)."""
    return pymysql is not None


def _table_name():
    table = _get("MYSQL_TABLE", DEFAULT_TABLE) or DEFAULT_TABLE
    table = str(table).strip()
    # Identifiers can't be parameterized, so reject anything but word characters
    # to keep the f-string interpolation below injection-proof.
    return table if settings.valid_table_name(table) else DEFAULT_TABLE


def table_name():
    """The effective ledger table name (validated, with fallback).

    Exposed for callers like the printed record watermark that want to show
    which SQL table the transaction is mirrored into.
    """
    return _table_name()


def _mysql_datetime(recorded_at):
    if not recorded_at:
        return None
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        s = str(recorded_at)
        return s[:10] if len(s) >= 10 else s


def _connect(overrides=None):
    """Open a connection from current settings, optionally overridden in-memory.

    `overrides` lets the Settings panel test unsaved field values without
    persisting them. A blank password in the overrides falls back to the stored
    one (the field is write-only in the UI).
    """
    if pymysql is None:
        raise RuntimeError("pymysql is not installed. Run: pip install -r requirements.txt")
    ov = overrides or {}

    def pick(key, default=None):
        val = ov.get(key)
        if val is None or val == "":
            return _get(key, default)
        return val

    password = ov.get("MYSQL_PASSWORD") or _get("MYSQL_PASSWORD", "")
    return pymysql.connect(
        host=pick("MYSQL_HOST", "localhost"),
        port=int(pick("MYSQL_PORT", 3306) or 3306),
        user=pick("MYSQL_USER", "root"),
        password=password,
        database=pick("MYSQL_DB", "working_fund_db"),
        connect_timeout=5,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _ensure_table(conn, table):
    """Create the ledger table if it does not already exist.

    An existing table with a different shape is left untouched (IF NOT EXISTS).
    """
    with conn.cursor() as cur:
        cur.execute(
            f"CREATE TABLE IF NOT EXISTS `{table}` ("
            "`id` INT AUTO_INCREMENT PRIMARY KEY, "
            "`beneficiary` VARCHAR(255), "
            "`description` TEXT, "
            "`amount` INT, "
            "`account` VARCHAR(64), "
            "`method` VARCHAR(16), "
            "`wf_period` VARCHAR(8), "
            "`date` DATETIME"
            ") DEFAULT CHARSET=utf8mb4"
        )
    conn.commit()


def write(tx, fund_period):
    if not is_enabled():
        return False

    table = _table_name()
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
        conn = _connect()
        _ensure_table(conn, table)
        with conn.cursor() as cur:
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


def _cell(v):
    """Make a MySQL value JSON-safe (datetimes, Decimals, bytes -> str)."""
    if v is None or isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


def run_query(sql):
    """Run an ad-hoc SQL statement against the MySQL mirror (the dashboard's
    query console). Returns columns+rows for result sets, or an affected-row
    message for writes. This targets the append-only mirror, not the canonical
    SQLite/CSV ledger, so it is safe for the user to query and tinker with."""
    if pymysql is None:
        return {"error": "The pymysql driver isn't installed. Run: pip install -r requirements.txt"}
    if not is_enabled():
        return {"error": "MySQL is off. Turn on “Mirror to MySQL” in Settings → MySQL ledger first."}
    sql = (sql or "").strip()
    if not sql:
        return {"error": "Enter a query."}

    conn = None
    try:
        conn = _connect()
        table = _table_name()
        _ensure_table(conn, table)
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description:
                cols = [d[0] for d in cur.description]
                rows = [[_cell(r.get(c)) for c in cols] for r in cur.fetchmany(2000)]
                conn.commit()
                return {"columns": cols, "rows": rows, "table": table}
            conn.commit()
            n = cur.rowcount
            return {"columns": [], "rows": [], "rowcount": n, "table": table,
                    "message": f"OK — {n} row{'s' if n != 1 else ''} affected."}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def test_connection(overrides=None):
    """Try to connect and ensure the table, returning (ok, message).

    Used by the Settings panel's "Test connection" button. Reports the row count
    so the user can confirm they reached the table they expect.
    """
    if pymysql is None:
        return False, "The pymysql driver isn't installed. Run: pip install -r requirements.txt"

    ov = dict(overrides or {})
    table = ov.get("MYSQL_TABLE") or _get("MYSQL_TABLE", DEFAULT_TABLE)
    table = str(table).strip()
    if not settings.valid_table_name(table):
        return False, "Table name may contain only letters, numbers, and underscores."

    conn = None
    try:
        conn = _connect(ov)
        _ensure_table(conn, table)
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS n FROM `{table}`")
            row = cur.fetchone() or {}
        count = row.get("n", 0)
        db = ov.get("MYSQL_DB") or _get("MYSQL_DB", "")
        return True, f"Connected. Table `{db}`.`{table}` is ready ({count} row{'s' if count != 1 else ''})."
    except Exception as e:
        return False, f"Could not connect: {e}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
