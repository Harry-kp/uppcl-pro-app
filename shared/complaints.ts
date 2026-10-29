/**
 * UPPCL's 1912 complaint portal (the Appsavy platform), called straight from the phone.
 *
 * Anonymous: no user credentials, just the registered mobile number to look complaints up by. The portal
 * moved from appsavy.com/coreapps/… (stopped answering, Oct 2026) to 1912.uppcl.org/… with the same session,
 * headers and XML. The session is cookies set across a redirect chain; the phone's native cookie jar keeps
 * them, so this no longer needs the web project's server route.
 */
import { cbc } from "@noble/ciphers/aes.js";
import { ProxyError, send, type ComplaintDetail } from "./api";
import { rsaOaepEncrypt } from "./crypto";
import { platform } from "./platform";
import { parseUppclDate } from "./utils";

const COMPANY_ID = "64";

// The portal's header "encryption": AES-128-CBC with a constant published key/IV (not a secret).
const KEY = new TextEncoder().encode("80".repeat(8));
const enc = (plain: string) => {
  const ct = cbc(KEY, KEY).encrypt(new TextEncoder().encode(plain)); // noble pads PKCS7 itself
  return btoa(String.fromCharCode(...ct));
};

/** base64 of the UTF-8 bytes (the portal does btoa(unescape(encodeURIComponent(x)))); btoa alone breaks on Hindi. */
const b64 = (text: string) => {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
};

// ─── 1912 consumer sign-in (Oct 2026: the anonymous forms are gone) ───────────
// Mobile + OTP, as UPPCL's own consumer app does it (buildId com.mobi.UPPCLConsumer). Each payload is
// RSA-OAEP encrypted under a one-time key from /auth/challenge. The session is ASP.NET cookies (native
// cookie jar) plus the ids the landing page carries; those ids live in the vault. One session per number:
// signing in elsewhere (the website) ends this one.

const LOGIN_ONLY = "1912 needs a one-time code to show or file complaints";
/** 1912 needs (another) OTP sign-in before it answers. */
export const is1912LoginOnly = (e: unknown) => (e as { reason?: string } | null)?.reason === LOGIN_ONLY;
const needLogin = () => new ProxyError(401, LOGIN_ONLY, undefined, "complaints");

interface Auth1912 { mobile: string; login: string; role: string; token: string; project: string; registered: boolean; at: number }
const AUTH_KEY = "1912-auth-v1", MOBILE_KEY = "1912-mobile-v1";
const AUTH_TTL = 6 * 3600_000; // ponytail: UPPCL's real limit is unmeasured; 401 clears it sooner anyway

function auth(): Auth1912 | null {
  try {
    const a = JSON.parse(platform.storage?.getItem(AUTH_KEY) ?? "null") as Auth1912 | null;
    return a && Date.now() - a.at < AUTH_TTL ? a : null;
  } catch { return null; }
}
const dropAuth = () => platform.storage?.removeItem(AUTH_KEY);

/** The number last signed in to 1912 (kept after the session ends, so cached complaints still show). */
export function connected1912(): string | null {
  if (sample()) return "9000000001";
  return platform.storage?.getItem(MOBILE_KEY) ?? null;
}
/** Signed in right now (no code needed for the next call). */
export const signedIn1912 = () => sample() || !!auth();
/** Signed in, but this number hasn't done 1912's one-time "Register yourself" (KYC). */
export const needsKyc1912 = () => !sample() && auth()?.registered === false;
export function forget1912(): void { dropAuth(); platform.storage?.removeItem(MOBILE_KEY); }

