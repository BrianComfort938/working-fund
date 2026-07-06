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


_DEMO_SIG = {
    "w": 240, "h": 90,
    "s": [[20, 60, 40, 30, 60, 60, 80, 35, 100, 62, 120, 40],
          [125, 55, 150, 52, 175, 56, 200, 50]],
}

_NOW = datetime(2026, 1, 19, 14, 30, tzinfo=timezone.utc)


def _demo_zone_pdf():
    """A small synthetic zone sheet (no real data) so the review portal can show
    and print a zone fund in DEMO mode. Returns PDF bytes, or None without PyMuPDF."""
    try:
        import fitz
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((60, 90), "DEMO ZONE SHEET", fontsize=26)
        page.insert_text((60, 140), "Cocody - Transport (sample data only)", fontsize=14)
        page.insert_text((60, 178), "FOND DE TRANSPORT / RAPPORT DE DEPENSES", fontsize=12)
        page.insert_text((60, 214), "This is not a real zone fund.", fontsize=12)
        data = doc.tobytes()
        doc.close()
        return data
    except Exception:
        return None

SAMPLES = [
    {
        "_id": "demo1", "mission": "east", "beneficiary": "Sister Mowkele",
        "accountCode": "02", "accountName": "400-5930 Food and Personal Items",
        "description": "Failed to withdraw sacred funds", "amount": 55000,
        "currency": "XOF", "method": "wave", "createdAt": _NOW,
        "receiptImage": _svg_receipt("MAIN", "#2e7d32"),
        "secondReceiptImage": _svg_receipt("WAVE", "#00618a"),
        "signature": _DEMO_SIG,
        "location": {"lat": 5.3599, "lon": -3.9880, "accuracy": 18, "at": "2026-01-19T14:29:00Z"},
    },
    {
        "_id": "demo2", "mission": "east", "beneficiary": "Elder Diallo",
        "accountCode": "17", "accountName": "000-5170 Vehicle Gasoline",
        "description": "Carburant pour la voiture de la mission", "amount": 30000,
        "currency": "XOF", "method": "cash", "createdAt": _NOW - timedelta(days=2),
        "receiptImage": _svg_receipt("MAIN", "#00618a"), "secondReceiptImage": "",
        "location": {"lat": 5.2884, "lon": -3.9500, "accuracy": 24, "at": "2026-01-17T10:05:00Z"},
    },
    {
        "_id": "demo3", "mission": "south", "beneficiary": "Soeur Kone",
        "accountCode": "05", "accountName": "400-5920 Charitable Assistance",
        "description": "Remboursement (retour de fonds au fonds)", "amount": -10000,
        "currency": "XOF", "method": "orange", "createdAt": _NOW - timedelta(days=5),
        "receiptImage": _svg_receipt("MAIN", "#e3811d"),
        "secondReceiptImage": _svg_receipt("ORANGE", "#e3811d"),
    },
    {
        "_id": "demo4", "mission": "south", "beneficiary": "Elder Traore",
        "accountCode": "14", "accountName": "000-5370 Telephone and Internet",
        "description": "Forfait internet du bureau", "amount": 20000,
        "currency": "XOF", "method": "wave", "createdAt": _NOW - timedelta(days=1),
        "receiptImage": _svg_receipt("MAIN", "#6a3d9a"),
        "secondReceiptImage": _svg_receipt("WAVE", "#00618a"),
        "signature": _DEMO_SIG,
    },
    {
        "_id": "demo5", "mission": "east", "beneficiary": "Elder Mensah",
        "accountCode": "00", "accountName": "400-5102 Travel In-field",
        "description": "Transport en commun pour un rendez-vous", "amount": 4500,
        "currency": "XOF", "method": "cash", "createdAt": _NOW + timedelta(minutes=3),
        "receiptImage": _svg_receipt("MAIN", "#2e7d32"), "secondReceiptImage": "",
        "location": {"lat": 5.3005, "lon": -3.9900, "accuracy": 30, "at": "2026-01-19T14:33:00Z"},
    },
    {
        "_id": "demo6", "mission": "east", "beneficiary": "Sister Abara",
        "accountCode": "13", "accountName": "000-5500 Miscellaneous",
        "description": "Petites fournitures de bureau", "amount": 8000,
        "currency": "XOF", "method": "cash", "createdAt": _NOW + timedelta(minutes=11),
        "receiptImage": _svg_receipt("MAIN", "#00618a"), "secondReceiptImage": "",
        "signature": _DEMO_SIG,
        "location": {"lat": 5.3240, "lon": -4.0180, "accuracy": 15, "at": "2026-01-19T14:41:00Z"},
    },
    {
        "_id": "demo7", "mission": "east", "beneficiary": "Zone — Cocody",
        "accountCode": "00", "accountName": "400-5102 Travel In-field",
        "description": "Zone transport fund (demo)", "amount": 45000,
        "currency": "XOF", "method": "cash", "createdAt": _NOW + timedelta(minutes=20),
        "receiptImage": "", "secondReceiptImage": "",
        "zoneFund": {"zone": "Cocody", "sheetId": "1-OLP-X8jbQm4NHlGDU7Vj8AkogOyL7HaloJBbYF6pY0", "type": "transport"},
        "zoneFundPdf": _demo_zone_pdf(),
        "location": {"lat": 5.3599, "lon": -3.9880, "accuracy": 20, "at": "2026-01-19T14:50:00Z"},
    },
    {
        "_id": "demo8", "mission": "east", "beneficiary": "Zone — Dokui",
        "accountCode": "00", "accountName": "400-5102 Travel In-field",
        "description": "Zone transport fund, fetched live (demo)", "amount": 38000,
        "currency": "XOF", "method": "cash", "createdAt": _NOW + timedelta(minutes=25),
        "receiptImage": "", "secondReceiptImage": "",
        # No stored PDF: the review portal fetches it live from the sheet on demand.
        "zoneFund": {"zone": "Dokui", "sheetId": "1NEtjRwH4CRz1zXC5oVfFhvEvyaUDeJs478SoMz0As_U", "type": "transport"},
    },
]
