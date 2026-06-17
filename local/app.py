import base64
import threading
import webbrowser
from datetime import datetime

from flask import Flask, jsonify, request, render_template, Response, abort

import cloud
import storage
import mysql_ledger
import printing
import settings

app = Flask(__name__)

STATE = {"all": [], "mission": "east", "period": "000", "handled": {}}
MISSIONS = ("east", "south")
HANDLED_CAP = 60

METHOD_LABELS = {"cash": "ESPÈCES", "wave": "WAVE", "orange": "ORANGE"}

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
    docs = cloud.fetch_all()
    if docs is None:
        import demo_data
        docs = demo_data.SAMPLES
        app.logger.info("No MONGODB_URI, running in DEMO mode with sample data.")
    STATE["all"] = [_to_view(d) for d in docs]


def reload_queue():
    docs = cloud.fetch_all()
    if docs is None:
        return False
    handled = STATE["handled"]
    STATE["all"] = [v for v in (_to_view(d) for d in docs) if v["id"] not in handled]
    return True


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
    out["signature"] = t.get("signature")
    out["location"] = t.get("location")
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
        for k in list(STATE["handled"].keys())[:-HANDLED_CAP]:
            STATE["handled"].pop(k, None)


@app.route("/")
def index():
    return render_template("review.html")


@app.route("/api/state")
def api_state():
    try:
        reload_queue()
    except Exception as e:
        app.logger.warning("cloud refresh failed: %s", e)
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


@app.route("/api/similar/<tx_id>")
def api_similar(tx_id):
    t = _find_any(tx_id)
    if not t:
        return jsonify({"matches": []})
    matches = storage.find_similar(
        beneficiary=t.get("beneficiary", ""),
        amount=t.get("amount", 0),
        exclude_id=tx_id,
    )
    return jsonify({"matches": matches})


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


@app.route("/api/settings")
def api_get_settings():
    return jsonify({
        "mysql": settings.mysql_config(),
        "mysqlDriver": mysql_ledger.driver_available(),
        "balanceMode": settings.balance_mode(),
    })


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    data = request.json or {}
    if "balanceMode" in data:
        settings.set_balance_mode(data.get("balanceMode"))
    mysql = data.get("mysql")
    if mysql is not None:
        table = mysql.get("MYSQL_TABLE")
        if table not in (None, "") and not settings.valid_table_name(table):
            return jsonify({"error": "Table name may contain only letters, numbers, and underscores."}), 400
        mysql_out = settings.update(mysql)
    else:
        mysql_out = settings.mysql_config()
    return jsonify({"ok": True, "mysql": mysql_out, "balanceMode": settings.balance_mode()})


@app.route("/api/settings/test-mysql", methods=["POST"])
def api_test_mysql():
    mysql = (request.json or {}).get("mysql") or {}
    ok, message = mysql_ledger.test_connection(overrides=mysql)
    return jsonify({"ok": ok, "message": message})


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
    data = request.json or {}
    _apply_edits(t, data)
    period = STATE["period"]
    storage.save_signature(t["id"], t.get("signature"))
    storage.write_sqlite(t, period)
    storage.append_csv(t, period)
    rollover = storage.rollover_if_needed()
    mysql_ledger.write(t, period)
    # Drop any receipts the reviewer chose to leave off the printed record. Storage
    # never keeps the images, so this only affects what gets printed. Both the
    # server side render and the print tab fallback read this same copy in memory.
    exclude = set(data.get("excludeReceipts") or [])
    if "main" in exclude:
        t["receiptImage"] = ""
    if "second" in exclude:
        t["secondReceiptImage"] = ""
    # The reviewer can record a transaction without sending it to the printer
    # (Shift+Enter / "Approve, no print"). The database writes above still run;
    # we only skip the printer output and the client-side print-tab fallback.
    no_print = bool(data.get("noPrint"))
    if no_print:
        printed = True  # nothing was printed, but suppress the print-tab fallback
    else:
        printed = printing.print_html_async(_render_record_html(t, auto_print=False), tag="record")
    if rollover:
        batch_html = _render_csv_batch_html(rollover, auto_print=False)
        if batch_html:
            # Save a one-page PDF backup of the 100 archived rows, then also send
            # it to the printer if this machine can. Either may be unavailable;
            # the CSV in printed-batches/ is the durable copy regardless.
            printing.save_pdf_async(batch_html, storage.batch_pdf_path(rollover), tag="csvbatch")
            if no_print or printing.print_html_async(batch_html, tag="csvbatch"):
                rollover = None
    _remember_handled(t)
    try:
        cloud.delete_tx(t["id"])
    except Exception as e:
        app.logger.warning("cloud delete (approve) failed: %s", e)
    storage.delete_receipts(t["id"])
    STATE["all"] = [x for x in STATE["all"] if x["id"] != t["id"]]
    return jsonify({"ok": True, "rollover": rollover, "printed": printed})


