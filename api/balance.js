const { getDb } = require("./_lib/db");
const { withCors, readBody } = require("./_lib/cors");

function docId(mission) {
  return "wave_balance_" + (mission === "south" ? "south" : "east");
}

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  try {
    const db = await getDb();
    const col = db.collection("system_settings");

    if (req.method === "PUT") {
      const body = readBody(req);
      const wave = Number(body.wave);
      const mission = body.mission === "south" ? "south" : "east";
      if (Number.isNaN(wave)) return res.status(400).json({ error: "wave must be a number" });
      await col.updateOne(
        { _id: docId(mission) },
        { $set: { value: wave, mission, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.json({ wave, mission });
    }

    if (req.method === "GET") {
      const mission = (req.query && req.query.mission === "south") ? "south" : "east";
      const doc = await col.findOne({ _id: docId(mission) });
      return res.json({ wave: doc ? doc.value : null, mission });
    }

    res.setHeader("Allow", "GET, PUT, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
