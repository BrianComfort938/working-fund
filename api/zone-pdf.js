const { withCors } = require("./_lib/cors");
const { fetchZonePdf } = require("./_lib/zones");

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  const q = req.query || {};
  try {
    const pdf = await fetchZonePdf(q.sheetId, q.type);
    if (!pdf) return res.status(502).json({ error: "Could not fetch the sheet." });
    return res.json({
      pdf: "data:application/pdf;base64," + pdf.buffer.toString("base64"),
      gid: pdf.gid,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
