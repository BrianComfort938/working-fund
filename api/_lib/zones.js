const KNOWN_SANTE_GID = {
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
};

const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const FETCH_TIMEOUT_MS = 8000;
const _gidCache = {};

const timeoutSignal = () =>
  (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined);

function exportUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=pdf&gid=${gid}` +
    "&portrait=true&fitw=true&gridlines=false&sheetnames=false&printtitle=false&pagenumbers=false";
}

async function resolveTabGid(sheetId, tabName) {
  if (_gidCache[sheetId] && tabName in _gidCache[sheetId]) return _gidCache[sheetId][tabName];
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, { redirect: "follow", signal: timeoutSignal() });
  if (!r.ok) return null;
  const html = await r.text();
  const rx = /\\"(\d+)\\",\[\{\\"1\\":\[\[\d+,\d+,\\"([A-Z][A-Z ]*)\\"\]/g;
  const map = {};
  let m;
  while ((m = rx.exec(html))) map[m[2].trim()] = Number(m[1]);
  _gidCache[sheetId] = map;
  return map[tabName] != null ? map[tabName] : null;
}

async function resolveGid(sheetId, type) {
  const t = String(type || "").toLowerCase();
  if (t === "transport") return 0;
  if (t !== "sante") return null;
  if (KNOWN_SANTE_GID[sheetId] != null) return KNOWN_SANTE_GID[sheetId];
  try { return await resolveTabGid(sheetId, "SANTE"); } catch (_) { return null; }
}

async function fetchZonePdf(sheetId, type) {
  if (!SHEET_ID_RE.test(String(sheetId || ""))) return null;
  try {
    const gid = await resolveGid(sheetId, type);
    if (gid == null) return null;
    const r = await fetch(exportUrl(sheetId, gid), { redirect: "follow", signal: timeoutSignal() });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.indexOf("pdf") === -1) return null;
    const buffer = Buffer.from(await r.arrayBuffer());
    return buffer.length ? { buffer, gid } : null;
  } catch (_) {
    return null;
  }
}

module.exports = { fetchZonePdf, resolveGid, exportUrl };
