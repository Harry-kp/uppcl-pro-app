/**
 * UPPCL SMART API client — runs entirely on the user's device (browser or phone).
 *
 * The JWT never leaves the device (see session.ts). On web, requests go through
 * the stateless CORS-bypass routes at /api/*; the mobile app calls UPPCL
 * directly (see platform.ts).
 *
 * UPPCL dropped RSA-OAEP + AES-GCM encryption — all endpoints accept
 * plaintext JSON now. Only ALTCHA proof-of-work is still needed for login.
 */
import useSWR, { mutate as defaultMutate, unload as defaultUnload, type ScopedMutator, type Unloader } from "swr";
import { newSealKey, sealBody, solveAltcha, wssEncrypt, wssDecrypt, type AltchaChallenge } from "./crypto";
import { platform } from "./platform";
import { complaintDetail, complaints, connected1912, forget1912 } from "./complaints";
import { billingPeriod, indiaTime } from "./utils";
import {
  getSession,
  saveSession,
  clearSession,
  expireSession,
  isAuthenticated,
  getJwt,
  getSite,
  setSite,
  jwtExpiresInDays,
  type SiteRecord,
} from "./session";

// The app's SWR cache is a provider (src/cache.ts). `mutate`/`unload` imported from "swr" act on SWR's
// default cache, which no screen reads: sign-in/out waited for the 60 s /health poll because of that.
// The Gate binds these to the provider's (useSWRConfig) on its first render.
let bound: { mutate: ScopedMutator; unload: Unloader } = { mutate: defaultMutate, unload: defaultUnload };
export function bindSwr(b: { mutate: ScopedMutator; unload?: Unloader }) { bound = { mutate: b.mutate, unload: b.unload ?? defaultUnload }; }
/** Use this, never `mutate` from "swr". */
export const mutate = ((...args: Parameters<ScopedMutator>) => bound.mutate(...args)) as ScopedMutator;
/** Drop every cached response and tell mounted screens. */
export const unloadAll: Unloader = (o) => bound.unload(o);

// ─── Constants ────────────────────────────────────────────────────────────────

// NOT a secret — this is a public client ID baked into UPPCL's own JavaScript
// bundle at uppcl.sem.jio.com. Every user of the official UPPCL SMART website
// sends this same key. It identifies the app, not the user.
const UPPCL_API_KEY = "5ab6ef2e-5051-4923-aa65-dc82883af26b";
const DEFAULT_TENANT = "b3ba0ab0-05bc-11f0-bf77-932b3a8bb3cd";
const IST_OFFSET = "+05:30";

function ist(d: Date): string {
  return `${d.toISOString().split("T")[0]}T00:00:00${IST_OFFSET}`;
}

/** End-of-day IST timestamp — UPPCL's eventsummary `to` wants 23:59:59, not 00:00:00. */
function istEnd(d: Date): string {
  return `${d.toISOString().split("T")[0]}T23:59:59${IST_OFFSET}`;
}

/** Human date like "01 Jun 2025" — the format bill/billHistory expects for from/to. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function humanDate(d: Date): string {
  // Not toLocaleDateString: newer ICU (Hermes) writes "Sept"; UPPCL's own site sends "Sep" (moment "DD MMM YYYY").
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function tenantHeader(tenant: string): string {
  return JSON.stringify({ isMultiLevel: true, code: tenant });
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─── Error class ──────────────────────────────────────────────────────────────

/** Which UPPCL system a request went to; "app" = our own code failed, not UPPCL. */
export type ErrorSource = "uppcl" | "wss" | "complaints" | "app";
/** network = no answer · session = signed out · upstream = UPPCL answered with an error · app = our bug. */
export type ErrorKind = "network" | "session" | "upstream" | "app";

export class ProxyError extends Error {
  status: number;
  upstream?: unknown;
  /** Where it failed, UPPCL's own words (before we reword them), and when: for "their bug or ours?". */
  source: ErrorSource;
  reason: string;
  at: string;
  kind: ErrorKind;
  constructor(status: number, message: string, upstream?: unknown, source: ErrorSource = "uppcl", kind?: ErrorKind) {
    super(humanizeError(status, message));
    this.status = status;
    this.upstream = upstream;
    this.source = source;
    this.reason = message;
    this.at = new Date().toISOString();
    this.kind = kind ?? (status === 0 ? "network" : status === 401 ? "session" : "upstream");
  }
}

/** Every network call goes through here, so "no connection" is a tagged error, not a raw TypeError. */
// UPPCL SMART seals these request bodies since Nov 2026 (their web app's list, the paths the app calls; "?" ignored).
const SEALED = [/^auth\/v2\/login$/, /^auth\/v2\/login\/otp$/, /^auth\/v2\/login\/token\/verify$/, /^bill\/(search|billDetails|billHistory)$/, /^site\/v2\/prepaidBalance$/, /^user\/search$/,
  /^payment\/(initiate-payment|quick-payment|doubleVerification)$/, /^payment\/v2\/(create|search)$/];
// UPPCL's published sealing key (prod, from their web bundle); not a secret.
const UPPCL_SEAL_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4tUP/Y8AORlBkw4dNyHFa3nG67eWC86qtURhu+Ec43H/ovn+TZMC9IGO4EStSR3U/3cGImsLp4ZtHLKgwX6QwjgA2o5SQRadBsiQp3tP4cOadfNBMVxrlG1FDHqlqlu470acKQ6NNKKLFsInao2YGoXcJ9yTLHVTeT4x1RbAtEubeNhCgEjoBVHufItQmGRLiS9J0H4dlCXmR9SjjI17O6u6uODk5ph+GvQtDnCuGt8XEIMjuOu2Q65RTiG1OH7NhIM99Oe3KoBwno/9XUgxlvE/64ReRcAAFabrhuAHGyHBA5+wjT5TXcYY5d0z5s8ZRM4ce7uC57wBYOJX9XuBEQIDAQAB";
let sealKey: Promise<{ kid: string; key: Uint8Array }> | null = null;

/** Registers a sealing key with UPPCL once (per app run, and again if UPPCL forgets it). */
function sealSession(): Promise<{ kid: string; key: Uint8Array }> {
  sealKey ??= (async () => {
    const k = newSealKey(UPPCL_SEAL_PUBLIC_KEY);
    const r = await platform.request("uppcl", "crypto/session-key", {
      method: "POST", cache: "no-store", body: JSON.stringify({ kid: k.kid, wrappedKey: k.wrappedKey }),
      headers: { "content-type": "application/json", apikey: UPPCL_API_KEY },
    });
    if (!r.ok) throw new ProxyError(r.status, `UPPCL encryption handshake failed (HTTP ${r.status})`, undefined, "uppcl");
    return { kid: k.kid, key: k.key };
  })().catch((e) => { sealKey = null; throw e; });
  return sealKey;
}

