// Working Fund — configuration
// ---------------------------------------------------------------------------
// After you deploy your backend (Vercel/Cloudflare), put its base URL here.
//   Example: "https://my-workingfund-api.vercel.app/api"
//
// Leave it as "" to run in OFFLINE mode: submissions are queued safely on this
// phone (localStorage) and you can press "Sync now" once the backend is live.
//
// You can also set this from the in-app gear menu without editing this file.
// ---------------------------------------------------------------------------
window.WORKINGFUND_CONFIG = {
  API_BASE_URL: "",      // e.g. https://your-app.vercel.app/api
  CURRENCY: "XOF",       // West African CFA franc
  CURRENCY_DECIMALS: 0,  // XOF has no centimes -> whole numbers only
  DEFAULT_MISSION: "east" // "east" or "south" (remembered per device after first change)
};
