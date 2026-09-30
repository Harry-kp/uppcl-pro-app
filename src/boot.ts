/**
 * Runs before anything imports the shared API client (see app/_layout.tsx).
 * Plugs the phone into shared/platform.ts: direct HTTPS to UPPCL (no CORS on
 * native, so no proxy), the session in the OS keystore, and PDFs to the share sheet.
 */
import "react-native-get-random-values"; // crypto.getRandomValues for @noble (wss AES IVs)
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import { configurePlatform, type KeyValueStore, type Upstream } from "@shared/platform";
import { UPPCL_BASE, WSS_BASE, uppclBrowserHeaders, wssHeaders } from "@shared/upstream";

const BASES: Record<Upstream, string> = {
  uppcl: `${UPPCL_BASE}/accounts/api`,
  bootstrap: `${UPPCL_BASE}/bootstrap/api`,
  wss: `${WSS_BASE}/uppclwss`,
  // The 1912 complaint portal needs server-side cookie juggling across redirects,
  // which RN's fetch can't do — keep using the deployed web route (anonymous, no user creds).
  complaints: "https://uppcl-pro.vercel.app/api/complaints",
};

function baseHeaders(upstream: Upstream): Record<string, string> {
  if (upstream === "wss") return wssHeaders();
  if (upstream === "complaints") return {};
  return uppclBrowserHeaders();
}

// SecureStore values over ~2 KB may fail, and the session holds the whole site
// record, so values are split into chunks: key → "<n>", key.0 … key.<n-1>.
// A memory cache keeps reads synchronous and removals immediate.
const CHUNK = 1800;
const cache = new Map<string, string | null>();

const keystore: KeyValueStore = {
  getItem(key) {
    if (cache.has(key)) return cache.get(key) ?? null;
    const n = Number(SecureStore.getItem(key) ?? 0);
    const value = n > 0 ? Array.from({ length: n }, (_, i) => SecureStore.getItem(`${key}.${i}`) ?? "").join("") : null;
    cache.set(key, value);
    return value;
  },
  setItem(key, value) {
    const old = Number(SecureStore.getItem(key) ?? 0);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) SecureStore.setItem(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < old; i++) void SecureStore.deleteItemAsync(`${key}.${i}`);
    SecureStore.setItem(key, String(n));
    cache.set(key, value);
  },
  removeItem(key) {
    const old = Number(SecureStore.getItem(key) ?? 0);
    cache.set(key, null);
    void SecureStore.deleteItemAsync(key);
    for (let i = 0; i < old; i++) void SecureStore.deleteItemAsync(`${key}.${i}`);
  },
};

configurePlatform({
  request(upstream, path, init) {
    const url = BASES[upstream] + (path.startsWith("?") ? path : `/${path}`);
    // A hung upstream (the 1912 portal often is) used to leave "Loading…" up for ~50 s; give up at 30 s
    // so the screen's own error + retry shows. UPPCL's slowest normal calls take ~10 s.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    return fetch(url, { signal: abort.signal, ...init, headers: { ...baseHeaders(upstream), ...(init?.headers as Record<string, string>) } })
      .finally(() => clearTimeout(timer));
  },
  storage: keystore,
  // Open inside the app (app/pdf.tsx); sharing is one tap from there.
  async savePdf(base64, filename) {
    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    router.push({ pathname: "/pdf", params: { uri: file.uri, name: filename } });
  },
});

export { keystore };

/** "1" when the user turned on fingerprint unlock (Help → Settings). */
export const FINGERPRINT_KEY = "app_fingerprint";

/** Last real name seen, for Home (v2: v1 could hold a test-scenario name). Cleared on sign-out and scenario switch. */
export const NAME_KEY = "app_display_name_v2";

/** Official UPPCL SMART site: recharges, bill payments and password resets happen there. */
export const UPPCL_SMART_URL = "https://uppcl.sem.jio.com/uppclsmart/";

if (__DEV__) (require("./dev") as typeof import("./dev")).install(); // @dev-tools: fake-data test scenarios (src/dev)
