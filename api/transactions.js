const { Binary } = require("mongodb");
const { getDb } = require("./_lib/db");
const { withCors, readBody } = require("./_lib/cors");

const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

function cleanZoneFund(zf) {
  if (!zf || typeof zf !== "object") return null;
  const type = zf.type === "sante" ? "sante" : zf.type === "transport" ? "transport" : null;
  const sheetId = String(zf.sheetId || "");
  if (!type || !SHEET_ID_RE.test(sheetId)) return null;
  return { zone: String(zf.zone || "").slice(0, 60), sheetId, type };
}

function toBinary(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "";
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  try {
    return new Binary(Buffer.from(b64, "base64"));
  } catch (_) {
    return "";
  }
}

function cleanSignature(sig) {
  if (!sig || !Array.isArray(sig.s) || !sig.s.length) return null;
  const strokes = sig.s
    .filter((a) => Array.isArray(a) && a.length >= 2)
    .map((a) => a.map((n) => Math.round(Number(n) || 0)));
  if (!strokes.length) return null;
  return { w: Math.round(Number(sig.w) || 0), h: Math.round(Number(sig.h) || 0), s: strokes };
}

function cleanLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.lat), lon = Number(loc.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const out = { lat, lon };
  if (loc.accuracy != null && isFinite(Number(loc.accuracy))) out.accuracy = Math.round(Number(loc.accuracy));
  if (loc.at) out.at = String(loc.at).slice(0, 40);
  return out;
}

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  try {
    const db = await getDb();
    const col = db.collection("transactions");

    if (req.method === "POST") {
      const body = readBody(req);
      const doc = {
        mission: body.mission === "south" ? "south" : "east",
        beneficiary: body.beneficiary || "",
        accountCode: body.accountCode || "",
        accountName: body.accountName || "",
        description: body.description || "",
        amount: Number(body.amount) || 0,
        currency: body.currency || "XOF",
        method: body.method || "",
        receiptImage: toBinary(body.receiptImage),
        secondReceiptImage: toBinary(body.secondReceiptImage || body.waveReceiptImage),
        signature: cleanSignature(body.signature),
        location: cleanLocation(body.location),
        clientCreatedAt: body.clientCreatedAt || null,
        createdAt: new Date(),
        logged: false,
      };
      // Zone fund: the phone sends only {zone, sheetId, type}; fetch that tab as a
      // PDF from the (link-shared) Google Sheet and store it on the record. If the
      // fetch fails the transaction is still saved, flagged so the office can retry.
      const zf = cleanZoneFund(body.zoneFund);
      if (zf) {
        doc.zoneFund = zf;
        // The phone pre-fetches the sheet (async, when the zone fund is added) and
        // sends it here, so the POST never blocks on Google. If it isn't ready the
        // record keeps just the reference and the review portal fetches on demand.
        const pdf = toBinary(body.zoneFundPdf);
        if (pdf) doc.zoneFundPdf = pdf;
      }
      const r = await col.insertOne(doc);
      return res.status(201).json({ _id: r.insertedId, zoneFundPdf: !!doc.zoneFundPdf });
    }

    if (req.method === "GET") {
      const q = req.query || {};
      const all = q.all === "1" || q.all === "true";
      const query = all ? {} : { logged: { $ne: true } };
      if (q.mission === "east" || q.mission === "south") query.mission = q.mission;
      const docs = await col.find(query).sort({ createdAt: 1 }).toArray();
      return res.json(docs);
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