async function sealed(path: string, init: RequestInit & { body: string }, retried = false): Promise<Response> {
  const { kid, key } = await sealSession();
  const r = await platform.request("uppcl", path, {
    ...init, body: sealBody(key, init.body), headers: { ...(init.headers as Record<string, string>), "x-enc-kid": kid },
  });
  if (r.status === 409 && !retried && (await r.clone().text()).includes("ENC_KEY_UNKNOWN")) {
    sealKey = null; // UPPCL dropped our key (restart, expiry): register a new one, once
    return sealed(path, init, true);
  }
  return r;
}

export async function send(upstream: "uppcl" | "bootstrap" | "wss" | "complaints", path: string, init?: RequestInit): Promise<Response> {
  try {
    if (upstream === "uppcl" && typeof init?.body === "string" && SEALED.some((p) => p.test(path.split("?")[0])))
      return await sealed(path, init as RequestInit & { body: string });
    return await platform.request(upstream, path, init);
  } catch (e) {
    // A failure of the network call itself means "no answer": the classic TypeError, our 30 s abort, or
    // expo/fetch's "fetch failed: java.net.UnknownHostException …". Anything else is our own bug and must
    // surface as one, not be dressed up as a network problem (e.g. the send() recursion, BUG-069).
    const name = (e as Error)?.name, text = String((e as Error)?.message ?? "");
    const isNetwork = name === "TypeError" || name === "AbortError"
      || /fetch failed|network|unknownhost|unable to resolve|timed? ?out|timeout|econn|ssl|socket|failed to connect|connection/i.test(text);
    if (!isNetwork) throw e;
    const msg = name === "AbortError" ? "timeout: no answer in time" : (e as Error).message || "network request failed";
    throw new ProxyError(0, msg, undefined, upstream === "bootstrap" ? "uppcl" : upstream, "network");
  }
}

/** Map developer-facing upstream errors to messages a normal user can act on. */
function humanizeError(status: number, raw: string): string {
  const lower = raw.toLowerCase();
  if (status === 401 || status === 403) return "Session expired. Please sign in again.";
  if (lower.includes("tenant id is missing")) return "Could not load your data. Try signing out and back in.";
  if (lower.includes("missing login params")) return "Login failed. Please check your credentials.";
  if (lower.includes("wrong captcha")) return "Verification failed. Please try again.";
  // UPPCL says "Incorrect Username or Password." (HTTP 409) on a bad login.
  if (/(invalid|incorrect) (credentials|username|password)/.test(lower)) return "Invalid username or password.";
  // A 5xx gateway status means our proxy was reached and the *upstream* failed
  // (its "fetch failed" text is server-side) — don't blame the user's internet.
  if (status === 502 || status === 503 || status === 504) return "UPPCL servers are temporarily unavailable. Try again in a few minutes.";
  if (lower.includes("network") || lower.includes("fetch failed")) return "Network error — check your internet connection.";
  if (lower.includes("timeout")) return "Request timed out. UPPCL servers may be slow — try again.";
  if (status === 409) return "Request rejected by UPPCL. Try signing out and back in.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "Something went wrong on UPPCL's end. Try again later.";
  return raw;
}

// ─── Core: POST to UPPCL via our CORS-proxy route ────────────────────────────
// UPPCL dropped encryption — all endpoints accept plaintext JSON now.

/**
 * Call a UPPCL API base via our CORS-proxy route. POST with a JSON body, or
 * GET when `body` is null (a few endpoints — e.g. downtime — are GET-only).
 * `base` selects the upstream: "uppcl" → /accounts/api, "bootstrap" → /bootstrap/api.
 * `extraHeaders` lets callers add e.g. `subtenantcode` (needed by bill/download, insight).
 */
/** Old sign-ins carried a JWT; since Nov 2026 the sign-in rides cookies only, sent by the phone itself. */
function authHeaders(): Record<string, string> {
  const jwt = getJwt();
  return jwt ? { token: jwt, authorization: `Bearer ${jwt}` } : {};
}

let refreshing: Promise<boolean> | null = null;
/** Renews UPPCL's access cookie (POST auth/refresh with the refresh cookie); one at a time, true if it worked. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send("uppcl", "auth/refresh", {
    method: "POST", cache: "no-store", body: "{}", headers: { "content-type": "application/json", apikey: UPPCL_API_KEY },
  }).then((r) => r.ok, () => false).finally(() => { refreshing = null; });
  return refreshing;
}

async function proxy(
  base: "uppcl" | "bootstrap",
  path: string,
  body: Record<string, unknown> | null,
  extraHeaders?: Record<string, string>,
  method?: "PUT" | "DELETE",
): Promise<unknown> {
  const session = getSession();
  if (!session) throw new ProxyError(401, "No active session — sign in first");

  const call = () => send(base, path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      apikey: UPPCL_API_KEY,
      tenantid: tenantHeader(session.tenant),
      ...authHeaders(),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let r = await call();
  // UPPCL's access cookie is short-lived: renew it with the refresh cookie and try once more (their web app does the same).
  if (r.status === 401 && await refreshSession()) r = await call();

  if (r.status === 200) {
    return JSON.parse(await r.text(), indiaTime);
  }

  if (r.status === 401 || r.status === 403) {
    expireSession();
    // Immediately tell Shell to show the login gate (don't wait for 60s poll)
    void mutate("/health");
    throw new ProxyError(401, "Session expired — sign in again");
  }

  const text = await r.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  // UPPCL's `message` is sometimes an object ({ message } / { error }), which used to print as "[object Object]".
  let m: unknown = typeof parsed === "object" && parsed && "message" in parsed ? (parsed as { message: unknown }).message : text;
  for (let i = 0; i < 4 && m && typeof m === "object"; i++) {
    const o = m as { message?: unknown; error?: unknown };
    m = o.message ?? o.error ?? JSON.stringify(m); // nested { message: { message: … } }: dig to the text
  }
  const msg = String(m ?? "").slice(0, 200);
  throw new ProxyError(r.status, msg, parsed);
}

async function uppcl_post(
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  return proxy("uppcl", path, body, extraHeaders);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * UPPCL's sign-in needs a solved ALTCHA proof-of-work first: up to 100k SHA-256s, ~7 s on average and up to
 * ~14 s on a 2018 phone. It doesn't depend on the username or password, so the sign-in screen calls this as
 * soon as it opens and the work happens while the user types. A token is used once and kept for 4 minutes.
 */
let captcha: { at: number; token: Promise<string>; done: boolean } | null = null;
const CAPTCHA_TTL = 4 * 60_000;

export function prepareSignIn(): Promise<unknown> {
  if (captcha && Date.now() - captcha.at < CAPTCHA_TTL) return captcha.token.catch(() => {});
  const token = (async () => {
    const r = await send("uppcl", "altcha/createAltCaptcha", {
      headers: { apikey: UPPCL_API_KEY, tenantid: tenantHeader(DEFAULT_TENANT) },
      cache: "no-store",
    });
    if (!r.ok) throw new ProxyError(r.status, "Failed to fetch ALTCHA challenge");
    return solveAltcha((await r.json()) as AltchaChallenge);
  })();
  const entry = { at: Date.now(), token, done: false };
  token.then(() => { entry.done = true; }, () => { if (captcha === entry) captcha = null; }); // failed prep: redone at sign-in
  captcha = entry;
  return token.catch(() => {});
}

