"""Rasterize a stored zone-fund PDF into full-page PNGs for printing.

The zone sheet is fetched as a PDF by the API and stored on the transaction. To
print it "as a full page" through the same silent HTML->Chrome pipeline as every
other record, each PDF page is rendered to a PNG and dropped onto a full A4 page.
PyMuPDF (fitz) is optional; without it the portal falls back to opening the PDF.
"""
import base64

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

MAX_PAGES = 4


def available():
    return fitz is not None


def _render_pngs(pdf_bytes, zoom, limit):
    if not fitz or not pdf_bytes:
        return []
    out = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            for i, page in enumerate(doc):
                if i >= limit:
                    break
                out.append(page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png"))
        finally:
            doc.close()
    except Exception:
        return []
    return out


def pages_to_png_data_urls(pdf_bytes, zoom=2.0):
    """Return a list of data: PNG URLs, one per page (capped). [] if unavailable."""
    return ["data:image/png;base64," + base64.b64encode(p).decode("ascii")
            for p in _render_pngs(pdf_bytes, zoom, MAX_PAGES)]


def first_page_png(pdf_bytes, zoom=1.6):
    """Raw PNG bytes of the first page (for an inline thumbnail). b'' if unavailable."""
    pages = _render_pngs(pdf_bytes, zoom, 1)
    return pages[0] if pages else b""
