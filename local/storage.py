"""Local persistence: SQLite (MySQL later) + transaction-backup.csv with the
100-line rollover rule, plus saving receipt images to disk."""
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
    init_db()
    row = _row_from_tx(tx, fund_period)
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """INSERT INTO transactions
           (recorded_at,mission,fund_period,beneficiary,account_code,account_name,
            description,amount,currency,method,signed,transaction_id,logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (row["recorded_at"], row["mission"], row["fund_period"], row["beneficiary"],
         row["account_code"], row["account_name"], row["description"], row["amount"],
         row["currency"], row["method"], row["signed"], row["transaction_id"],
         datetime.now().isoformat()),
    )
    con.commit()
    con.close()


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
    """If the CSV has more than MAX_CSV_ROWS data rows, move the oldest 100 into an
    archived batch file (so nothing is lost if a print is cancelled) and rewrite the
    main CSV without them. Returns the batch id to print, or None."""
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


def save_receipt(tx_id, data_url, which):
    """Decode a base64 data URL and write it to receipts/<id>_<which>.<ext>."""
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


def remove_transaction(tx_id):
    """Undo a local record (used when a committed transaction is reversed): drop its
    SQLite row, rewrite the CSV without it, and delete its receipt/signature files."""
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


def save_signature(tx_id, sig):
    """Persist the compact vector-stroke signature next to the receipts as a small
    JSON file (typically a few hundred bytes), so it can be re-rendered later."""
    if not sig or not sig.get("s"):
        return None
    _ensure_dirs()
    fname = f"{tx_id}_signature.json"
    with open(os.path.join(RECEIPTS_DIR, fname), "w", encoding="utf-8") as f:
        json.dump(sig, f, separators=(",", ":"))  # no whitespace -> smallest file
    return fname
