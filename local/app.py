"""Local petty-cash review app.

On run it pulls unlogged transactions from MongoDB Atlas (or demo data), serves a
keyboard-driven review page in your browser, and on approval prints the physical
record and saves to SQLite + transaction-backup.csv.

    python app.py            # uses .env / environment for MONGODB_URI
"""
import os
import base64
import threading
import webbrowser
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass

from flask import Flask, jsonify, request, render_template, Response, abort

import cloud
import storage

app = Flask(__name__)

# Single local user -> simple in-memory session state.
STATE = {"queue": [], "period": "000"}

METHOD_LABELS = {"cash": "ESPÈCES", "wave": "WAVE", "orange": "ORANGE"}

# Exact account codes (KEEP EXACT) — used to keep accountName in sync on edit.
ACCOUNT_CODES = {
    "00": "400-5102 Travel In-field", "01": "400-5700 Furnishings YM",
    "02": "400-5930 Food and Personal Items", "03": "400-5868 Utilities YM",
    "04": "400-5862 Rent YM", "05": "400-5920 Charitable Assistance",
    "06": "400-5221 Book of Mormon", "10": "000-5102 Travel Admin",
    "11": "000-5496 Luncheons, Socials & Hosting",
    "12": "000-5860 Small Purchases/Services for Mission Home & Office",
    "13": "000-5500 Miscellaneous", "14": "000-5370 Telephone and Internet",
    "15": "000-5221 Teaching Literature and Supplies",
    "16": "000-5200 Operating materials and supplies",
    "17": "000-5170 Vehicle Gasoline", "18": "000-5379 Postage and Mailing",
    "19": "000-5700 Small Office Equipment", "20": "000-5461 Bank Fees",
    "21": "000-5776 Small Office Equipment and Maintenance",
    "22": "000-5862 Rent Admin", "23": "000-5868 Utilities Admin",
    "30": "480-5862 Rent SM", "31": "480-5700 Furnishings SM",
    "32": "480-5868 Utilities SM", "40": "600-5480 Vehicle Taxes and Fees",
    "41": "600-5700 Vehicle Equipment", "42": "600-5772 Vehicle Maintenance and repairs",
    "50": "900-5102 Travel, Baggage, Visa and Other", "51": "900-5949 Missionary Medical",
}


def _to_view(doc):
    rid = str(doc.get("_id") or doc.get("id") or "")
    recorded = doc.get("createdAt") or doc.get("clientCreatedAt")
    if isinstance(recorded, datetime):
        recorded = recorded.isoformat()
    return {
        "id": rid,
        "beneficiary": doc.get("beneficiary", ""),
        "accountCode": doc.get("accountCode", ""),
        "accountName": doc.get("accountName", ""),
        "description": doc.get("description", ""),
        "amount": int(doc.get("amount", 0) or 0),
        "currency": doc.get("currency", "XOF"),
        "method": doc.get("method", ""),
        "recordedAt": recorded or "",
        "receiptImage": doc.get("receiptImage", ""),
        "waveReceiptImage": doc.get("waveReceiptImage", ""),
    }


def load_queue():
    docs = cloud.fetch_unlogged()
    if docs is None:
        import demo_data
        docs = demo_data.SAMPLES
        app.logger.info("No MONGODB_URI - running in DEMO mode with sample data.")
    STATE["queue"] = [_to_view(d) for d in docs]


def _find(tx_id):
    return next((t for t in STATE["queue"] if t["id"] == tx_id), None)


def _light(t):
    keys = ("id", "beneficiary", "accountCode", "accountName", "description",
            "amount", "currency", "method", "recordedAt")
    out = {k: t[k] for k in keys}
    out["hasReceipt"] = bool(t["receiptImage"])
    out["hasWaveReceipt"] = bool(t["waveReceiptImage"])
    return out


def _fmt_amount(amount, currency):
    s = f"{abs(int(amount)):,}"
    return (f"-{s} {currency}" if amount < 0 else f"{s} {currency}")


@app.route("/")
def index():
    return render_template("review.html")


@app.route("/api/state")
def api_state():
    return jsonify({
        "period": STATE["period"],
        "cloud": cloud.is_cloud(),
        "queue": [_light(t) for t in STATE["queue"]],
    })