@app.route("/api/delete/<tx_id>", methods=["POST"])
def api_delete(tx_id):
    t = _find(tx_id)
    if not t:
        abort(404)
    _remember_handled(t)
    try:
        cloud.delete_tx(t["id"])
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
        storage.remove_transaction(tx_id)
    if not _find(tx["id"]):
        STATE["all"].insert(0, tx)
    return jsonify({"ok": True, "counts": _mission_counts(),
                    "mission": STATE["mission"], "queue": [_light(t) for t in _visible()]})


# --- Working fund + dashboard ----------------------------------------------
# The fund balance = starting amount (per mission+period) minus every
# transaction. "recorded" mode counts only what is written to the DB; "all" also
# counts transactions still sitting in the review queue (cloud, not yet logged).

DASH_METHOD_LABELS = {"cash": "Cash", "wave": "Wave", "orange": "Orange Money"}


def _arg_mission():
    m = request.args.get("mission") or STATE["mission"]
    return m if m in MISSIONS else STATE["mission"]


def _pending_for(mission):
    return [t for t in STATE["all"] if t["mission"] == mission]


def _fund_summary(mission, period):
    mode = settings.balance_mode()
    recorded = storage.list_transactions(mission=mission, period=period)
    recorded_total = sum(int(r.get("amount") or 0) for r in recorded)
    pending = _pending_for(mission)
    pending_total = sum(int(t.get("amount") or 0) for t in pending)
    start = settings.fund_start(mission, period)
    spent = recorded_total + pending_total if mode == "all" else recorded_total
    return {
        "mission": mission, "period": period, "mode": mode, "currency": "XOF",
        "start": start,
        "recordedTotal": recorded_total, "recordedCount": len(recorded),
        "pendingTotal": pending_total, "pendingCount": len(pending),
        "spent": spent, "remaining": start - spent,
    }


def _dashboard_transactions(mission, period):
    txns = []
    for r in storage.list_transactions(mission=mission, period=period):
        d = dict(r)
        d["source"] = "recorded"
        txns.append(d)
    if settings.balance_mode() == "all":
        for t in _pending_for(mission):
            txns.append({
                "transaction_id": t["id"], "recorded_at": t.get("recordedAt", ""),
                "mission": t["mission"], "fund_period": period,
                "beneficiary": t.get("beneficiary", ""), "account_code": t.get("accountCode", ""),
                "account_name": t.get("accountName", ""), "description": t.get("description", ""),
                "amount": int(t.get("amount", 0) or 0), "currency": t.get("currency", "XOF"),
                "method": t.get("method", ""), "location": t.get("location"),
                "source": "pending",
            })
    return txns


@app.route("/api/fund")
def api_fund():
    return jsonify(_fund_summary(_arg_mission(), request.args.get("period") or STATE["period"]))


@app.route("/api/fund", methods=["POST"])
def api_set_fund():
    data = request.json or {}
    mission = data.get("mission") if data.get("mission") in MISSIONS else STATE["mission"]
    period = data.get("period") or STATE["period"]
    if "start" in data:
        try:
            settings.set_fund_start(mission, period, int(data.get("start") or 0))
        except (TypeError, ValueError):
            return jsonify({"error": "start must be a number"}), 400
    if "mode" in data:
        settings.set_balance_mode(data.get("mode"))
    return jsonify(_fund_summary(mission, period))


