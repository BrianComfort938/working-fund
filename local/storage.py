import os
import csv
import json
import base64
import sqlite3
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE, "transaction-backup.csv")
DB_PATH = os.path.join(BASE, "workingfund.db")
RECEIPTS_DIR = os.path.join(BASE, "receipts")
BATCH_DIR = os.path.join(BASE, "printed-batches")
MAX_CSV_ROWS = 100

CSV_FIELDS = [
    "recorded_at", "mission", "fund_period", "beneficiary", "account_code", "account_name",
    "description", "amount", "currency", "method", "signed", "transaction_id",
]


def _ensure_dirs():
    os.makedirs(RECEIPTS_DIR, exist_ok=True)
    os.makedirs(BATCH_DIR, exist_ok=True)


def init_db():
    _ensure_dirs()
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at TEXT, mission TEXT, fund_period TEXT, beneficiary TEXT,
            account_code TEXT, account_name TEXT, description TEXT,
            amount INTEGER, currency TEXT, method TEXT,
            signed INTEGER, transaction_id TEXT, logged_at TEXT)"""
    )
    con.commit()
    con.close()


def _row_from_tx(tx, fund_period):
    return {
        "recorded_at": tx.get("recordedAt") or "",
        "mission": tx.get("mission", ""),
        "fund_period": fund_period,
        "beneficiary": tx.get("beneficiary", ""),
        "account_code": tx.get("accountCode", ""),
        "account_name": tx.get("accountName", ""),
        "description": tx.get("description", ""),
        "amount": int(tx.get("amount", 0) or 0),
        "currency": tx.get("currency", "XOF"),
        "method": tx.get("method", ""),
        "signed": 1 if tx.get("signature") else 0,
        "transaction_id": tx.get("id", ""),
    }


def write_sqlite(tx, fund_period):
    """Insert one approved transaction locally and return its row id (int)."""
    init_db()
    row = _row_from_tx(tx, fund_period)
    con = sqlite3.connect(DB_PATH)
    cur = con.execute(
        """INSERT INTO transactions
           (recorded_at,mission,fund_period,beneficiary,account_code,account_name,
            description,amount,currency,method,signed,transaction_id,logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (row["recorded_at"], row["mission"], row["fund_period"], row["beneficiary"],
         row["account_code"], row["account_name"], row["description"], row["amount"],
         row["currency"], row["method"], row["signed"], row["transaction_id"],
         datetime.now().isoformat()),
    )
    new_id = cur.lastrowid
    con.commit()
    con.close()
    return new_id


def append_csv(tx, fund_period):
    _ensure_dirs()
    new_file = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        if new_file:
            w.writeheader()
        w.writerow(_row_from_tx(tx, fund_period))


