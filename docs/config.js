// Working Fund — configuration
// ---------------------------------------------------------------------------
// The backend API base URL is fixed here. This is the stable Vercel production
// URL (NOT a per-deploy preview URL, which changes on every deploy and is also
// behind Vercel's auth wall). The portal always uses this — it cannot be
// changed from inside the app.
// ---------------------------------------------------------------------------
window.WORKINGFUND_CONFIG = {
  API_BASE_URL: "https://working-fund.vercel.app/api",
  CURRENCY: "XOF",       // West African CFA franc
  CURRENCY_DECIMALS: 0,  // XOF has no centimes -> whole numbers only
  DEFAULT_MISSION: "east" // "east" or "south" (remembered per device after first change)
};
