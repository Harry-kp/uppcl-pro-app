/**
 * Runs before anything imports the shared API client (see app/_layout.tsx).
 * Plugs the phone into shared/platform.ts: direct HTTPS to UPPCL (no CORS on
 * native, so no proxy), the session in an encrypted vault (key in the OS keystore), and PDFs to the share sheet.
 */
import "react-native-get-random-values"; // crypto.getRandomValues for @noble (wss AES IVs)
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import { configurePlatform, type KeyValueStore, type Upstream } from "@shared/platform";
import { UPPCL_BASE, WSS_BASE, uppclBrowserHeaders, wssHeaders } from "@shared/upstream";
import { newVaultKey, openJson, sealJson } from "@shared/crypto";
import { initDemo, mockFor } from "./demo";

const BASES: Record<Upstream, string> = {
  uppcl: `${UPPCL_BASE}/accounts/api`,
  bootstrap: `${UPPCL_BASE}/bootstrap/api`,
  wss: `${WSS_BASE}/uppclwss`,
  // UPPCL's 1912 complaint portal (Appsavy). Its session cookies ride the native cookie jar.
  complaints: "https://1912.uppcl.org",
};

function baseHeaders(upstream: Upstream): Record<string, string> {
  if (upstream === "wss") return wssHeaders();
  if (upstream === "complaints") return { origin: "https://1912.uppcl.org", referer: "https://1912.uppcl.org/UI/Form?FormId=4235" };
  return uppclBrowserHeaders();
}

// On-device store for the session, alert password and settings.
// Everything lives in ONE sealed file (AES-256-GCM); only its 32-byte key sits in the hardware keystore.
// Before, each value (and each 1.8 KB chunk of the session) was its own keystore decrypt — ~20 on a cold
// start, 50–150 ms each on older phones — which made startup lag. Values from that older layout are
// migrated the first time they're read, and the old keystore entries are then deleted.
const VAULT_KEY = "vault_key_v1";
const vaultFile = new File(Paths.document, "vault-v1.bin");
const LEGACY_CHECKED = "__legacy_checked"; // keys already looked up in the old layout (so we never look twice)

function loadVault(): { key: string; map: Record<string, string> } {
  let key = SecureStore.getItem(VAULT_KEY);
  if (!key) { key = newVaultKey(); SecureStore.setItem(VAULT_KEY, key); }
  try {
    if (vaultFile.exists) return { key, map: openJson<Record<string, string>>(key, vaultFile.textSync()) };
  } catch { /* unreadable (e.g. key reset): start empty; the user signs in again */ }
  return { key, map: {} };
}
const vault = loadVault();
const persist = () => { try { vaultFile.write(sealJson(vault.key, vault.map)); } catch { /* next write retries */ } };

/** The pre-vault layout: key → "<n>", key.0 … key.<n-1> (1.8 KB chunks). Read once per key, then removed. */
function legacyTake(key: string): string | null {
  const n = Number(SecureStore.getItem(key) ?? 0);
  if (n <= 0) return null;
  const value = Array.from({ length: n }, (_, i) => SecureStore.getItem(`${key}.${i}`) ?? "").join("");
  void SecureStore.deleteItemAsync(key);
  for (let i = 0; i < n; i++) void SecureStore.deleteItemAsync(`${key}.${i}`);
  return value;
}

const keystore: KeyValueStore = {
  getItem(key) {
    if (key in vault.map) return vault.map[key];
    const checked = (vault.map[LEGACY_CHECKED] ?? "").split("\n");
    if (checked.includes(key)) return null;
    const legacy = legacyTake(key);
    if (legacy !== null) vault.map[key] = legacy;
    vault.map[LEGACY_CHECKED] = [...checked.filter(Boolean), key].join("\n");
    persist();
    return legacy;
  },
  setItem(key, value) {
    if (vault.map[key] === value) return;
    vault.map[key] = value;
    persist();
  },
  removeItem(key) {
    if (!(key in vault.map)) return;
    delete vault.map[key];
    persist();
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

/** A payment that just succeeded: { amount, at }. Home says "Paid" instead of offering Pay again until UPPCL's
 *  balance catches up (it lags a few hours). Cleared once nothing is due, after 3 days, and on sign-out. */
export const JUST_PAID_KEY = "app_just_paid";

/** Last real name seen, for Home (v2: v1 could hold a test-scenario name). Cleared on sign-out and scenario switch. */
export const NAME_KEY = "app_display_name_v2";

/** Official UPPCL SMART site: recharges, bill payments and password resets happen there. */
export const UPPCL_SMART_URL = "https://uppcl.sem.jio.com/uppclsmart/";

// Sample data (demo mode, dev scenarios): answers requests while on, else the network.
initDemo(keystore);
configurePlatform({ mock: (key) => mockFor(key, { outcome: "success" }) });
