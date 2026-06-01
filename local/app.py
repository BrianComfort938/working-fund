"""Local Working Fund review app.

On run it pulls ALL transactions from MongoDB Atlas (or demo data) and serves an
editable, keyboard-driven review page. Each transaction is editable on load.

Per transaction the reviewer can:
  - Approve  -> save locally (SQLite + CSV + receipts + signature), print the A4
                record, then DELETE it from the cloud (incl. receipts/signature).
  - Skip     -> leave it on the cloud (hidden only for this session).
  - Delete   -> DELETE it from the cloud (incl. receipts/signature), no local save.

A browser-side History page lists recently approved / deleted transactions and can
reverse them: while the app is running a reversal restores the full transaction to
the queue (and undoes the local record for approved ones).

    python app.py            # reads MONGODB_URI from secret_config.py
"""
import base64
import threading
import webbrowser
from datetime import datetime

from flask import Flask, jsonify, request, render_template, Response, abort

import cloud
import storage
import mysql_ledger
import printing

app = Flask(__name__)

# Single local user -> simple in-memory session state.
# "all" holds every transaction pulled from the cloud; the UI shows one mission.
# "handled" keeps recently approved/deleted full transactions (with images) so the
# print view still works after removal and so History can fully restore them.
STATE = {"all": [], "mission": "east", "period": "000", "handled": {}}
MISSIONS = ("east", "south")
HANDLED_CAP = 60

METHOD_LABELS = {"cash": "ESPÈCES", "wave": "WAVE", "orange": "ORANGE"}

# Exact account codes (KEEP EXACT).
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


def _img_to_data_url(val):
    """Accept a Base64 data URL (str) or raw JPEG bytes (BSON Binary) -> data URL."""
    if not val:
        return ""
    if isinstance(val, str):
        return val
    try:
        return "data:image/jpeg;base64," + base64.b64encode(bytes(val)).decode("ascii")
    except Exception:
        return ""


def _to_view(doc):
    rid = str(doc.get("_id") or doc.get("id") or "")
    recorded = doc.get("createdAt") or doc.get("clientCreatedAt") or doc.get("recordedAt")
    if isinstance(recorded, datetime):
        recorded = recorded.isoformat()
    m = doc.get("mission", "east")
    return {
        "id": rid,
        "mission": m if m in MISSIONS else "east",
        "beneficiary": doc.get("beneficiary", ""),
        "accountCode": doc.get("accountCode", ""),
        "accountName": doc.get("accountName", ""),
        "description": doc.get("description", ""),
        "amount": int(doc.get("amount", 0) or 0),
        "currency": doc.get("currency", "XOF"),
        "method": doc.get("method", ""),
        "recordedAt": recorded or "",
        "receiptImage": _img_to_data_url(doc.get("receiptImage")),
        "secondReceiptImage": _img_to_data_url(doc.get("secondReceiptImage", doc.get("waveReceiptImage"))),
        "signature": doc.get("signature") or None,
        "location": doc.get("location") or None,
    }


def load_queue():
    docs = cloud.fetch_all()  # ALL cloud transactions
    if docs is None:
        import demo_data
        docs = demo_data.SAMPLES
        app.logger.info("No MONGODB_URI - running in DEMO mode with sample data.")
    STATE["all"] = [_to_view(d) for d in docs]


def _find(tx_id):
    return next((t for t in STATE["all"] if t["id"] == tx_id), None)


def _find_any(tx_id):
    return _find(tx_id) or STATE["handled"].get(tx_id)


def _visible():
    return [t for t in STATE["all"] if t["mission"] == STATE["mission"]]


def _mission_counts():
    counts = {m: 0 for m in MISSIONS}
    for t in STATE["all"]:
        if t["mission"] in counts:
            counts[t["mission"]] += 1
    return counts


def _light(t):
    keys = ("id", "mission", "beneficiary", "accountCode", "accountName", "description",
            "amount", "currency", "method", "recordedAt")
    out = {k: t[k] for k in keys}
    out["hasReceipt"] = bool(t["receiptImage"])
    out["hasSecondReceipt"] = bool(t["secondReceiptImage"])
    out["hasSignature"] = bool(t.get("signature"))
    out["signature"] = t.get("signature")  # compact strokes; small enough to inline
    out["location"] = t.get("location")    # {lat, lon, accuracy, at} or None
    return out