def _read_csv_rows():
    if not os.path.exists(CSV_PATH):
        return []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def rollover_if_needed():
    rows = _read_csv_rows()
    if len(rows) <= MAX_CSV_ROWS:
        return None
    batch = rows[:MAX_CSV_ROWS]
    remaining = rows[MAX_CSV_ROWS:]
    batch_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    with open(os.path.join(BATCH_DIR, f"batch-{batch_id}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(batch)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(remaining)
    return batch_id


def read_batch(batch_id):
    path = os.path.join(BATCH_DIR, f"batch-{batch_id}.csv")
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def batch_pdf_path(batch_id):
    return os.path.join(BATCH_DIR, f"batch-{batch_id}.pdf")


def batch_date_range(rows):
    """Earliest and latest recorded_at in a batch, as raw ISO strings ("" if none).

    ISO-8601 timestamps sort chronologically as plain strings, so a lexical
    min/max is enough to find the span of the 100 archived entries.
    """
    stamps = sorted(s for s in ((r.get("recorded_at") or "").strip() for r in rows) if s)
    if not stamps:
        return "", ""
    return stamps[0], stamps[-1]


def save_receipt(tx_id, data_url, which):
    if not data_url:
        return None
    _ensure_dirs()
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
    else:
        header, b64 = "image/jpeg", data_url
    ext = "jpg"
    if "png" in header:
        ext = "png"
    elif "svg" in header:
        ext = "svg"
    fname = f"{tx_id}_{which}.{ext}"
    with open(os.path.join(RECEIPTS_DIR, fname), "wb") as f:
        f.write(base64.b64decode(b64))
    return fname


def delete_receipts(tx_id):
    if not tx_id:
        return
    for suf in ("_main.jpg", "_main.png", "_main.svg",
                "_second.jpg", "_second.png", "_second.svg"):
        p = os.path.join(RECEIPTS_DIR, tx_id + suf)
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def remove_transaction(tx_id):
    if not tx_id:
        return
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute("DELETE FROM transactions WHERE transaction_id=?", (tx_id,))
        con.commit()
        con.close()
    except Exception:
        pass
    rows = _read_csv_rows()
    keep = [r for r in rows if r.get("transaction_id") != tx_id]
    if len(keep) != len(rows):
        with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            w.writeheader()
            w.writerows(keep)
    for suf in ("_main.jpg", "_main.png", "_main.svg", "_second.jpg", "_second.png",
                "_second.svg", "_signature.json"):
        p = os.path.join(RECEIPTS_DIR, tx_id + suf)
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


NAME_STOPWORDS = {
    "elder", "elders", "soeur", "soeurs", "sister", "sisters",
    "frere", "frère", "freres", "frères", "brother", "brothers",
    "president", "président", "pres", "pdt", "mr", "mrs", "ms", "mme", "m", "dr",
}


def _name_tokens(name):
    s = (name or "").lower()
    repl = {"é": "e", "è": "e", "ê": "e", "ë": "e", "à": "a", "â": "a", "ä": "a",
            "î": "i", "ï": "i", "ô": "o", "ö": "o", "û": "u", "ü": "u", "ç": "c"}
    s = "".join(repl.get(ch, ch) for ch in s)
    toks = [t for t in "".join(c if c.isalnum() else " " for c in s).split() if t]
    return [t for t in toks if t not in NAME_STOPWORDS]


def _all_rows():
    rows = []
    seen_ids = set()
    try:
        con = sqlite3.connect(DB_PATH)
        con.row_factory = sqlite3.Row
        for r in con.execute(
            "SELECT recorded_at, mission, fund_period, beneficiary, account_code, "
            "account_name, description, amount, currency, method, transaction_id "
            "FROM transactions ORDER BY id DESC"
        ):
            d = dict(r)
            rows.append(d)
            if d.get("transaction_id"):
                seen_ids.add(d["transaction_id"])
        con.close()
    except Exception:
        pass
    for r in reversed(_read_csv_rows()):
        if r.get("transaction_id") and r["transaction_id"] in seen_ids:
            continue
        rows.append(r)
    return rows


def find_similar(beneficiary, amount, exclude_id="", limit=8, amount_tolerance=0):
    want_tokens = set(_name_tokens(beneficiary))
    try:
        want_amount = int(amount)
    except (TypeError, ValueError):
        want_amount = None

    out, seen = [], set()
    for r in _all_rows():
        if exclude_id and r.get("transaction_id") == exclude_id:
            continue
        try:
            row_amount = int(r.get("amount") or 0)
        except (TypeError, ValueError):
            row_amount = 0

        name_hit = bool(want_tokens & set(_name_tokens(r.get("beneficiary"))))
        amount_hit = (
            want_amount is not None and want_amount != 0
            and abs(row_amount - want_amount) <= max(0, int(amount_tolerance))
        )
        if not name_hit and not amount_hit:
            continue

        key = (str(r.get("beneficiary", "")).strip().lower(), row_amount, r.get("recorded_at", ""))
        if key in seen:
            continue
        seen.add(key)

        out.append({
            "beneficiary": r.get("beneficiary", ""),
            "amount": row_amount,
            "currency": r.get("currency", "XOF"),
            "account_code": r.get("account_code", ""),
            "account_name": r.get("account_name", ""),
            "recorded_at": r.get("recorded_at", ""),
            "method": r.get("method", ""),
            "mission": r.get("mission", ""),
            "match": "both" if (name_hit and amount_hit) else ("name" if name_hit else "amount"),
        })
        if len(out) >= max(1, int(limit)):
            break
    return out


def save_signature(tx_id, sig):
    if not sig or not sig.get("s"):
        return None
    _ensure_dirs()
    fname = f"{tx_id}_signature.json"
    with open(os.path.join(RECEIPTS_DIR, fname), "w", encoding="utf-8") as f:
        json.dump(sig, f, separators=(",", ":"))
    return fname
