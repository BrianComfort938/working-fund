"""Local persistence: SQLite (MySQL later) + transaction-backup.csv with the
100-line rollover rule, plus saving receipt images to disk."""
import os
import csv
import base64
import sqlite3
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE, "transaction-backup.csv")
DB_PATH = os.path.join(BASE, "pettycash.db")
RECEIPTS_DIR = os.path.join(BASE, "receipts")
BATCH_DIR = os.path.join(BASE, "printed-batches")
MAX_CSV_ROWS = 100

CSV_FIELDS = [
    "recorded_at", "fund_period", "beneficiary", "account_code", "account_name",
    "description", "amount", "currency", "method", "transaction_id",
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
            recorded_at TEXT, fund_period TEXT, beneficiary TEXT,
            account_code TEXT, account_name TEXT, description TEXT,
            amount INTEGER, currency TEXT, method TEXT,
            transaction_id TEXT, logged_at TEXT)"""
    )
    con.commit()
    con.close()


def _row_from_tx(tx, fund_period):
    return {
        "recorded_at": tx.get("recordedAt") or "",
        "fund_period": fund_period,
        "beneficiary": tx.get("beneficiary", ""),
        "account_code": tx.get("accountCode", ""),
        "account_name": tx.get("accountName", ""),
        "description": tx.get("description", ""),
        "amount": int(tx.get("amount", 0) or 0),
        "currency": tx.get("currency", "XOF"),
        "method": tx.get("method", ""),
        "transaction_id": tx.get("id", ""),
    }


def write_sqlite(tx, fund_period):
    init_db()
    row = _row_from_tx(tx, fund_period)
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """INSERT INTO transactions
           (recorded_at,fund_period,beneficiary,account_code,account_name,
            description,amount,currency,method,transaction_id,logged_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (row["recorded_at"], row["fund_period"], row["beneficiary"], row["account_code"],
         row["account_name"], row["description"], row["amount"], row["currency"],
         row["method"], row["transaction_id"], datetime.now().isoformat()),
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
