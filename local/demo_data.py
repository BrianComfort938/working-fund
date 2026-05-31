"""Sample transactions used when MONGODB_URI is not set, so the review app is
fully testable without a cloud connection. Includes both missions so the
East/South filter is demonstrable."""
import base64
from datetime import datetime, timezone, timedelta


def _svg_receipt(label, color):
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="500">'
        '<rect width="100%" height="100%" fill="#ffffff" stroke="#bbbbbb" stroke-width="2"/>'
        f'<rect x="0" y="0" width="100%" height="70" fill="{color}"/>'
        f'<text x="190" y="46" font-family="Arial" font-size="26" fill="white" text-anchor="middle">{label}</text>'
        '<text x="190" y="170" font-family="Arial" font-size="22" fill="#333333" text-anchor="middle">DEMO RECEIPT</text>'
        '<text x="190" y="210" font-family="Arial" font-size="15" fill="#888888" text-anchor="middle">(sample data only)</text>'
        '</svg>'
    )
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return "data:image/svg+xml;base64," + b64


# Fixed base date so the demo is stable run-to-run.
_NOW = datetime(2026, 1, 19, 14, 30, tzinfo=timezone.utc)

SAMPLES = [
    {
        "_id": "demo1", "mission": "east", "beneficiary": "Sister Mowkele",
        "accountCode": "02", "accountName": "400-5930 Food and Personal Items",
        "description": "Failed to withdraw sacred funds", "amount": 55000,
        "currency": "XOF", "method": "wave", "createdAt": _NOW,
        "receiptImage": _svg_receipt("MAIN", "#22c55e"),
        "waveReceiptImage": _svg_receipt("WAVE", "#38bdf8"),
    },
    {
        "_id": "demo2", "mission": "east", "beneficiary": "Elder Diallo",
        "accountCode": "17", "accountName": "000-5170 Vehicle Gasoline",
        "description": "Carburant pour la voiture de la mission", "amount": 30000,
        "currency": "XOF", "method": "cash", "createdAt": _NOW - timedelta(days=2),
        "receiptImage": _svg_receipt("MAIN", "#3b82f6"), "waveReceiptImage": "",
    },
    {
        "_id": "demo3", "mission": "south", "beneficiary": "Soeur Kone",
        "accountCode": "05", "accountName": "400-5920 Charitable Assistance",
        "description": "Remboursement (retour de fonds au fonds)", "amount": -10000,
        "currency": "XOF", "method": "orange", "createdAt": _NOW - timedelta(days=5),
        "receiptImage": _svg_receipt("MAIN", "#f59e0b"), "waveReceiptImage": "",
    },
    {
        "_id": "demo4", "mission": "south", "beneficiary": "Elder Traore",
        "accountCode": "14", "accountName": "000-5370 Telephone and Internet",
        "description": "Forfait internet du bureau", "amount": 20000,
        "currency": "XOF", "method": "wave", "createdAt": _NOW - timedelta(days=1),
        "receiptImage": _svg_receipt("MAIN", "#a855f7"),
        "waveReceiptImage": _svg_receipt("WAVE", "#38bdf8"),
    },
]