/** False while UPPCL's sign-in check is still being worked out (the button says "Getting ready…"). */
export function signInReady(): boolean {
  return !!captcha?.done && Date.now() - captcha.at < CAPTCHA_TTL;
}

/** One solved ALTCHA per call; the next one starts solving at once, so a send → verify pair rarely waits. */
async function takeCaptcha(): Promise<string> {
  void prepareSignIn(); // no-op if the screen already started it
  const token = await captcha!.token;
  captcha = null;
  return token;
}

/** A pre-sign-in call to UPPCL SMART (OTP send / verify, sign-up): captcha header, JSON body, UPPCL's own reason on failure. */
async function signInCall(path: string, body: Record<string, unknown>): Promise<Response> {
  const captchaToken = await takeCaptcha();
  void prepareSignIn(); // ready for the next step (verify / resend)
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try {
    const r = await send("uppcl", path, {
      method: "POST", cache: "no-store", signal: abort.signal, body: JSON.stringify(body),
      headers: { "content-type": "application/json", apikey: UPPCL_API_KEY, tenantid: tenantHeader(DEFAULT_TENANT), captchatoken: captchaToken },
    });
    if (r.ok) return r;
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    const msg = typeof parsed === "object" && parsed ? (parsed as { message?: unknown }).message : null;
    throw new ProxyError(r.status, msg ? String(msg) : `UPPCL answered HTTP ${r.status}`, parsed, "uppcl");
  } finally { clearTimeout(timer); }
}

// ─── Sign in with a code (UPPCL SMART, Nov 2026) ─────────────────────────────
// auth/v2/login/otp texts (or emails) a 6-digit code; auth/v2/login/token/verify signs in exactly like the password does.
// A number with no SMART login: 409 "No account found … Please Sign Up" (isNoAccount).
export type CodeTo = { phone: string } | { email: string };
const codeTo = (to: CodeTo) => ("phone" in to ? { phone: to.phone, phoneCountryCode: "+91" } : { email: to.email.trim().toLowerCase() });

export async function sendSignInCode(to: CodeTo): Promise<void> {
  await signInCall("auth/v2/login/otp", codeTo(to));
}
export async function verifySignInCode(to: CodeTo, otp: string): Promise<void> {
  finishSignIn(await (await signInCall("auth/v2/login/token/verify", { ...codeTo(to), otp, roleType: "user" })).json());
}
/** UPPCL has no SMART login for this number / email. */
export const isNoAccount = (e: unknown) => e instanceof ProxyError && /no account found|sign ?up/i.test(e.reason);

// ─── Create a SMART login from the account number on the bill ────────────────
// userMasterData/signup-by-connectionId texts a code to the mobile UPPCL has for that account; .../verify sets the password.
export async function sendSignUpCode(account: string): Promise<{ mobile: string | null }> {
  const j = await (await signInCall("userMasterData/signup-by-connectionId", { consumer_id: account, returnUserDetails: true })).json();
  const d = (j?.data ?? {}) as Record<string, unknown>;
  // UPPCL returns the details masked or not; only the last 4 digits are ever shown.
  const mobile = String(d.phone ?? d.mobile ?? d.mobileNumber ?? "").replace(/\D/g, "").slice(-4);
  return { mobile: mobile.length === 4 ? mobile : null };
}
export async function createSignIn(otp: string, password: string): Promise<void> {
  await signInCall("userMasterData/signup-by-connectionId/verify", { token: otp, newPassword: password, confirmPassword: password });
}
/** UPPCL doesn't know the account number typed for sign-up (409 "Connection Id not found."). */
export const isUnknownAccount = (e: unknown) => e instanceof ProxyError && /connection ?id not found|not found/i.test(e.reason);
/** Sign-up refused because this account already has a SMART login. */
export const isAlreadyRegistered = (e: unknown) => e instanceof ProxyError && /already (exist|registered)|already have/i.test(e.reason);

export async function login(username: string, password: string): Promise<void> {
  void prepareSignIn(); // no-op if the screen already started it
  const captchaToken = await captcha!.token;
  captcha = null; // one token per sign-in attempt
  // UPPCL SMART's sign-in can take far longer than its data calls; don't give up at the usual 30 s.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try { return await loginSteps(username, password, captchaToken, abort.signal); }
  catch (e) { void prepareSignIn(); throw e; } // ready for the retry; never after a success (it costs seconds of CPU)
  finally { clearTimeout(timer); }
}

async function loginSteps(username: string, password: string, captchaToken: string, signal: AbortSignal): Promise<void> {
  // 3. Send plaintext login (UPPCL login endpoint does not use encryption)
  const r = await send("uppcl", "auth/v2/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: UPPCL_API_KEY,
      tenantid: tenantHeader(DEFAULT_TENANT),
      captchatoken: captchaToken,
    },
    body: JSON.stringify({ username, password, roleType: "user" }),
    cache: "no-store",
    signal,
  });

  if (r.status === 200) return finishSignIn(await r.json());

  const text = await r.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  const msg =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>).message ?? (parsed as Record<string, unknown>).error
      : null;
  throw new ProxyError(
    r.status,
    r.status === 401
      ? "Invalid username or password"
      : msg ? `${msg}` : `Login failed (HTTP ${r.status})`,
    parsed
  );
}

/** A successful sign-in answer (password or code): the session itself is in cookies; keep its expiry. */
function finishSignIn(json: { data?: { token?: string; expires?: number; user?: { tenantCode?: string } } }): void {
  const data = json.data ?? {};
  saveSession({
    ...(data.token ? { jwt: data.token } : {}), // none since Nov 2026: the sign-in is in cookies
    // UPPCL's session lasts 24 h; without a usable expiry, assume that rather than never expiring.
    jwtExpiresMs: Number.isFinite(data.expires) ? data.expires! : Date.now() + 24 * 3_600_000,
    tenant: data.user?.tenantCode ?? DEFAULT_TENANT,
  });
}

export async function logout(): Promise<void> {
  if (getSession()) void send("uppcl", "auth/logout", { method: "POST", body: "{}", headers: { "content-type": "application/json", apikey: UPPCL_API_KEY } }).catch(() => {}); // ends the cookie sign-in
  clearSession();
  forget1912(); // the 1912 OTP session and its number go with the account
}

// ─── UPPCL /wss legacy bill portal (official bills/receipts/meter data) ───────
// The portal AES-encrypts request & response bodies (`_cdata`). wssPost encrypts
// the payload, POSTs via the /api/wss proxy, and decrypts the response.
// See docs/api-reverse-engineering.md §9.

