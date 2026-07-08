import base64

try:
    import fitz
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
    return ["data:image/png;base64," + base64.b64encode(p).decode("ascii")
            for p in _render_pngs(pdf_bytes, zoom, MAX_PAGES)]

def first_page_png(pdf_bytes, zoom=1.6):
    pages = _render_pngs(pdf_bytes, zoom, 1)
    return pages[0] if pages else b""