async function sealed(payload: string): Promise<string> {
  const r = await send("complaints", "auth/challenge", { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new ProxyError(r.status, `1912 sign-in: HTTP ${r.status}`, undefined, "complaints");
  const { publicKey, nonce, timestamp } = await r.json() as { publicKey: string; nonce: string; timestamp: string };
  return rsaOaepEncrypt(publicKey, `${payload}|${nonce}|${timestamp}`);
}

async function account(action: string, payload: string): Promise<{ Status?: string; Message?: string; FormsID?: number }> {
  const r = await send("complaints", `UserAccounts/${action}`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded", referer: "https://1912.uppcl.org/" },
    body: `encryptedPayload=${encodeURIComponent(await sealed(payload))}`,
  });
  if (!r.ok) throw new ProxyError(r.status, `1912 sign-in: HTTP ${r.status}`, undefined, "complaints");
  return r.json();
}

/** Texts a sign-in code to `mobile` (1912 sends it; any Indian mobile, not only the bill's). */
export async function send1912Otp(mobile: string): Promise<void> {
  if (sample()) return;
  const m = mobile10(mobile);
  if (!m) throw new ProxyError(400, "Enter a 10-digit mobile number", undefined, "app", "app");
  await send("complaints", "", { headers: { accept: "text/html" }, cache: "no-store" }); // session + antiforgery cookies
  const j = await account("SendOTPForMobile", `${m}|com.mobi.UPPCLConsumer`);
  if (j.Status !== "1") throw new ProxyError(400, j.Message || "1912 couldn't send a code", undefined, "complaints");
}

/** Checks the code and keeps the session. Wrong or expired code → ProxyError 400 with UPPCL's message. */
export async function verify1912Otp(mobile: string, otp: string): Promise<void> {
  const m = mobile10(mobile)!;
  if (sample()) { platform.storage?.setItem(MOBILE_KEY, m); return; }
  const j = await account("ValidateOTPForMobileLogin", `${m}|${otp.trim()}`);
  if (j.Status !== "1" || !j.FormsID) throw new ProxyError(400, j.Message || "Wrong code", undefined, "complaints");
  // The landing page carries the ids every later call needs.
  const html = await (await send("complaints", `UI/Form?FormId=${j.FormsID}`, { headers: { accept: "text/html" }, cache: "no-store" })).text();
  const hid = (id: string) => new RegExp(`id="${id}" value="([^"]*)"`).exec(html)?.[1] ?? "";
  const a: Auth1912 = { mobile: m, login: hid("xlogin"), role: hid("xrole_id"), token: hid("xcode"), project: hid("xproject_id"),
    registered: j.FormsID !== KYC_FORM, at: Date.now() };
  if (!a.login || !a.role || !a.token) throw new ProxyError(502, "1912 signed in but sent an unexpected page", undefined, "complaints");
  platform.storage?.setItem(AUTH_KEY, JSON.stringify(a));
  platform.storage?.setItem(MOBILE_KEY, m);
}

const KYC_FORM = 9208, LIST_FORM = "9216";

const apiHeaders = (form: string, a: Auth1912) => ({
  accept: "application/xml, text/xml, */*; q=0.01",
  "content-type": "application/json",
  version: "1",
  "x-requested-with": "XMLHttpRequest",
  referer: `https://1912.uppcl.org/UI/Form?FormId=${form}`,
  appsavylogin: enc(a.login), formid: enc(form), roleid: enc(a.role), sourcetype: enc("WEB"), token: enc(a.token),
});

/** Sample data is on (demo mode): 1912 must never be called, above all never a save with an invented account. */
const sample = () => platform.mock?.("scenario:active") === true; // data seam: sample data (src/demo.ts)
const refuseSample = () => { if (sample()) throw new ProxyError(0, "Sample data: not sent to UPPCL", undefined, "app", "app"); };

async function postApi(inputXml: string, form: string): Promise<string> {
  refuseSample();
  const a = auth();
  if (!a) throw needLogin();
  const r = await send("complaints", "api/AppsavyServices/GetRelationalDataA", {
    method: "POST", cache: "no-store", headers: apiHeaders(form, a),
    body: JSON.stringify({ inputxml: b64(inputXml), DocVersion: 1 }),
  });
  if (r.status === 401) { dropAuth(); throw needLogin(); } // expired, or signed in elsewhere
  if (!r.ok) throw new ProxyError(r.status, `1912 portal: HTTP ${r.status}`, undefined, "complaints");
  return r.text();
}

type Row = Record<string, string>;

/** "009000000022" → "9000000022"; null unless it ends in a 10-digit Indian mobile. */
export function mobile10(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "SHRI RAM KUMAR (RAMPUR KHURD" → "Ram Kumar (Rampur Khurd)"; null when it isn't a person
 *  (the JE field often holds a line and a number, e.g. "11 KV LT 9000000021"). */
export function personName(v: string | null | undefined): string | null {
  let n = String(v ?? "").trim();
  if (!n || /\d/.test(n)) return null;
  n = n.replace(/^(shri|smt\.?|sri|mr\.?|ms\.?|er\.?)\s+/i, "");
  if ((n.match(/\(/g) ?? []).length > (n.match(/\)/g) ?? []).length) n += ")";
  return n.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

/** "NO SUPPLY" → "No supply". */
const sentence = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : null);

function rowsOf(block: string): Row[] {
  const rows: Row[] = [];
  for (const set of block.matchAll(/<Rowset>([\s\S]*?)<\/Rowset>/gi)) {
    const row: Row = {};
    for (const f of set[1].matchAll(/<(\w+)\b[^>]*>([\s\S]*?)<\/\1>/g)) row[f[1]] = unxml(f[2].trim());
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

function parseRowsets(raw: string): Row[] {
  return [...raw.matchAll(/<RESULTS[^>]*>([\s\S]*?)<\/RESULTS>/gi)].flatMap((block) => rowsOf(block[1]));
}

/** The same answer split per requested control: CHILDCONTROLID → rows (one request can ask for many). */
export function parseByChild(raw: string): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const m of raw.matchAll(/<RESULTS\b[^>]*CHILDCONTROLID="([^"]*)"[^>]*>([\s\S]*?)<\/RESULTS>/gi)) (out[m[1]] ??= []).push(...rowsOf(m[2]));
  return out;
}

const unxml = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
/** XML attribute value; non-ASCII as numeric entities (keeps the request ASCII, like the portal's Encoder). */
const xmlAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
  .replace(/[^\x20-\x7e]/gu, (ch) => `&#${ch.codePointAt(0)};`);

const FILING_PAUSED = "In-app filing is paused while it moves to 1912's signed-in form";
const NOT_LINKED = "This connection isn't added to your 1912 account yet";
/** 1912 files only for connections added to the signed-in number ("Register Account" on 1912, once, with an OTP). */
export const is1912NotLinked = (e: unknown) => (e as { reason?: string } | null)?.reason === NOT_LINKED;
/** In-app filing is off until the signed-in "Register Complaint" form (9212) is verified; use SMS / call / WhatsApp. */
export const is1912FilingPaused = (e: unknown) => (e as { reason?: string } | null)?.reason === FILING_PAUSED;
// On: the signed-in 9212 save is built from the page's own fnSaveData and the values it fills (captured, never sent).
// ponytail: first real filing is the owner's to make; set true again if it's refused.
const FILING_OFF: boolean = false;
const filingPaused = () => new ProxyError(503, FILING_PAUSED, undefined, "complaints");

const header = (event: string) => {
  const a = auth();
  if (!a) throw needLogin();
  return '<?xml version="1.0"?><Request VERSION="2" LANGUAGE_ID="" LOCATION="">' +
    `<Company Company_Id="${COMPANY_ID}" /><Project Project_Id="${a.project}" />` +
    `<User User_Id="${a.login}" /><IUVLogin IUVLogin_Id="${a.login}" />` +
    `<ROLE ROLE_ID="${a.role}" /><Event Control_Id="${event}" />`;
};

// "Complaint Status" (form 9216): the signed-in number's complaints, by status (CP pending, CC closed).
const listOf = async (status: "CP" | "CC") => (await lookup("94181", [["94185", "83881", [["94180", ""], ["100027", status]]]], LIST_FORM))["94185"] ?? [];

const fromRow = (r: Row): ComplaintDetail => {
  const status = r.COMP_STATUS || "";
  return {
    data_id: r.COMP_NO, complaint_no: r.COMP_NO, status, is_open: !/close/i.test(status),
    entry_date: r.REG_DATE || null, closing_date: r.CL_DATE || null, consumer_name: r.CO_NAME || null, mobile_no: mobile10(r.MOBILE_NO),
    type: sentence(r.COMP_TYPE_NAME || null), sub_type: sentence(r.COMP_SUB_TYPE || null), substation: r.SUBSTATION || null,
    address: null, customer_account: null, remarks: null, closing_remarks: null, closed_by: null, source: null,
    je_name: null, je_mobile: null, ae_name: null, ae_mobile: null, xen_name: null, xen_mobile: null,
    subdivision: null, assigned_to: null, base_level: null, initial_user: null, raw_fields: r,
  };
};

// The full record (your remarks, closing note, officers, area). The old status lookups answer again once signed in,
// keyed by DATA_ID (from the by-phone list). ~4 s, so it loads when a complaint is opened, not for the whole list.
const DETAIL_FIELDS: [number, number][] = [
  [52071, 39534], [38886, 30729], [38802, 30652], [38801, 30649], [132178, 171344], [132179, 171345],
  [141575, 196468], [52072, 39533], [52070, 39532], [49309, 37796], [44465, 33863], [44464, 33861],
  [38799, 30650], [141568, 196464], [53818, 41156], [143359, 195495], [141574, 196467], [76757, 61895],
  [140740, 189709], [141570, 196463], [141566, 196462], [141569, 196465], [49308, 37795], [38800, 30651],
  [38069, 30066], [141567, 196466], [38884, 30728], [38883, 30727], [140741, 189711], [141572, 196470],
  [141573, 196469], [44941, 33869], [140763, 189749], [141571, 196471], [38070, 30076], [83024, 66362],
  [144430, 198595], [93222, 81760], [38812, 30669],
];

/** One complaint in full, by number; null when it isn't this number's. */
export async function complaintDetail(no: string): Promise<ComplaintDetail | null> {
  const a = auth();
  if (!a) throw needLogin();
  const mine = (await lookup("38064", [["38068", "30065", [["38062", a.mobile]]]], LIST_FORM))["38068"] ?? [];
  const id = mine.find((r) => r.COMPLAINT_NO === no)?.DATA_ID;
  if (!id) return null;
  const got = await lookup("38068", DETAIL_FIELDS.map(([c, ac]) => [String(c), String(ac), [["38068", id]]]), LIST_FORM);
  const m: Row = {};
  for (const rows of Object.values(got)) for (const r of rows) for (const [k, v] of Object.entries(r)) if (v && !m[k]) m[k] = v;
  const pick = (k: string) => m[k] || null;
  const status = pick("COMPLAINT_STATUS") ?? "";
  return {
    data_id: id, complaint_no: no, status, is_open: !/close/i.test(status),
    entry_date: pick("ENTRYDATE"), closing_date: pick("CLOSINGDATE"), consumer_name: pick("CONSUMER_NAME"), mobile_no: mobile10(pick("MOBILENO")),
    address: pick("ADDRESS"), customer_account: pick("CUSTOMERACNTNO"), remarks: pick("REMARKS"), closing_remarks: pick("CLOSINGREMARKS"),
    closed_by: pick("CLOSEDBY"), type: sentence(pick("COM_TYPE_NAME")), sub_type: sentence(pick("COM_SUB_TYPE_NAME")), source: pick("SRC"),
    // UPPCL's officer fields are messy: capitals, cut-off brackets, numbers padded with 00, a line name in JE_NAME.
    je_name: personName(pick("JE_NAME")), je_mobile: mobile10(pick("JE_MOBILE")), ae_name: personName(pick("AE_NAME")), ae_mobile: mobile10(pick("AE_MOBILE")),
    xen_name: personName(pick("XEN_NAME")), xen_mobile: mobile10(pick("XEN_MOBILE")), subdivision: pick("SUBDIVISION"), substation: pick("SUBSTATION"),
    assigned_to: pick("ASSIGNED_TO"), base_level: pick("BASE_LEVEL"), initial_user: pick("INITIALUSER"), raw_fields: m,
  };
}

/** `?action=my` → { phone, complaints }: the signed-in number's complaints, open first, newest first. */
export async function complaints(_query: string): Promise<{ phone: string; complaints: ComplaintDetail[] }> {
  const a = auth();
  if (!a) throw needLogin();
  const [open, closed] = await Promise.all([listOf("CP"), listOf("CC")]);
  const list = [...open, ...closed].filter((r) => r.COMP_NO).map(fromRow);
  const at = (x: ComplaintDetail) => parseUppclDate(x.entry_date)?.getTime() ?? 0;
  return { phone: a.mobile, complaints: list.sort((x, y) => Number(y.is_open) - Number(x.is_open) || at(y) - at(x)) };
}

/** How the complaint was filed, from UPPCL's source field ("1912", "1912 Web", "WhatsApp"…). */
export function sourceKind(src: string | null | undefined): "call" | "web" | "whatsapp" | "sms" | "app" | null {
  const v = String(src ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("whatsapp")) return "whatsapp";
  if (v.includes("sms")) return "sms";
  if (v.includes("web")) return "web";
  if (/app|smart|mobile/.test(v)) return "app";
  return v.includes("1912") ? "call" : null;
}

/** Filed → closed (or → now while open), in ms; null when UPPCL's dates don't parse. */
export function openFor(c: { entry_date: string | null; closing_date: string | null; is_open: boolean }, now = Date.now()): number | null {
  if (!c.entry_date?.includes(":") || (!c.is_open && !c.closing_date?.includes(":"))) return null; // dates without a time
  const from = parseUppclDate(c.entry_date)?.getTime();
  const to = c.is_open ? now : parseUppclDate(c.closing_date)?.getTime();
  return from && to && to >= from ? to - from : null;
}

// ─── Filing a supply complaint (no power, low voltage): form 6444 ────────────
// Filing a supply complaint (no power / low voltage) on 1912. Everything before the save is a lookup; the save
// writes a real ticket for the line JE, so it lives in fileSupplyComplaint only, on the user's explicit tap.

export type SupplyProblem = "no_power" | "voltage";
const SUB_TYPE: Record<SupplyProblem, string> = { no_power: "CST120", voltage: "CST147" }; // NO SUPPLY, VOLTAGE FLUCTUATION

export interface Place { id: string; name: string }
export interface SupplyDraft {
  problem: SupplyProblem;
  outage: "Individual" | "Area";
  account: string;
  district: Place;
  /** From UPPCL's own record of the account, to show before the user confirms. */
  name: string | null;
  mobile: string | null;
  substation: string | null;
  subdivision: string | null;
  /** UPPCL's reason it won't take this complaint now (e.g. one is already open); no Save then. */
  blocked: string | null;
  /** Every control the save carries, id → value. Opaque to the UI. */
  controls: Record<string, string>;
  /** Which 1912 form the controls are for ("9212" signed-in Register Complaint). */
  form?: string;
}

type Child = [control: string, ac: string, parents?: [string, string][]];
async function lookup(event: string, kids: Child[], form: string): Promise<Record<string, Row[]>> {
  const xml = header(event) + kids.map(([cid, ac, parents = []]) =>
    `<Child Control_Id="${cid}" Report="HTML" AC_ID="${ac}">` +
    parents.map(([p, v]) => `<Parent Control_Id="${p}" Value="${xmlAttr(v)}" Data_Form_Id=""/>`).join("") + "</Child>",
  ).join("") + "</Request>";
  return parseByChild(await postApi(xml, form));
}
const first = (rows: Row[] | undefined) => (rows?.[0] ? (Object.values(rows[0])[0] ?? "") : "");
const place = (rows: Row[] | undefined): Place | null => {
  const v = rows?.[0] ? Object.values(rows[0]) : [];
  return v[0] ? { id: v[0], name: v[1] ?? v[0] } : null;
};
/** Everything up to the Save button, for a connection added to the signed-in 1912 number (is1912NotLinked if not). */
export async function prepareSupplyComplaint(input: { account: string; problem: SupplyProblem; outage: "Individual" | "Area" }): Promise<SupplyDraft> {
  if (sample()) return { ...(platform.mock!("complaints:prepare") as SupplyDraft), problem: input.problem };
  return prepare9212(input);
}

// ─── Signed-in "Register Complaint" (form 9212) ──────────────────────────────
// Read from 1912's own page (GetControlsA + EventManagerV3.fnSaveData), driven by hand on a linked account, Oct 2026:
// the page lists the number's linked accounts; "Select Account" fills district/substation/name/address from it;
// the sub-type's change runs 1912's "can this be filed now?" check; Register saves the 28 controls below.
const FORM_9212 = "9212";
const SAVED_9212 = ["94160", "94158", "95914", "94162", "147223", "147225", "147226", "147228", "147227", "147229", "147224", "100149",
  "94168", "148864", "100379", "148103", "94156", "100388", "94167", "94163", "94159", "94166", "95916", "95915", "149519", "95921", "145725", "147231"];
const notLinked = () => new ProxyError(409, NOT_LINKED, undefined, "complaints");

async function prepare9212(input: { account: string; problem: SupplyProblem; outage: "Individual" | "Area" }): Promise<SupplyDraft> {
  const load = await lookup("0", [["142641", "198991"], ["145725", "201033"], ["95921", "88454"]], FORM_9212);
  const row = (load["142641"] ?? []).find((r) => r.ACCOUNT_NO === input.account);
  if (!row) throw notLinked();
  const A: [string, string][] = [["142641.29434", row.DATAID ?? ""], ["142641.29429", row.LBL ?? ""]];
  const ev = "142641.29431"; // the row's "Select Account"
  const sel = await lookup(ev, [
    ["94168", "194172", A], ["94157", "194173", A], ["94161", "194179", A], ["94159", "194174", A],
    ["94167", "194177", A], ["94163", "194178", A], ["94166", "194175", A],
    ["148864", "205219", A], ["148103", "204642", [A[1], A[0]]], ["149519", "205795", [A[0], A[0]]],
  ], FORM_9212);
  const substation = place(sel["94159"]);
  const sub = SUB_TYPE[input.problem];
  const c: Record<string, string> = Object.fromEntries(SAVED_9212.map((id) => [id, ""]));
  Object.assign(c, {
    94160: "CT019", 94158: sub, 95914: input.problem === "no_power" ? (input.outage === "Area" ? "Whole Area" : "Individual") : "",
    100149: row.ACCOUNT_NO ?? input.account, 94168: place(sel["94168"])?.id ?? "", 94159: substation?.id ?? "",
    94167: first(sel["94167"]) || row.CONSUMER_NAME || "", 94163: first(sel["94163"]) || input.account, 94166: first(sel["94166"]) || row.ADDRESS || "",
    148864: first(sel["148864"]) || row.METER_NO || "", 148103: first(sel["148103"]) || row.SM_VENDOR || "", 149519: first(sel["149519"]),
    145725: mobile10(first(load["145725"])) ?? "", 95921: first(load["95921"]),
  });
  const draft: SupplyDraft = {
    problem: input.problem, outage: input.outage, account: c[94163], district: place(sel["94168"]) ?? { id: c[94168], name: "" },
    name: c[94167] || null, mobile: c[145725] || null, substation: substation?.name ?? null, subdivision: place(sel["94161"])?.name ?? null,
    blocked: null, controls: c, form: FORM_9212,
  };
  if (!c[94159]) return { ...draft, blocked: "1912 has no substation for this connection" };
  return check9212(draft);
}

/** Picking the sub-type runs 1912's checks: its codes, and "0" = can be filed now (else why not, e.g. one is already open). */
async function check9212(draft: SupplyDraft): Promise<SupplyDraft> {
  const c = { ...draft.controls };
  const S: [string, string][] = [["94158", c[94158]]];
  const v = await lookup("94158", [
    ["95916", "88434", S], ["95915", "93715", S], ["147231", "203020", S],
    ["151602", "210455", [["94158", c[94158]], ["145725", c[145725]], ["94159", c[94159]], ["94163", c[94163]]]],
    ["151601", "210456", [["94163", c[94163]], ["94159", c[94159]], ["145725", c[145725]], ["94158", c[94158]]]],
  ], FORM_9212);
  Object.assign(c, { 95916: first(v["95916"]) || c[94158], 95915: first(v["95915"]), 147231: first(v["147231"]) || "0" });
  const ok = (first(v["151602"]) || "0") === "0";
  return { ...draft, controls: c, blocked: ok ? null : first(v["151601"]) || "1912 won't take this complaint right now" };
}

/** The XML 9212's Register sends (EventManagerV3 fnSaveData), as the signed-in user. Pure, so it can be checked. */
export function save9212Xml(draft: SupplyDraft, remarks: string, who: { login: string; role: string }, now = new Date()): string {
  const values: Record<string, string> = { ...draft.controls, 94162: cleanRemarks(remarks) };
  return `<?xml version="1.0"?><FORM IUVLOGINID="${xmlAttr(who.login)}" USERID="${xmlAttr(who.login)}" ROLE_ID="${who.role}" ID="${FORM_9212}" COMPANY_ID="${COMPANY_ID}" EventControlID="94164" SRC="W">` +
    `<DATA DATE="${saveDate(now)}"><UNIQUEID VALUE="${uniqueId(now)}"/><LATITUDE VALUE="" /><LONGITUDE VALUE="" />` +
    SAVED_9212.map((id) => `<CONTROL ID="${id}" VALUE="${xmlAttr(values[id] ?? "")}" />`).join("") + "</DATA></FORM>";
}

/** The remarks field refuses < > , $ | ' " (its own regex); keep the words, drop those. */
export const cleanRemarks = (text: string) => text.replace(/[<>,$|'"]/g, " ").replace(/\s+/g, " ").trim();

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const hex4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
/** "01-Oct-2026 21:05:09" and the page's GetUniqueID, as fnSaveData stamps every save. */
const saveDate = (now: Date) => `${pad(now.getDate())}-${MONTHS3[now.getMonth()]}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const uniqueId = (now: Date) => [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].reduce((u, n) => u + n + hex4(), hex4());

/** "…Your Complaint No. is MV01012612345" → "MV01012612345". */
export function complaintNoIn(text: string): string | null {
  return /complaint\s*no\.?\s*(?:is)?\s*:?\s*([A-Z]{2}\d{6,})/i.exec(text)?.[1] ?? null;
}

/**
 * Files the complaint: a real ticket for the line JE. Only on the user's explicit tap, never automatically.
 * Never exercised against the live portal (Oct 2026): the request mirrors the page's own Save.
 */
export async function fileSupplyComplaint(draft: SupplyDraft, remarks: string): Promise<{ ok: boolean; complaintNo: string | null; message: string }> {
  if (sample()) return platform.mock!("complaints:file") as { ok: boolean; complaintNo: string | null; message: string };
  if (draft.blocked) return { ok: false, complaintNo: null, message: draft.blocked };
  if (!cleanRemarks(remarks)) return { ok: false, complaintNo: null, message: "Say what's wrong in a few words" };
  if (FILING_OFF) throw filingPaused();
  refuseSample(); // belt and braces: the one call that creates a real ticket
  const a = auth();
  if (!a) throw needLogin();
  if (draft.form !== FORM_9212) throw notLinked(); // the anonymous form (6444) no longer files
  // The screens set "who's affected" on the old form's id (95303); 9212 names it 95914, "Whole Area" for an area.
  const outage = draft.controls[95303];
  const d = outage && draft.problem === "no_power" ? { ...draft, controls: { ...draft.controls, 95914: outage === "Area" ? "Whole Area" : "Individual" } } : draft;
  const r = await send("complaints", "api/AppsavyServices/UploadSurveyDataNewA", {
    method: "POST", cache: "no-store", headers: apiHeaders(FORM_9212, a),
    body: JSON.stringify({ xmlString: b64(save9212Xml(d, remarks, a)), EventControlID: "94164", DocVersion: 1 }),
  });
  if (!r.ok) throw new ProxyError(r.status, `1912 portal: HTTP ${r.status}`, undefined, "complaints");
  const raw = await r.text();
  const ok = /<RESULT>\s*1\s*<\/RESULT>/i.test(raw);
  const message = unxml(/<RESULTMESSAGE>([\s\S]*?)<\/RESULTMESSAGE>/i.exec(raw)?.[1]?.trim() ?? "");
  if (!ok) return { ok: false, complaintNo: null, message: message || "1912 didn't take the complaint" };
  // The number is usually in the message; else it's the newest pending one on this number (Complaint Status).
  let complaintNo = complaintNoIn(message);
  if (!complaintNo) {
    try {
      const at = (r: Row) => parseUppclDate(r.REG_DATE)?.getTime() ?? 0;
      complaintNo = (await listOf("CP")).sort((x, y) => at(y) - at(x))[0]?.COMP_NO ?? null;
    } catch { /* the Complaints tab lists it anyway */ }
  }
  return { ok: true, complaintNo, message };
}

// ─── The user-sent channels (fallback when in-app filing can't go through) ───────
/** Public UPPCL complaint channels (printed on every bill — not secrets). */
export const HELPLINE_TEL = "1912";            // 24×7 toll-free
export const COMPLAINT_SMS_NUMBER = "5616195"; // SMS shortcode

/** UPPCL's SMS complaint format for a supply outage. */
export function noPowerSms(site: { connectionId: string; tenantId?: string }): string {
  return `NO POWER ${site.connectionId} ${site.tenantId?.toUpperCase() ?? ""}`.trim();
}

/** A ready-to-send complaint SMS link. iOS wants `sms:<n>&body=`; Android (and the web) `sms:<n>?body=`. */
export function noPowerSmsUrl(site: { connectionId: string; tenantId?: string }, ios = false): string {
  return `sms:${COMPLAINT_SMS_NUMBER}${ios ? "&" : "?"}body=${encodeURIComponent(noPowerSms(site))}`;
}
