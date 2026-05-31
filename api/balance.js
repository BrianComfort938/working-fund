// /api/balance
//   GET -> { wave: number|null }
//   PUT -> body { wave: number }, stores the absolute Wave balance
// The phone computes the new balance after a Wave payment and PUTs it here, so
// this endpoint is deliberately a simple store (single-user, no double-counting).
const { getDb } = require("./_lib/db");
const { withCors, readBody } = require("./_lib/cors");

const DOC_ID = "wave_balance";

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  try {
    const db = await getDb();
    const col = db.collection("system_settings");

    if (req.method === "PUT") {
      const body = readBody(req);
      const wave = Number(body.wave);
      if (Number.isNaN(wave)) return res.status(400).json({ error: "wave must be a number" });
      await col.updateOne(
        { _id: DOC_ID },
        { $set: { value: wave, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.json({ wave });
    }

    if (req.method === "GET") {
      const doc = await col.findOne({ _id: DOC_ID });
      return res.json({ wave: doc ? doc.value : null });
    }

    res.setHeader("Allow", "GET, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
