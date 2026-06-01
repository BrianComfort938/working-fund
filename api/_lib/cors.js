// Shared CORS handling + body parsing for the API functions.
// The phone (GitHub Pages) and the API (Vercel) are different origins, so the
// browser requires these headers. Set ALLOWED_ORIGIN to your Pages URL in
// production (a comma-separated list is allowed); it defaults to "*" so things
// work before you lock it down.
const stripSlash = (o) => (o || "").replace(/\/+$/, "");

// Pick the Access-Control-Allow-Origin value. Browsers require an EXACT match
// against their own Origin, so we compare ignoring any trailing slash (a slash
// left on the env var is a common mistake) and echo the caller's exact Origin
// back when it is on the allowlist.
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
    return true; // request handled (preflight)
  }
  return false;
}

function readBody(req) {
  if (!req.body) return {};
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

module.exports = { withCors, readBody };
