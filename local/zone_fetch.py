import re
import base64
import urllib.request

KNOWN_SANTE_GID = {
    "1Jp4RffstqgIxuAb4CbBN0ikxA3nQO6tGv_p8J1bfrF4": 658531995,
    "1HZcQGjeLpC0F63PWoml_UaLfmwnv1MOCUHW71XvjMng": 658531995,
    "1Jx6putFazFdxYTLYwCoHS3nRQychHltsBN-4-760_PQ": 658531995,
    "1Cs-HVbIG3KN1RkxfGO445p07pwkzPKPbu1fW2feo9Uw": 658531995,
    "1-OLP-X8jbQm4NHlGDU7Vj8AkogOyL7HaloJBbYF6pY0": 658531995,
    "1NEtjRwH4CRz1zXC5oVfFhvEvyaUDeJs478SoMz0As_U": 658531995,
    "1104oolng2z9YJ5A3fkNAisaKl0ICdDIl2wieYtawXRQ": 2088481288,
    "1ZC4ksK9xMx56_aTOE_HIXr7NW5eNqk25tapPRac_j3s": 658531995,
    "1UKvvKByCMBaI0kgffLnjgSRXqmofp9jfBsa7RdQmY5w": 658531995,
    "1RUWhBEReDDza_KAOPzttHDLmt6QLklo5ix3-RVn70_Q": 658531995,
    "1rZkSwu2LYTCCQaPyf3XuhFBksfx6gk7t2yqY9aPFYwI": 658531995,
    "1_6O0avBkKAZuhQNURwcmgZq7ha5OLueFN0ImnToYjmQ": 658531995,
}

_SHEET_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,}$")
_TIMEOUT = 8
_UA = "Mozilla/5.0 (WorkingFund review portal)"
_gid_cache = {}

def _export_url(sheet_id, gid):
    return (f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=pdf&gid={gid}"
            "&portrait=true&fitw=true&gridlines=false&sheetnames=false&printtitle=false&pagenumbers=false")

def _open(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": _UA}), timeout=_TIMEOUT)

def _resolve_tab_gid(sheet_id, tab_name):
    if sheet_id in _gid_cache and tab_name in _gid_cache[sheet_id]:
        return _gid_cache[sheet_id][tab_name]
    try:
        with _open(f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit") as r:
            html = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    mapping = {}
    for m in re.finditer(r'\\"(\d+)\\",\[\{\\"1\\":\[\[\d+,\d+,\\"([A-Z][A-Z ]*)\\"\]', html):
        mapping[m.group(2).strip()] = int(m.group(1))
    _gid_cache[sheet_id] = mapping
    return mapping.get(tab_name)

def _resolve_gid(sheet_id, ztype):
    t = (ztype or "").lower()
    if t == "transport":
        return 0
    if t != "sante":
        return None
    if sheet_id in KNOWN_SANTE_GID:
        return KNOWN_SANTE_GID[sheet_id]
    return _resolve_tab_gid(sheet_id, "SANTE")

def fetch_pdf(sheet_id, ztype):
    if not sheet_id or not _SHEET_ID_RE.match(str(sheet_id)):
        return b""
    try:
        gid = _resolve_gid(sheet_id, ztype)
        if gid is None:
            return b""
        with _open(_export_url(sheet_id, gid)) as r:
            if "pdf" not in (r.headers.get("Content-Type", "") or ""):
                return b""
            return r.read() or b""
    except Exception:
        return b""

def fetch_pdf_data_url(sheet_id, ztype):
    pdf = fetch_pdf(sheet_id, ztype)
    return ("data:application/pdf;base64," + base64.b64encode(pdf).decode("ascii")) if pdf else ""
