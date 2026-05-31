// /api/transactions
//   POST -> create a new (unlogged) transaction
//   GET  -> list unlogged transactions (what the local script pulls); ?all=1 = everything
const { Binary } = require("mongodb");
const { getDb } = require("./_lib/db");
const { withCors, readBody } = require("./_lib/cors");

// Receipts arrive as compressed JPEG data URLs. Storing the raw bytes as BSON
// Binary (instead of the Base64 string) is ~33% smaller and keeps the free-tier
// 512 MB going much further. Returns a Binary, or "" when there is no image.
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

// Keep only valid, compact signature data: integer-rounded stroke coordinates.
function cleanSignature(sig) {
  if (!sig || !Array.isArray(sig.s) || !sig.s.length) return null;
  const strokes = sig.s
    .filter((a) => Array.isArray(a) && a.length >= 2)
    .map((a) => a.map((n) => Math.round(Number(n) || 0)));
  if (!strokes.length) return null;
  return { w: Math.round(Number(sig.w) || 0), h: Math.round(Number(sig.h) || 0), s: strokes };
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
        clientCreatedAt: body.clientCreatedAt || null,
        createdAt: new Date(),     // authoritative server timestamp
        logged: false,
      };
      const r = await col.insertOne(doc);
      return res.status(201).json({ _id: r.insertedId });
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