@app.route("/api/dashboard")
def api_dashboard():
    mission = _arg_mission()
    period = request.args.get("period") or STATE["period"]
    txns = _dashboard_transactions(mission, period)

    def bucket(key_fn):
        agg = {}
        for r in txns:
            k = (key_fn(r) or "").strip()
            b = agg.setdefault(k, {"key": k, "total": 0, "count": 0})
            b["total"] += int(r.get("amount") or 0)
            b["count"] += 1
        return agg

    by_account = sorted(bucket(lambda r: r.get("account_code")).values(),
                        key=lambda x: abs(x["total"]), reverse=True)
    for b in by_account:
        b["label"] = (b["key"] + " " + ACCOUNT_CODES.get(b["key"], "")).strip() or "(none)"
    by_method = sorted(bucket(lambda r: r.get("method")).values(),
                       key=lambda x: abs(x["total"]), reverse=True)
    for b in by_method:
        b["label"] = DASH_METHOD_LABELS.get(b["key"], b["key"] or "(none)")
    by_beneficiary = sorted(bucket(lambda r: r.get("beneficiary")).values(),
                            key=lambda x: abs(x["total"]), reverse=True)
    for b in by_beneficiary:
        b["label"] = b["key"] or "(none)"
    by_date = sorted(bucket(lambda r: str(r.get("recorded_at") or "")[:10]).values(),
                     key=lambda x: x["key"])
    for b in by_date:
        b["label"] = b["key"] or "(no date)"

    locations = []
    for r in txns:
        loc = r.get("location")
        if isinstance(loc, dict) and isinstance(loc.get("lat"), (int, float)) and isinstance(loc.get("lon"), (int, float)):
            locations.append({
                "lat": loc["lat"], "lon": loc["lon"], "accuracy": loc.get("accuracy"),
                "beneficiary": r.get("beneficiary", ""), "amount": int(r.get("amount") or 0),
                "recorded_at": r.get("recorded_at", ""), "source": r.get("source", ""),
            })

    return jsonify({
        "summary": _fund_summary(mission, period),
        "transactions": txns,
        "byAccount": by_account, "byMethod": by_method,
        "byBeneficiary": by_beneficiary, "byDate": by_date,
        "locations": locations,
        "accountCodes": ACCOUNT_CODES,
    })


@app.route("/api/transaction/<tx_id>", methods=["POST"])
def api_update_transaction(tx_id):
    data = request.json or {}
    fields = {}
    if "beneficiary" in data:
        fields["beneficiary"] = data["beneficiary"]
    if "description" in data:
        fields["description"] = data["description"]
    if "method" in data:
        fields["method"] = data["method"]
    if data.get("mission") in MISSIONS:
        fields["mission"] = data["mission"]
    if "recordedAt" in data:
        fields["recorded_at"] = data["recordedAt"]
    if "accountCode" in data:
        fields["account_code"] = data["accountCode"]
        if data["accountCode"] in ACCOUNT_CODES:
            fields["account_name"] = ACCOUNT_CODES[data["accountCode"]]
    if "amount" in data:
        fields["amount"] = data["amount"]
    if not storage.update_transaction(tx_id, fields):
        return jsonify({"error": "nothing to update"}), 400
    return jsonify({"ok": True})


@app.route("/dashboard")
def dashboard():
    mission = _arg_mission()
    period = request.args.get("period") or STATE["period"]
    return render_template("dashboard.html", mission=mission, period=period)


def _render_record_html(t, auto_print):
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
        db_id=t.get("id", ""),
        db_table=mysql_ledger.table_name(),
        fund_period=STATE["period"],
        printed_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        auto_print=auto_print,
    )


@app.route("/print/<tx_id>")
def print_record(tx_id):
    t = _find_any(tx_id)
    if not t:
        abort(404)
    return _render_record_html(t, auto_print=True)


def _fmt_date(iso):
    if not iso:
        return "—"
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%d %b %Y")
    except ValueError:
        return str(iso)[:10]


def _render_csv_batch_html(batch_id, auto_print):
    rows = storage.read_batch(batch_id)
    if not rows:
        return None
    start, end = storage.batch_date_range(rows)
    periods = sorted({(r.get("fund_period") or "").strip() for r in rows if (r.get("fund_period") or "").strip()})
    return render_template("csv_batch.html", rows=rows, batch_id=batch_id,
                           count=len(rows), auto_print=auto_print,
                           date_start=_fmt_date(start), date_end=_fmt_date(end),
                           periods=", ".join(periods) or "—")


@app.route("/print/csv-batch/<batch_id>")
def print_csv_batch(batch_id):
    html = _render_csv_batch_html(batch_id, auto_print=True)
    if html is None:
        abort(404)
    return html


def _open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}/")


def _find_free_port(preferred=5000):
    import socket
    for port in [preferred] + list(range(5001, 5051)):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            s.close()
    return preferred


def main():
    storage.init_db()
    load_queue()
    printing.warm_up()
    port = _find_free_port(5000)
    counts = _mission_counts()
    print(f"\n  Working Fund review: {len(STATE['all'])} transaction(s) "
          f"(East {counts['east']}, South {counts['south']}). "
          f"{'(DEMO data)' if not cloud.is_cloud() else ''}")
    if port != 5000:
        print(f"  (Port 5000 was busy, so using {port} instead.)")
    print(f"  Open http://127.0.0.1:{port}/  (a browser tab should open automatically)\n")
    threading.Timer(1.0, _open_browser, args=(port,)).start()
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
