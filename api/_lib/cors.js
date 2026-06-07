const stripSlash = (o) => (o || "").replace(/\/+$/, "");

function pickAllowOrigin(req) {
  const configured = process.env.ALLOWED_ORIGIN;
  if (!configured || configured === "*") return "*";
  const allow = configured.split(",").map(stripSlash).filter(Boolean);
  const reqOrigin = req.headers && req.headers.origin;
  if (reqOrigin && allow.indexOf(stripSlash(reqOrigin)) !== -1) return reqOrigin;
  return allow[0] || "*";
}

function withCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", pickAllowOrigin(req));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

module.exports = { withCors, readBody };