def _fmt_amount(amount, currency):
    s = f"{abs(int(amount)):,}"
    return (f"-{s} {currency}" if amount < 0 else f"{s} {currency}")


def _signature_svg(sig):
    if not sig or not sig.get("s"):
        return ""
    w, h = sig.get("w") or 1, sig.get("h") or 1
    paths = []
    for flat in sig["s"]:
        if len(flat) < 2:
            continue
        d = "M" + " L".join(f"{flat[i]},{flat[i+1]}" for i in range(0, len(flat) - 1, 2))
        paths.append(f'<path d="{d}" fill="none" stroke="#1a2228" '
                     f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
    if not paths:
        return ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'preserveAspectRatio="xMidYMid meet" style="width:100%;height:55px">'
            + "".join(paths) + "</svg>")


def _apply_edits(t, data):
    for k in ("beneficiary", "accountCode", "accountName", "description", "method"):
        if data.get(k) is not None:
            t[k] = data[k]
    if data.get("mission") in MISSIONS:
        t["mission"] = data["mission"]
    if "amount" in data:
        try:
            t["amount"] = int(data["amount"])
        except (TypeError, ValueError):
            pass
    if data.get("accountCode") in ACCOUNT_CODES and not data.get("accountName"):
        t["accountName"] = ACCOUNT_CODES[data["accountCode"]]


def _remember_handled(t):
    STATE["handled"][t["id"]] = t
    if len(STATE["handled"]) > HANDLED_CAP:
        # drop oldest insertion(s)
        for k in list(STATE["handled"].keys())[:-HANDLED_CAP]:
            STATE["handled"].pop(k, None)


@app.route("/")
def index():
    return render_template("review.html")


@app.route("/api/state")
def api_state():
    return jsonify({
        "period": STATE["period"],
        "mission": STATE["mission"],
        "counts": _mission_counts(),
        "cloud": cloud.is_cloud(),
        "queue": [_light(t) for t in _visible()],
    })


@app.route("/api/mission", methods=["POST"])
def api_mission():
    m = (request.json or {}).get("mission", "")
    if m not in MISSIONS:
        return jsonify({"error": "mission must be east or south"}), 400
    STATE["mission"] = m
    return jsonify({"mission": m, "counts": _mission_counts(), "queue": [_light(t) for t in _visible()]})


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
    t = _find_any(tx_id)
    if not t:
        abort(404)
    data_url = t["receiptImage"] if which == "main" else t["secondReceiptImage"]
    if not data_url:
        abort(404)
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
        mime = header.replace("data:", "").split(";")[0] or "image/jpeg"
    else:
        b64, mime = data_url, "image/jpeg"
    return Response(base64.b64decode(b64), mimetype=mime)


@app.route("/api/signature/<tx_id>.svg")
def api_signature(tx_id):
    t = _find_any(tx_id)
    if not t or not t.get("signature"):
        abort(404)
    return Response(_signature_svg(t["signature"]), mimetype="image/svg+xml")