/** Account/discom identifiers in the shapes the /wss endpoints expect. */
export function wssDiscom(site: SiteRecord): string {
  return String(site.tenantId).toUpperCase(); // e.g. "PVVNL"
}

export async function wssPost<T = Record<string, unknown>>(path: string, payload: Record<string, unknown>): Promise<T> {
  const mocked = platform.mock?.(`wss:${path}`); if (mocked !== undefined) return mocked as T; // data seam: sample data (src/demo.ts)
  const r = await send("wss", path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ _cdata: await wssEncrypt(JSON.stringify(payload)) }),
    cache: "no-store",
  });
  if (!r.ok) {
    // Error replies are encrypted like successes; decrypt so the portal's reason isn't lost.
    const body = (await r.json().catch(() => ({}))) as { _cdata?: string };
    const detail = body._cdata ? await wssDecrypt(body._cdata).catch(() => "") : "";
    // Keep the portal's own words, e.g. "CCB_ISE_SE_503 · Please try again after sometime" (its billing backend is down).
    let said = "Bill portal unavailable";
    try {
      const j = JSON.parse(detail) as { statusCode?: string; statusMsg?: string; ResMsg?: string };
      said = [j.statusCode, j.statusMsg || j.ResMsg].filter(Boolean).join(" · ") || said;
    } catch { /* not JSON: keep the generic reason */ }
    throw new ProxyError(r.status, said, detail, "wss");
  }
  const json = (await r.json()) as { _cdata?: string };
  if (!json._cdata) throw new ProxyError(502, "Bill portal returned no data", undefined, "wss");
  return JSON.parse(await wssDecrypt(json._cdata)) as T;
}

/** Download the official bill PDF for a monthly invoice. */
export async function downloadBillPdf(invoice: { invoice_id: string; bill_dt?: string }): Promise<void> {
  const site = await primarySite();
  const res = await wssPost<{ statusCode?: string; Response?: string; statusMsg?: string }>(
    "v2/api/viewBillDownloadPDF",
    { kno: site.connectionId, discomName: wssDiscom(site), billNo: invoice.invoice_id, category: String(site.accountType ?? "10"), identifierType: "UNMASKED" }
  );
  if (res.statusCode !== "VIEW_BILL_PDF_200" || !res.Response) {
    throw new ProxyError(404, res.statusMsg || "Bill PDF not available for this connection", undefined, "wss");
  }
  // The month in the name: shared bills shouldn't all be "uppcl-bill-<number>.pdf" (UX-R31).
  const from = invoice.bill_dt ? billingPeriod(invoice.bill_dt).from : null;
  const month = from && !isNaN(from.getTime()) ? `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-` : "";
  await platform.savePdf(res.Response, `uppcl-bill-${month}${invoice.invoice_id}.pdf`);
}

/**
 * The official receipt PDF for one payment, from UPPCL SMART (payment/v2/download, what its own app uses).
 * Any payment in the list, not just the latest, and it doesn't depend on the bill portal.
 */