@app.route("/api/period", methods=["POST"])
def api_period():
    raw = (request.json or {}).get("period", "")
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if not digits:
        return jsonify({"error": "period must be a number 000-999"}), 400
    val = int(digits)
    if val > 999:
        return jsonify({"error": "max period is 999"}), 400
    STATE["period"] = f"{val:03d}"
    return jsonify({"period": STATE["period"]})


@app.route("/api/receipt/<tx_id>/<which>")
def api_receipt(tx_id, which):
    t = _find(tx_id)
    if not t:
        abort(404)
    data_url = t["receiptImage"] if which == "main" else t["waveReceiptImage"]
    if not data_url:
        abort(404)
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
        mime = header.replace("data:", "").split(";")[0] or "image/jpeg"
    else:
        b64, mime = data_url, "image/jpeg"
    return Response(base64.b64decode(b64), mimetype=mime)


@app.route("/api/edit/<tx_id>", methods=["POST"])
def api_edit(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    data = request.json or {}
    for k in ("beneficiary", "accountCode", "accountName", "description", "method"):
        if k in data:
            t[k] = data[k]
    if "amount" in data:
        try:
            t["amount"] = int(data["amount"])
        except (TypeError, ValueError):
            pass
    if data.get("accountCode") in ACCOUNT_CODES and not data.get("accountName"):
        t["accountName"] = ACCOUNT_CODES[data["accountCode"]]
    return jsonify({"ok": True, "tx": _light(t)})


@app.route("/api/approve/<tx_id>", methods=["POST"])
def api_approve(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    period = STATE["period"]
    # 1) save receipts to disk (from the in-memory base64)
    storage.save_receipt(t["id"], t.get("receiptImage"), "main")
    storage.save_receipt(t["id"], t.get("waveReceiptImage"), "wave")
    # 2) persist locally
    storage.write_sqlite(t, period)
    storage.append_csv(t, period)
    rollover = storage.rollover_if_needed()
    # 3) mark cloud doc logged + strip its images
    try:
        cloud.mark_logged(t["id"], period)
    except Exception as e:  # never block the local record on a cloud hiccup
        app.logger.warning("cloud mark_logged failed: %s", e)
    # 4) drop from queue
    STATE["queue"] = [x for x in STATE["queue"] if x["id"] != t["id"]]
    return jsonify({"ok": True, "rollover": rollover})


@app.route("/api/delete/<tx_id>", methods=["POST"])
def api_delete(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    try:
        cloud.delete_tx(t["id"])
    except Exception as e:
        app.logger.warning("cloud delete failed: %s", e)
    STATE["queue"] = [x for x in STATE["queue"] if x["id"] != t["id"]]
    return jsonify({"ok": True})


@app.route("/print/<tx_id>")
def print_record(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    date_iso, date_fr = "", ""
    if t["recordedAt"]:
        try:
            dt = datetime.fromisoformat(t["recordedAt"].replace("Z", "+00:00"))
            date_iso, date_fr = dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y")
        except ValueError:
            date_iso = t["recordedAt"][:10]
    return render_template(
        "record.html",
        beneficiary=t["beneficiary"],
        method_label=METHOD_LABELS.get(t["method"], (t["method"] or "").upper()),
        date_iso=date_iso, date_fr=date_fr,
        account_name=t["accountName"], description=t["description"],
        amount_str=_fmt_amount(t["amount"], t["currency"]),
        main_img=t.get("receiptImage", ""), wave_img=t.get("waveReceiptImage", ""),
        auto_print=True,
    )


@app.route("/print/csv-batch/<batch_id>")
def print_csv_batch(batch_id):
    rows = storage.read_batch(batch_id)
    if not rows:
        abort(404)
    return render_template("csv_batch.html", rows=rows, batch_id=batch_id,
                           count=len(rows), auto_print=True)


def _open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}/")


def main():
    storage.init_db()
    load_queue()
    port = int(os.environ.get("PORT", "5000"))
    n = len(STATE["queue"])
    print(f"\n  Petty Cash review: {n} unlogged transaction(s). "
          f"{'(DEMO data)' if not cloud.is_cloud() else ''}")
    print(f"  Open http://127.0.0.1:{port}/  (a browser tab should open automatically)\n")
    threading.Timer(1.0, _open_browser, args=(port,)).start()
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
