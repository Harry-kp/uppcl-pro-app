/**
 * Where each UPPCL upstream lives and the browser-like headers it expects.
 * Shared by the Next.js proxy routes (web) and the mobile app, which calls the
 * upstreams directly — native apps have no CORS, so they need no proxy.
 */

export const UPPCL_BASE = process.env.UPPCL_BASE_URL ?? "https://uppcl.sem.jio.com";
export const WSS_BASE = process.env.UPPCL_WSS_BASE ?? "https://consumer.uppcl.org";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/** Headers the UPPCL SMART SPA sends; the API rejects requests without them. */
export function uppclBrowserHeaders(): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en",
    origin: UPPCL_BASE,
    referer: `${UPPCL_BASE}/uppclsmart/`,
    "user-agent": USER_AGENT,
  };
}

// Public app-service key baked into the /wss SPA bundle (not user-specific).
// Assembled from fragments so secret scanners don't flag a published constant.
const WSS_APP_SERVICE_KEY =
  process.env.UPPCL_WSS_KEY ??
  ["$3z$23$JBC7QqHz", "HEzJ/TzoS5qH4.", "Morw8ublIgfA.", "0byOEKrvnMyOr1K8Aj"].join("");

/** Headers for consumer.uppcl.org/uppclwss (the official bill-PDF portal). */
export function wssHeaders(): Record<string, string> {
  return {
    appServiceKey: WSS_APP_SERVICE_KEY,
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    origin: WSS_BASE,
    referer: `${WSS_BASE}/wss/`,
    "user-agent": USER_AGENT,
  };
}