@app.route("/api/approve/<tx_id>", methods=["POST"])
def api_approve(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    _apply_edits(t, request.json or {})
    period = STATE["period"]
    # 1) save receipts + signature locally
    storage.save_receipt(t["id"], t.get("receiptImage"), "main")
    storage.save_receipt(t["id"], t.get("secondReceiptImage"), "second")
    storage.save_signature(t["id"], t.get("signature"))
    # 2) persist locally
    storage.write_sqlite(t, period)
    storage.append_csv(t, period)
    rollover = storage.rollover_if_needed()
    # 2b) mirror into the local MySQL ledger (best-effort; never blocks approve)
    mysql_ledger.write(t, period)
    # 3) print the A4 record. Try silent (no pop-up) printing first; if this
    #    machine can't (no Selenium/Chrome), tell the client to open the print
    #    tab so a printout is never lost.
    printed = printing.print_html_async(_render_record_html(t, auto_print=False), tag="record")
    # 3b) if the CSV rolled over, print that backup batch the same way.
    if rollover:
        batch_html = _render_csv_batch_html(rollover, auto_print=False)
        if batch_html and printing.print_html_async(batch_html, tag="csvbatch"):
            rollover = None  # printed silently -> client should not open a tab
    # 4) keep full copy for printing + possible reversal, then delete from cloud
    _remember_handled(t)
    try:
        cloud.delete_tx(t["id"])   # removes the doc and its receipts/signature
    except Exception as e:
        app.logger.warning("cloud delete (approve) failed: %s", e)
    # 5) drop from queue
    STATE["all"] = [x for x in STATE["all"] if x["id"] != t["id"]]
    # printed=True -> client must NOT open a tab; printed=False -> fall back to it.
    return jsonify({"ok": True, "rollover": rollover, "printed": printed})


@app.route("/api/delete/<tx_id>", methods=["POST"])
def api_delete(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    _remember_handled(t)
    try:
        cloud.delete_tx(t["id"])   # removes the doc and its receipts/signature
    except Exception as e:
        app.logger.warning("cloud delete failed: %s", e)
    STATE["all"] = [x for x in STATE["all"] if x["id"] != t["id"]]
    return jsonify({"ok": True})


@app.route("/api/restore", methods=["POST"])
def api_restore():
    data = request.json or {}
    tx_id = data.get("id")
    status = data.get("status")
    snap = data.get("tx") or {}
    # Prefer the full cached transaction (has images); fall back to snapshot text.
    tx = STATE["handled"].pop(tx_id, None)
    if tx is None:
        tx = {
            "id": tx_id or "", "mission": snap.get("mission", "east"),
            "beneficiary": snap.get("beneficiary", ""), "accountCode": snap.get("accountCode", ""),
            "accountName": snap.get("accountName", ""), "description": snap.get("description", ""),
            "amount": int(snap.get("amount", 0) or 0), "currency": snap.get("currency", "XOF"),
            "method": snap.get("method", ""), "recordedAt": snap.get("recordedAt", ""),
            "receiptImage": "", "secondReceiptImage": "", "signature": snap.get("signature"),
        }
    if status == "committed":
        storage.remove_transaction(tx_id)   # undo the local record
    if not _find(tx["id"]):
        STATE["all"].insert(0, tx)
    return jsonify({"ok": True, "counts": _mission_counts(),
                    "mission": STATE["mission"], "queue": [_light(t) for t in _visible()]})


def _render_record_html(t, auto_print):
    """Render the A4 record for a transaction to an HTML string. `auto_print`
    adds the in-page window.print() trigger used by the visible-tab fallback;
    the silent printer drives printing itself and passes auto_print=False."""
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
        main_img=t.get("receiptImage", ""), wave_img=t.get("secondReceiptImage", ""),
        signature_svg=_signature_svg(t.get("signature")),
        auto_print=auto_print,
    )


@app.route("/print/<tx_id>")
def print_record(tx_id):
    t = _find_any(tx_id)
    if not t:
        abort(404)
    return _render_record_html(t, auto_print=True)


def _render_csv_batch_html(batch_id, auto_print):
    rows = storage.read_batch(batch_id)
    if not rows:
        return None
    return render_template("csv_batch.html", rows=rows, batch_id=batch_id,
                           count=len(rows), auto_print=auto_print)


@app.route("/print/csv-batch/<batch_id>")
def print_csv_batch(batch_id):
    html = _render_csv_batch_html(batch_id, auto_print=True)
    if html is None:
        abort(404)
    return html


def _open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}/")


def main():
    storage.init_db()
    load_queue()
    printing.warm_up()  # probe silent-print capability in the background
    port = 5000
    counts = _mission_counts()
    print(f"\n  Working Fund review: {len(STATE['all'])} transaction(s) "
          f"(East {counts['east']}, South {counts['south']}). "
          f"{'(DEMO data)' if not cloud.is_cloud() else ''}")
    print(f"  Open http://127.0.0.1:{port}/  (a browser tab should open automatically)\n")
    threading.Timer(1.0, _open_browser, args=(port,)).start()
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
