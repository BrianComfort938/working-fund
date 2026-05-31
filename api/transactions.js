// /api/transactions
//   POST -> create a new (unlogged) transaction
//   GET  -> list unlogged transactions (what the local script pulls); ?all=1 = everything
const { getDb } = require("./_lib/db");
const { withCors, readBody } = require("./_lib/cors");

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
        receiptImage: body.receiptImage || "",
        waveReceiptImage: body.waveReceiptImage || "",
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
