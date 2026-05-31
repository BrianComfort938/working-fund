// Shared CORS handling + body parsing for the API functions.
// The phone (GitHub Pages) and the API (Vercel) are different origins, so the
// browser requires these headers. Set ALLOWED_ORIGIN to your Pages URL in
// production; it defaults to "*" so things work before you lock it down.
function withCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
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