export async function downloadReceiptPdf(payment: { _id: string; txn_id?: string }): Promise<void> {
  const sample = platform.mock?.(`receipt:${payment._id}`) as string | undefined; // // data seam: sample data (src/demo.ts)
  if (sample) return platform.savePdf(sample, `receipt-${payment._id}.pdf`);
  const site = await primarySite();
  if (!getSession()) throw new ProxyError(401, "No active session — sign in first");
  const r = await send("uppcl", "payment/v2/download", {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json", apikey: UPPCL_API_KEY, tenantid: tenantHeader(getSession()!.tenant), ...authHeaders(),
    },
    body: JSON.stringify({ consumer_id: site.connectionId, paymentId: payment._id, language: "en", tenantId: site.tenantId }),
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // A PDF starts "%PDF"; anything else is UPPCL's JSON error.
  if (!r.ok || bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new ProxyError(r.ok ? 404 : r.status, "No receipt for this payment");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await platform.savePdf(btoa(bin), `uppcl-receipt-${payment.txn_id || payment._id}.pdf`);
}

/** Download the official arrears statement PDF. */
export async function downloadArrearsPdf(): Promise<void> {
  const site = await primarySite();
  const res = await wssPost<{ byteCode?: string; statusMsg?: string }>(
    "v2/InstaPayment/viewArrear",
    { discomName: wssDiscom(site), kno: site.connectionId, reportName: "ARREAR" }
  );
  if (!res.byteCode) throw new ProxyError(404, res.statusMsg || "No arrears statement available", undefined, "wss");
  await platform.savePdf(res.byteCode, `uppcl-arrears-${site.connectionId}.pdf`);
}

// ─── Data fetchers (mirror the old Python proxy endpoints) ────────────────────

async function sites(): Promise<unknown> {
  return uppcl_post("site/search", { skip: 0, limit: 50 });
}

export async function primarySite(): Promise<SiteRecord> {
  const sample = platform.mock?.("site") as SiteRecord | undefined; // data seam: sample data (src/demo.ts)
  if (sample) return sample;
  const cached = getSite();
  if (cached) return cached;
  const resp = (await sites()) as { data: SiteRecord[] };
  if (!resp.data?.length) throw new ProxyError(404, "No sites on this account");
  const site = resp.data[0];
  setSite(site);
  return site;
}

function ids(site: SiteRecord): { cid: string; did: string; tid: string } {
  return { cid: site.connectionId, did: site.deviceId, tid: site.tenantId };
}

// ─── SWR fetcher ──────────────────────────────────────────────────────────────

/**
 * SWR fetcher keyed by a string tag. Calls the appropriate UPPCL endpoint
 * with encryption, or the complaints API route.
 */
async function fetcher<T>(key: string): Promise<T> {
  const mocked = platform.mock?.(key); if (mocked !== undefined) return mocked as T; // data seam: sample data (src/demo.ts)
  // Complaints: UPPCL's 1912 portal, anonymous (no user creds), straight from the phone.
  if (key.startsWith("/complaints/detail/")) return complaintDetail(decodeURIComponent(key.slice("/complaints/detail/".length))) as Promise<T>;
  if (key.startsWith("/complaints")) return complaints(key.slice("/complaints".length)) as Promise<T>;

  // Health is client-side only
  if (key === "/health") {
    return {
      // React Native's navigator has no onLine (undefined) — treat that as online.
      ok: typeof navigator === "undefined" || navigator.onLine !== false,
      authenticated: isAuthenticated(),
      tenant: getSession()?.tenant ?? DEFAULT_TENANT,
      jwt_expires_ms: getSession()?.jwtExpiresMs ?? 0,
      jwt_expires_in_days: jwtExpiresInDays(),

    } as T;
  }

  // Everything else requires auth
  if (!isAuthenticated()) {
    throw new ProxyError(401, "Not authenticated");
  }

  const site = await primarySite();
  const { cid, did, tid } = ids(site);
  const today = new Date();

  // Route to the correct UPPCL endpoint
  if (key === "/dashboard") return fetchDashboard(site, cid, did, tid) as Promise<T>;
  if (key === "/me") return uppcl_post("user/search", { skip: 0, limit: 10 }) as Promise<T>;
  if (key === "/guests") return guests() as Promise<T>;
  if (key === "/invitations") return invitations() as Promise<T>;
  if (key === "/balance/outstanding") return uppcl_post("site/outstandingBalance", { connectionId: cid, tenantId: tid }) as Promise<T>;

  // Parameterized endpoints
  const url = new URL(key, "http://x");
  const params = url.searchParams;

  if (key.startsWith("/bills/history")) {
    const limit = parseInt(params.get("limit") ?? "12");
    return uppcl_post("bill/billHistory", { consumerId: cid, tenantId: tid, skip: 0, limit }) as Promise<T>;
  }

  // Postpaid monthly invoices — MUST precede the generic /bills branch below,
  // because "/bills/latest".startsWith("/bills") is true.
  if (key.startsWith("/bills/latest")) {
    // Single latest monthly invoice (fetchLatestBill:true → object, not array).
    const from = humanDate(daysAgo(13 * 31));
    const to = humanDate(today);
    return uppcl_post("bill/billHistory", { type: "monthlyBill", from, to, tenantId: tid, fetchLatestBill: true, consumerId: cid }) as Promise<T>;
  }

  if (key.startsWith("/bills/invoices")) {
    // Full monthly invoice history (no fetchLatestBill → array). See RE doc §7.
    const monthsBack = parseInt(params.get("months") ?? "18");
    const from = humanDate(daysAgo(monthsBack * 31));
    const to = humanDate(today);
    return uppcl_post("bill/billHistory", { type: "monthlyBill", from, to, tenantId: tid, consumerId: cid }) as Promise<T>;
  }

  // Generic daily-bill search (prepaid daily bills).
  if (key.startsWith("/bills")) {
    const days = parseInt(params.get("days") ?? "90");
    const limit = parseInt(params.get("limit") ?? String(days));
    const start = daysAgo(days).toISOString().split("T")[0];
    const end = today.toISOString().split("T")[0];
    return uppcl_post("bill/search", { skip: 0, limit, tenantId: tid, connectionId: cid, from: start, to: end }) as Promise<T>;
  }

  if (key.startsWith("/payments")) {
    const limit = parseInt(params.get("limit") ?? "50");
    return uppcl_post("payment/v2/search", { skip: 0, limit, tenantId: tid, consumer_id: cid }) as Promise<T>;
  }

  if (key.startsWith("/consumption")) {
    const days = parseInt(params.get("days") ?? "30");
    const uom = params.get("uom") ?? "KWH";
    return uppcl_post("eventsummary/aggregate", { deviceId: did, tenantId: tid, from: ist(daysAgo(days)), to: istEnd(today), uom }) as Promise<T>;
  }

  if (key.startsWith("/history/yearly")) {
    const year = parseInt(params.get("year") ?? String(today.getFullYear()));
    return uppcl_post("eventsummary/search", { deviceId: did, tenantId: tid, groupBy: "year", year: String(year), uom: "KWH" }) as Promise<T>;
  }

  // ── Power-quality / usage stats, alarms, alerts, native tickets ────
  if (key.startsWith("/alarms")) {
    return uppcl_post("alarms/search", { connectionId: cid, tenantId: tid, startDate: daysAgo(30).toISOString(), endDate: today.toISOString() }) as Promise<T>;
  }

  if (key.startsWith("/alerts")) {
    return uppcl_post("alert/search", { userId: String(site.userId ?? ""), startDate: daysAgo(30).toISOString(), endDate: today.toISOString() }) as Promise<T>;
  }

  if (key.startsWith("/tickets")) {
    const status = params.get("status") ?? "open";
    return uppcl_post("ticket/search", { status, userId: String(site.userId ?? "") }) as Promise<T>;
  }

  if (key.startsWith("/tips")) {
    const appliance = params.get("appliance") ?? "others";
    return uppcl_post("savingTip/getOne", { appliance }) as Promise<T>;
  }

  if (key.startsWith("/day")) {
    // One day in 15-minute steps (what UPPCL SMART's "day" view uses). The body depends on the meter's data
    // source; only "jeu" and "hes" are known (Oct 2026). Others answer null, and the card stays hidden.
    const date = params.get("date") ?? "";
    const [y, m, d] = date.split("-").map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0), to = new Date(y, m - 1, d, 23, 59, 59);
    const src = String((site as Record<string, unknown>).dataSource ?? "");
    const body = src === "jeu" ? { deviceId: did, groupBy: "day", uom: "kWh", date, fromDate: ist(from), toDate: ist(to), consumerId: cid, periodicity: "IN" }
      : src === "hes" ? { deviceId: did, groupBy: "day", uom: "kWh", date, from: ist(new Date(from.getTime() - 1000)), to: ist(to) }
      : null;
    if (!body) return { data: null } as T;
    return uppcl_post("eventsummary/v2/search?skip=0&limit=1000", body) as Promise<T>;
  }

  if (key === "/tenant-preferences") {
    return proxy("bootstrap", "tenant/searchPreference", { tenantId: tid }) as Promise<T>;
  }

  if (key === "/downtime") {
    return proxy("uppcl", "announcements/activeDowntimeAnnouncement", null) as Promise<T>;
  }

  // ── Official data from the /wss bill portal (AES-encrypted) ────────
  if (key === "/wss/consumer") {
    return wssPost("v2/api/getConsumerDetails", { kno: cid, discomName: wssDiscom(site) }) as Promise<T>;
  }
  if (key === "/wss/meter") {
    return wssPost("v2/Utility/getMeterData", {
      kNumber: cid, discom: wssDiscom(site),
      sanctionedLoad: site.sanctionedLoad, connectionType: site.connectionType,
    }) as Promise<T>;
  }
  if (key === "/wss/arrears") {
    return wssPost("v2/InstaPayment/getArrearAmountStatus", { accountID: cid, discom: wssDiscom(site) }) as Promise<T>;
  }


  throw new ProxyError(404, `Unknown key: ${key}`, undefined, "app", "app");
}

// ─── Dashboard composite ──────────────────────────────────────────────────────

function safeFloat(x: unknown, def = 0): number {
  const n = parseFloat(String(x));
  return isNaN(n) ? def : n;
}

async function fetchDashboard(
  site: SiteRecord,
  cid: string,
  did: string,
  tid: string
): Promise<unknown> {
  const today = new Date();
  const start90 = daysAgo(90).toISOString().split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

  const [balResp, billsResp, paysResp, dailyResp] = await Promise.all([
    uppcl_post("site/prepaidBalance?fetchCache=false", { connectionId: cid }).catch(() => ({ data: null })) as Promise<{ data: unknown }>,
    uppcl_post("bill/search", { skip: 0, limit: 60, tenantId: tid, connectionId: cid, from: start90, to: todayStr }) as Promise<{ data: Array<Record<string, unknown>> }>,
    uppcl_post("payment/v2/search", { skip: 0, limit: 20, tenantId: tid, consumer_id: cid }) as Promise<{ data: Array<Record<string, unknown>> }>,
    uppcl_post("eventsummary/aggregate", { deviceId: did, tenantId: tid, from: ist(daysAgo(30)), to: ist(today) }) as Promise<{ data: Array<Record<string, unknown>> }>,
  ]);

  let bal: Record<string, unknown> = (balResp.data ?? {}) as Record<string, unknown>;
  const bills = billsResp.data ?? [];
  const pays = paysResp.data ?? [];
  const daily = dailyResp.data ?? [];

  // Fallback when prepaidBalance returns empty
  if (!bal || Object.keys(bal).length === 0) {
    if (bills.length) {
      const db = (bills[0] as Record<string, unknown>).dailyBill as Record<string, string> | undefined ?? {};
      bal = {
        prepaidBalanceAmount: db.closing_bal,
        prepaidBalanceUpdateDate: db.usage_date,
        meterStatus: null,
        postpaidArrearAmount: "0",
        recharge: null,
      };
    }
  }

  // Derived metrics
  const dailyCharges = bills
    .map((b) => safeFloat(((b as Record<string, unknown>).dailyBill as Record<string, string>)?.daily_chg))
    .filter((x) => x > 0);
  const avgBurn = dailyCharges.length ? Math.round((dailyCharges.reduce((a, b) => a + b, 0) / dailyCharges.length) * 100) / 100 : 0;
  const latestBal = safeFloat(bal.prepaidBalanceAmount);
  const daysRunway = avgBurn > 0 ? Math.round((latestBal / avgBurn) * 10) / 10 : null;

  const kwh30 = Math.round(
    daily.reduce((sum, d) => sum + safeFloat(((d as Record<string, unknown>).energyImportKWH as Record<string, unknown>)?.value), 0) * 100
  ) / 100;

  // Subsidy YTD
  const subsidyYtd = bills.length
    ? Math.round(Math.abs(safeFloat((bills[0] as Record<string, unknown>).dailyBill && ((bills[0] as Record<string, unknown>).dailyBill as Record<string, string>).cum_gvt_subsidy)) * 100) / 100
    : 0;

  // Recharge lifespans
  const recharges = pays
    .filter((p) => safeFloat(p.amt) > 0)
    .map((p) => ({ date: p.payment_dt as string, amount: safeFloat(p.amt), txn: p.txn_id as string }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const lifespans: Array<{ amount: number; lasted_days: number; txn: string }> = [];
  for (let i = 0; i < recharges.length - 1; i++) {
    try {
      const d1 = new Date(recharges[i].date);
      const d2 = new Date(recharges[i + 1].date);
      const days = Math.round(((d2.getTime() - d1.getTime()) / 86_400_000) * 10) / 10;
      lifespans.push({ amount: recharges[i].amount, lasted_days: days, txn: recharges[i].txn });
    } catch { /* skip */ }
  }

  // Effective rate
  const recentBill = bills[0] ? ((bills[0] as Record<string, unknown>).dailyBill as Record<string, string>) : {};
  const units = safeFloat(recentBill?.units_billed_daily);
  const energy = safeFloat(recentBill?.daily_en_chg);
  const effRate = units > 0 ? Math.round((energy / units) * 100) / 100 : null;

  return {
    site,
    balance: {
      inr: latestBal,
      updated_at: bal.prepaidBalanceUpdateDate ?? null,
      meter_status: bal.meterStatus ?? null,
      arrears_inr: safeFloat(bal.postpaidArrearAmount),
      last_recharge: safeFloat(bal.recharge),
    },
    runway: {
      days: daysRunway,
      avg_daily_spend: avgBurn,
      basis_days: dailyCharges.length,
    },
    consumption_30d: {
      kwh: kwh30,
      avg_daily_kwh: Math.round((kwh30 / Math.max(daily.length, 1)) * 100) / 100,
      effective_rate: effRate,
      daily,
    },
    subsidy_ytd_inr: subsidyYtd,
    recharge_lifespans: lifespans.slice(-10),
    recent_bills: bills.slice(0, 10),
    recent_payments: pays.slice(0, 10),
  };
}

/* ── Types (unchanged from original) ──────────────────────────── */

export interface UpstreamEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface Health {
  ok: boolean;
  authenticated: boolean;
  tenant: string;
  jwt_expires_ms: number;
  jwt_expires_in_days: number | null;

}

export interface Site {
  _id: string;
  connectionId: string;
  deviceId: string;
  tenantId: string;
  tenantCode: string;
  discom: string;
  userId: string;
  name: string;
  customerName: string;
  address: string;
  pincode: string;
  sanctionedLoad: string;
  connectionType: "prepaid" | "postpaid" | string;
  meterInstallationNumber: string;
  meterPhase: string;
  meterType: string;
  // Also on UPPCL SMART's connection record (Oct 2026 audit):
  email?: string;
  isPaperlessBillEnabled?: boolean;
  meterInstallationDate?: string;
  dataSource?: string; // "jeu" / "hes" / …: decides the day-readings request body
}

export interface DailyBill {
  _id: string;
  connectionId: string;
  billDate: string;
  dailyBill: {
    consumer_id: string;
    meter_no: string;
    usage_date: string;
    units_billed_daily: string;
    day_end_reading: string;
    opening_bal: string;
    closing_bal: string;
    daily_chg: string;
    daily_en_chg: string;
    daily_fc_chg: string;
    daily_gvt_subsidy: string;
    daily_ed_chg: string;
    daily_rebate_chg: string;
    cum_gvt_subsidy: string;
    max_demand: string;
    fppa_charges: string;
    [k: string]: string | null | undefined;
  };
}

export interface Payment {
  _id: string;
  consumer_id: string;
  installation_no: string;
  status: string;
  payment_dt: string;
  txn_id: string;
  amt: string;
  payment_type: string;
  channel: string;
  msi: string;
  tenantCode: string;
  tenantId: string;
  tenant?: string;
  connectionTransactionId?: string;
}

export interface ConsumptionRow {
  energyImportKWH: { unit: string; value: number | string; measureTime: string };
  energyImportKVAH: { unit: string; value: number | string; measureTime: string };
  energyExportKWH: { unit: string; value: number | string; measureTime: string };
  power: { unit: string; value: number | string; measureTime: string };
  powerKVA?: { unit: string; value: number | string; measureTime: string };
  powerFactor?: { unit: string; value: number | string; measureTime: string };
}

export interface BillInvoice {
  invoice_id: string;
  bill_from_dt: string;
  bill_amt: string;
  due_dt: string;
  bill_dt: string;
  payment_dt: string;
  payment_amt: string;
}

export interface DashboardResponse {
  site: Site;
  balance: {
    inr: number;
    updated_at: string | null;
    meter_status: string | null;
    arrears_inr: number;
    last_recharge: number;
  };
  runway: {
    days: number | null;
    avg_daily_spend: number;
    basis_days: number;
  };
  consumption_30d: {
    kwh: number;
    avg_daily_kwh: number;
    effective_rate: number | null;
    daily: ConsumptionRow[];
  };
  subsidy_ytd_inr: number;
  recharge_lifespans: Array<{ amount: number; lasted_days: number; txn: string }>;
  recent_bills: DailyBill[];
  recent_payments: Payment[];
}

export interface MeUser {
  _id: string;
  phone: string;
  phoneCountryCode: string;
  username: string;
  name?: string;
}

/** One-off fetches outside React (e.g. the mobile app's background alert check). */
export const getDashboard = () => fetcher<DashboardResponse>("/dashboard");
export const getLatestInvoice = () => fetcher<UpstreamEnvelope<MonthlyInvoice>>("/bills/latest");
export const getDowntime = () => fetcher<UpstreamEnvelope<DowntimeAnnouncement | null>>("/downtime");

/* ── SWR hooks (unchanged signatures — pages don't need to change) ── */

const swrOpts = {
  revalidateOnFocus: false,
  revalidateIfStale: false,
  dedupingInterval: 15_000,
};

export const useHealth = () =>
  useSWR<Health>("/health", fetcher, { ...swrOpts, refreshInterval: 60_000 });

export const useDashboard = () =>
  useSWR<DashboardResponse>("/dashboard", fetcher, swrOpts);

export const useOutstanding = () =>
  useSWR<UpstreamEnvelope<{ consumerId: string; outstandingAmount: string; msi: string }>>(
    "/balance/outstanding", fetcher, swrOpts
  );

// ─── Family access (UPPCL SMART "invite guest", tenantMasterData) ────────────
// The owner invites someone by mobile or email until a date; UPPCL texts / emails them and, once they sign in to
// UPPCL SMART with that number, they see this connection read-only. Writes only on the user's explicit tap.
export interface Guest {
  _id: string; first_name?: string; last_name?: string; phone?: string; email?: string;
  status: "pending" | "active" | "expired" | string; endDate?: string; connectionId?: string; tenantId?: string; invitedBy?: unknown;
}
const GUEST_STATUSES = ["pending", "active", "expired"];
export const useGuests = () => useSWR<Guest[]>(isAuthenticated() ? "/guests" : null, fetcher, swrOpts);
/** Invitations other people sent to this login. */
export const useInvitations = () => useSWR<Guest[]>(isAuthenticated() ? "/invitations" : null, fetcher, swrOpts);

async function guests(): Promise<Guest[]> {
  const site = await primarySite();
  const r = await uppcl_post("tenantMasterData/search", { flags: { isFetchAsInvitedFrom: true }, connectionId: site.connectionId, tenantId: site.tenantId, statuses: GUEST_STATUSES }) as { data?: Guest[] };
  return r.data ?? [];
}
async function invitations(): Promise<Guest[]> {
  const r = await uppcl_post("tenantMasterData/search", { status: "pending", flags: { isPopulateInvitedBy: true, isFetchAsInvitedTo: true } }) as { data?: Guest[] };
  return r.data ?? [];
}

/** `until`: the last day of access (UPPCL stores the end of that day). Resends when `resend` (a still-waiting invite). */
export async function inviteGuest(g: { first: string; last: string; to: CodeTo; until: Date; resend?: boolean }): Promise<void> {
  const site = await primarySite();
  const end = new Date(g.until); end.setHours(23, 59, 59, 999);
  await uppcl_post(g.resend ? "tenantMasterData/resend-invite" : "tenantMasterData/send-invite", {
    first_name: g.first.trim(), last_name: g.last.trim(), connectionId: site.connectionId, tenantId: site.tenantId, endDate: end.toISOString(),
    ...("phone" in g.to ? { phone: g.to.phone, phoneCountryCode: "+91" } : { email: g.to.email.trim().toLowerCase() }),
  }, { enablecaptcha: "" });
  await mutate("/guests");
}
export async function extendGuest(id: string, until: Date): Promise<void> {
  const end = new Date(until); end.setHours(23, 59, 59, 999);
  await uppcl_post(`tenantMasterData/extend-access/${encodeURIComponent(id)}`, { endDate: end.toISOString(), status: "active" });
  await mutate("/guests");
}
export async function removeGuest(id: string): Promise<void> {
  await proxy("uppcl", `tenantMasterData/delete/${encodeURIComponent(id)}`, {}, undefined, "DELETE");
  await mutate("/guests");
}
export async function answerInvitation(inv: Guest, accept: boolean): Promise<void> {
  await uppcl_post("tenantMasterData/accept-invitation", { _id: inv._id, connectionId: inv.connectionId, invitedBy: inv.invitedBy, status: accept ? "active" : "rejected", tenantId: inv.tenantId });
  await mutate("/invitations");
}

// ─── Paperless bill (UPPCL SMART site/update) ────────────────────────────────
/** Email bills on (paper off) or back to paper; keeps the saved site in step. Only on the user's tap. */
export async function setPaperlessBill(on: boolean): Promise<void> {
  const site = await primarySite();
  const r = await proxy("uppcl", `site/update/${encodeURIComponent(site._id)}`, { isPaperlessBillEnabled: on }, undefined, "PUT") as { data?: SiteRecord };
  setSite(r.data?._id ? r.data : { ...site, isPaperlessBillEnabled: on });
  await mutate((k) => typeof k === "string" && (k === "/me" || k === "/dashboard"));
}

export const useMe = () =>
  useSWR<UpstreamEnvelope<MeUser[]>>("/me", fetcher, swrOpts);

export const useBills = (days = 90) =>
  useSWR<UpstreamEnvelope<DailyBill[]>>(`/bills?days=${days}&limit=${days}`, fetcher, swrOpts);

export const useBillHistory = (limit = 12, enabled = true) =>
  useSWR<UpstreamEnvelope<BillInvoice[]>>(enabled ? `/bills/history?limit=${limit}` : null, fetcher, swrOpts);

export const usePayments = (limit = 50) =>
  useSWR<UpstreamEnvelope<Payment[]>>(`/payments?limit=${limit}`, fetcher, swrOpts);

/** One day in 15-minute readings (null data when the meter's source isn't supported). `date` is YYYY-MM-DD. */
export const useDayReadings = (date: string | null) =>
  // An early answer is often empty (UPPCL publishes the day later): refresh a saved one when shown, or the
  // hour-by-hour card stays hidden for that day (UX-R36, same class as BUG-030).
  useSWR<UpstreamEnvelope<ConsumptionRow[] | null>>(date ? `/day?date=${date}` : null, fetcher, { ...swrOpts, revalidateIfStale: true });

export const useConsumption = (days = 30) =>
  useSWR<UpstreamEnvelope<ConsumptionRow[]>>(`/consumption?days=${days}`, fetcher, swrOpts);

export const useYearlyHistory = (year?: number) =>
  useSWR<UpstreamEnvelope<ConsumptionRow[]>>(
    year ? `/history/yearly?year=${year}` : "/history/yearly", fetcher, swrOpts
  );

/* ── Postpaid + cross-meter feature hooks (reverse-engineered, see docs) ── */

export interface MonthlyInvoice {
  invoice_id: string;
  bill_from_dt: string;
  bill_amt: string;      // negative = credit / advance balance
  due_dt: string;
  bill_dt: string;
  payment_dt: string;
  payment_amt: string;
}

export interface MeterAlarm { [k: string]: unknown }
export interface Notification { [k: string]: unknown }
export interface Ticket { [k: string]: unknown }
export interface SavingTip { _id: string; tipEnglish?: string; tipHindi?: string; appliance?: string }

/** Latest monthly invoice (postpaid). Single object, not an array. */
export const useLatestInvoice = () =>
  useSWR<UpstreamEnvelope<MonthlyInvoice>>("/bills/latest", fetcher, swrOpts);

/** Full monthly invoice history (postpaid). */
export const useInvoices = (months = 18, enabled = true) =>
  useSWR<UpstreamEnvelope<MonthlyInvoice[]>>(enabled ? `/bills/invoices?months=${months}` : null, fetcher, swrOpts);

/** Avg/max consumption + peak power for a month. */
export const useMeterAlarms = () =>
  useSWR<UpstreamEnvelope<MeterAlarm[]>>("/alarms", fetcher, swrOpts);

export const useNotifications = () =>
  useSWR<UpstreamEnvelope<Notification[]>>("/alerts", fetcher, swrOpts);

export const useTickets = (status: "open" | "closed" | "all" = "open") =>
  useSWR<UpstreamEnvelope<Ticket[]>>(`/tickets?status=${status}`, fetcher, swrOpts);

/** Localized energy-saving tips for an appliance (fridge|geyser|washing_machine|nightbaseload|others). */
export const useSavingTip = (appliance: string) =>
  useSWR<UpstreamEnvelope<SavingTip[]>>(appliance ? `/tips?appliance=${appliance}` : null, fetcher, swrOpts);

export interface DiscomDetails {
  address?: string;
  customerCareNumber?: string;
  helplineNumber?: string;
  whatsappNumber?: string;
  email?: string;
  alias?: string;
  title?: string;
  logo?: string;
  playStoreLink?: string;
}

export interface TenantPreferences {
  discomDetails?: DiscomDetails;
  [k: string]: unknown;
}

export interface DowntimeAnnouncement {
  body?: string;
  title?: string;
  [k: string]: unknown;
}


/** UPPCL's feature-flag + discom config tree (bootstrap API). */
export const useTenantPreferences = () =>
  useSWR<UpstreamEnvelope<TenantPreferences>>("/tenant-preferences", fetcher, swrOpts);

/** Active maintenance / downtime announcement (null when none). */
export const useDowntime = () =>
  useSWR<UpstreamEnvelope<DowntimeAnnouncement | null>>("/downtime", fetcher, swrOpts);

/* ── Official /wss bill-portal data (richer than the jio platform) ── */

export interface WssConsumer {
  status?: string;
  ConsumerDetails?: {
    kno?: string;
    name?: string;
    mobileNo?: string;
    email?: string;
    currentAddress?: string;   // may carry a scheme-eligibility note
    billingAddress?: string;
    installationAddress?: string;
    category?: string;
    dueAmount?: string;
    dueDate?: string;
    billNo?: string;
    onlineBillingStatus?: string;
    division?: string;
    subDivision?: string;
    dateOfBirth?: string;
    premiseAddress?: { city?: string | null };
    billingAddresss?: { city?: string | null }; // sic: UPPCL spells it with three s
  };
}

export interface WssMeter {
  status?: string;
  data?: {
    purposeOfSupply?: string;   // e.g. "LMV1" — official tariff category
    supplyType?: string;
    meterStatus?: string;
    manufacturerCode?: string;
    meterConfigType?: string;
    meterSerialNumber?: string;
    badgeNumber?: string;
    previousReadingKWH?: string;
    previousReadDateTime?: string;
  };
}

export interface WssArrears {
  status?: string;
  data?: { amount?: string; status?: string };
}

/** Official consumer profile (division, due date, billing mode, scheme flag). */
export const useWssConsumer = () =>
  useSWR<WssConsumer>("/wss/consumer", fetcher, swrOpts);

/** Official meter data (tariff category, meter status, last cumulative reading). */
export const useWssMeter = () =>
  useSWR<WssMeter>("/wss/meter", fetcher, swrOpts);

/** Official arrears amount. */
export const useWssArrears = () =>
  useSWR<WssArrears>("/wss/arrears", fetcher, swrOpts);

/* ── Complaint hooks (same signatures, different backend route) ── */

export interface ComplaintDetail {
  data_id: string;
  complaint_no: string;
  status: string;
  is_open: boolean;
  entry_date: string | null;
  closing_date: string | null;
  consumer_name: string | null;
  mobile_no: string | null;
  address: string | null;
  customer_account: string | null;
  remarks: string | null;
  closing_remarks: string | null;
  closed_by: string | null;
  type: string | null;
  sub_type: string | null;
  source: string | null;
  je_name: string | null;
  je_mobile: string | null;
  ae_name: string | null;
  ae_mobile: string | null;
  xen_name: string | null;
  xen_mobile: string | null;
  subdivision: string | null;
  substation: string | null;
  assigned_to: string | null;
  base_level: string | null;
  initial_user: string | null;
  raw_fields: Record<string, string>;
  /** UPPCL's own time limit for this complaint type (1912 escalation chart), hours; detail only. */
  limit_hours?: number | null;
}

/** One complaint in full (remarks, officers, area); the list row shows meanwhile. Keyed under /complaints so sign-in refreshes it. */
/** A complaint's full record if it was opened before (cache only, never fetches): the list's "Late" pill. */
export const useSeenComplaintDetail = (no: string) =>
  useSWR<ComplaintDetail | null>(connected1912() ? `/complaints/detail/${encodeURIComponent(no)}` : null, null, { revalidateOnMount: false, revalidateOnFocus: false });
export const useComplaintDetail = (no: string | undefined) =>
  useSWR<ComplaintDetail | null>(connected1912() && no ? `/complaints/detail/${encodeURIComponent(no)}` : null, fetcher, { ...swrOpts, revalidateIfStale: true, shouldRetryOnError: false }); // opened by a tap: refresh a saved answer (BUG-030)

/** The number signed in to 1912 (OTP). Its last answer stays cached when the session ends: is1912LoginOnly(error) then. */
export const useMyComplaints = () => {
  const phone = connected1912();
  return useSWR<{ phone: string; complaints: ComplaintDetail[] }>(
    phone ? `/complaints?action=my&phone=${phone}` : null,
    fetcher,
    { ...swrOpts, revalidateOnFocus: true, shouldRetryOnError: false } // a needed code won't appear by retrying
  );
};
