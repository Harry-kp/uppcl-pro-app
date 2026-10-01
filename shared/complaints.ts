/**
 * UPPCL's 1912 complaint portal (the Appsavy platform), called straight from the phone.
 *
 * Anonymous: no user credentials, just the registered mobile number to look complaints up by. The portal
 * moved from appsavy.com/coreapps/… (stopped answering, Oct 2026) to 1912.uppcl.org/… with the same session,
 * headers and XML. The session is cookies set across a redirect chain; the phone's native cookie jar keeps
 * them, so this no longer needs the web project's server route.
 */
import { cbc } from "@noble/ciphers/aes.js";
import { ProxyError, send } from "./api";
import { parseUppclDate } from "./utils";

const PROJECT_ID = "119", FORM_ID = "4235", ROLE_ID = "883", COMPANY_ID = "64";
const EVENT_CONTROL = "38068";
const LIST = { event: "38064", child: "38068", childAc: "30065", parent: "38062" };

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

let sessionAt = 0;
const SESSION_TTL = 15 * 60_000;

// One anonymous session serves every form's lookups (verified); the form id travels in the headers.
async function ensureSession(force = false, form = FORM_ID) {
  if (!force && Date.now() - sessionAt < SESSION_TTL) return;
  // Each hop sets cookies; fetch follows the redirects and the native cookie jar keeps them.
  for (const path of [`UI/Anonymous?PROJECTID=${PROJECT_ID}&FORMID=${form}`, `UI/Form?FormId=${form}`]) {
    const r = await send("complaints", path, { headers: { accept: "text/html" }, cache: "no-store" });
    if (!r.ok) throw new ProxyError(r.status, `1912 portal session: HTTP ${r.status}`, undefined, "complaints");
  }
  sessionAt = Date.now();
}

const apiHeaders = (form: string) => ({
  accept: "application/xml, text/xml, */*; q=0.01",
  "content-type": "application/json",
  version: "1",
  "x-requested-with": "XMLHttpRequest",
  appsavylogin: enc("anonymous"), formid: enc(form), roleid: enc(ROLE_ID), sourcetype: enc("WEB"), token: enc(""),
});

async function postApi(inputXml: string, form = FORM_ID, retry = true): Promise<string> {
  await ensureSession();
  const r = await send("complaints", "api/AppsavyServices/GetRelationalDataA", {
    method: "POST",
    cache: "no-store",
    headers: apiHeaders(form),
    body: JSON.stringify({ inputxml: b64(inputXml), DocVersion: 1 }),
  });
  if (r.status === 401 && retry) { sessionAt = 0; return postApi(inputXml, form, false); }
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

const header = (event: string) =>
  '<?xml version="1.0"?><Request VERSION="2" LANGUAGE_ID="" LOCATION="">' +
  `<Company Company_Id="${COMPANY_ID}" /><Project Project_Id="${PROJECT_ID}" />` +
  '<User User_Id="anonymous" /><IUVLogin IUVLogin_Id="anonymous" />' +
  `<ROLE ROLE_ID="${ROLE_ID}" /><Event Control_Id="${event}" />`;

// [control id, AC id] of every field on the complaint detail form.
const DETAIL_FIELDS: [number, number][] = [
  [52071, 39534], [38886, 30729], [38802, 30652], [38801, 30649], [132178, 171344], [132179, 171345],
  [141575, 196468], [52072, 39533], [52070, 39532], [49309, 37796], [44465, 33863], [44464, 33861],
  [38799, 30650], [141568, 196464], [53818, 41156], [143359, 195495], [141574, 196467], [76757, 61895],
  [140740, 189709], [141570, 196463], [141566, 196462], [141569, 196465], [49308, 37795], [38800, 30651],
  [38069, 30066], [141567, 196466], [38884, 30728], [38883, 30727], [140741, 189711], [141572, 196470],
  [141573, 196469], [44941, 33869], [140763, 189749], [141571, 196471], [38070, 30076], [83024, 66362],
  [144430, 198595], [93222, 81760], [38812, 30669],
];

async function detail(dataId: string): Promise<Record<string, unknown>> {
  const xml = header(EVENT_CONTROL) + DETAIL_FIELDS.map(([cid, ac]) =>
    `<Child Control_Id="${cid}" Report="HTML" AC_ID="${ac}"><Parent Control_Id="${EVENT_CONTROL}" Value="${dataId}" Data_Form_Id=""/></Child>`,
  ).join("") + "</Request>";
  const merged: Row = {};
  for (const row of parseRowsets(await postApi(xml))) for (const [k, v] of Object.entries(row)) if (v && !merged[k]) merged[k] = v;
  const pick = (k: string) => merged[k] || null;
  const status = pick("COMPLAINT_STATUS");
  return {
    data_id: pick("DATA_ID"), complaint_no: pick("COMPLAINT_NO"), status, is_open: status ? !status.toUpperCase().includes("CLOSE") : false,
    entry_date: pick("ENTRYDATE"), closing_date: pick("CLOSINGDATE"), consumer_name: pick("CONSUMER_NAME"), mobile_no: pick("MOBILENO"),
    address: pick("ADDRESS"), customer_account: pick("CUSTOMERACNTNO"), remarks: pick("REMARKS"), closing_remarks: pick("CLOSINGREMARKS"),
    closed_by: pick("CLOSEDBY"), type: sentence(pick("COM_TYPE_NAME")), sub_type: sentence(pick("COM_SUB_TYPE_NAME")), source: pick("SRC"),
    // UPPCL's officer fields are messy: capitals, cut-off brackets, numbers padded with 00, a line name in JE_NAME.
    je_name: personName(pick("JE_NAME")), je_mobile: mobile10(pick("JE_MOBILE")), ae_name: personName(pick("AE_NAME")), ae_mobile: mobile10(pick("AE_MOBILE")),
    xen_name: personName(pick("XEN_NAME")), xen_mobile: mobile10(pick("XEN_MOBILE")), subdivision: pick("SUBDIVISION"), substation: pick("SUBSTATION"),
    assigned_to: pick("ASSIGNED_TO"), base_level: pick("BASE_LEVEL"), initial_user: pick("INITIALUSER"), raw_fields: merged,
  };
}

async function listByPhone(phone: string) {
  const xml = header(LIST.event) +
    `<Child Control_Id="${LIST.child}" Report="HTML" AC_ID="${LIST.childAc}"><Parent Control_Id="${LIST.parent}" Value="${phone}" Data_Form_Id=""/></Child></Request>`;
  return parseRowsets(await postApi(xml)).map((row) => ({ data_id: row.DATA_ID, complaint_no: row.COMPLAINT_NO }));
}

/** "30/09/2026 10:15:00 PM" → ms, for newest-first sorting. */
function entryTime(raw: unknown): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(String(raw ?? "").trim());
  if (!m) return 0;
  const h = (Number(m[4]) % 12) + (/pm/i.test(m[7]) ? 12 : 0);
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5]), Number(m[6])).getTime();
}

/** Same answers the old web route gave: `?action=my&phone=…` → { phone, complaints }, `?action=detail&data_id=…` → one complaint. */
export async function complaints(query: string): Promise<unknown> {
  const q = new URLSearchParams(query.replace(/^\?/, ""));
  const phone = q.get("phone"), dataId = q.get("data_id");
  if (q.get("action") === "detail" && dataId) return detail(dataId);
  if (!phone) throw new ProxyError(400, "phone required", undefined, "app", "app");
  const list = await listByPhone(phone);
  // ponytail: detail for the first 20 only (one call each); a household has a handful, a shared number can have hundreds.
  const all = await Promise.all(list.filter((c) => c.data_id).slice(0, 20).map((c) => detail(c.data_id)));
  return { phone, complaints: all.sort((a, b) => entryTime(b.entry_date) - entryTime(a.entry_date)) };
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
  const from = parseUppclDate(c.entry_date)?.getTime();
  const to = c.is_open ? now : parseUppclDate(c.closing_date)?.getTime();
  return from && to && to >= from ? to - from : null;
}

// ─── Filing a supply complaint (no power, low voltage): form 6444 ────────────
// Replays what the 1912 portal's "Consumer Complaint Registration" page does (docs §11.1): district →
// complaint type → account search → area (substation, JE) → validate → save. Everything before the save
// is a lookup. SUPPLY RELATED needs no OTP and no captcha. The save writes a real ticket for the line JE,
// so it lives in fileSupplyComplaint only, and runs only on the user's explicit tap.

const REG_FORM = "6444";
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
  /** When the account's record has no area and its division couldn't be matched: the district's divisions (chooseDivision). */
  divisions: Place[];
  /** When the account's record has no substation, the ones in its division; the user picks (chooseSubstation). */
  substations: (Place & { subdivision: Place })[];
  /** UPPCL's reason it won't take this complaint now (e.g. one is already open); no Save then. */
  blocked: string | null;
  /** Every control the save carries, id → value. Opaque to the UI. */
  controls: Record<string, string>;
}

type Child = [control: string, ac: string, parents?: [string, string][]];
async function lookup(event: string, kids: Child[], form = REG_FORM): Promise<Record<string, Row[]>> {
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
const places = (rows: Row[] | undefined): Place[] =>
  (rows ?? []).map((r) => Object.values(r)).filter((v) => v[0]).map((v) => ({ id: v[0], name: v[1] ?? v[0] }));

/** "EUDD IV RAMPUR" ≈ "EUDD-4 RAMPUR", "Shanti Nagar Phase 2" ≈ "Shantinagar Phase-II": one spelling for matching. */
export function placeKey(v: string): string {
  const roman: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w) => roman[w] ?? w).join("");
}

// What form 6444 saves, in the page's order (every TO_BE_SAVED control except the Save button), with the
// value the page holds when nothing filled it: "" for empty inputs and "--Select--" dropdowns, label defaults.
const SAVED: [id: string, initial: string][] = [
  ["59929", ""], ["141592", "OR"], ["59932", ""], ["59933", ""], ["59934", ""], ["59935", ""], ["59937", ""], ["59936", ""],
  ["59944", ""], ["59945", ""], ["59930", "CT019"], ["59931", ""], ["95303", ""], ["147236", ""], ["147238", ""], ["147237", ""],
  ["147239", ""], ["147241", ""], ["147240", ""], ["147242", ""], ["59941", ""], ["59942", ""], ["59943", ""], ["145779", ""],
  ["143626", ""], ["143142", ""], ["130747", ""], ["59946", ""], ["90110", ""], ["59947", ""], ["59948", ""], ["59949", ""],
  ["75039", "1912"], ["76574", ""], ["100098", ""], ["60033", "N"], ["96559", ""], ["60044", ""], ["60032", ""], ["60042", ""],
  ["60043", ""], ["60034", "0"], ["85982", ""], ["85966", ""], ["90123", ""], ["90590", ""], ["95491", ""], ["95492", ""],
  ["101422", ""], ["121175", ""], ["121236", ""], ["130595", ""],
];
// Mandatory on the page (it refuses to save without them); REMARKS is checked at save time.
const REQUIRED: [id: string, what: string][] = [
  ["59929", "district"], ["59932", "discom"], ["59933", "zone"], ["59934", "circle"], ["59935", "division"], ["59936", "sub-division"],
  ["59937", "substation"], ["59944", "mobile number"], ["59931", "complaint type"], ["59941", "area type"], ["59942", "consumer name"],
  ["60044", "1912 agent"], ["60032", "section"], ["60042", "JE's number"], ["60043", "JE's name"],
];

/**
 * Everything up to the Save button: look the account up on 1912 and fill what the page would.
 * `division` is the bill portal's ("EUDD IV RAMPUR"); `substationHint` any text naming the substation
 * (a past complaint's substation, the address) to pick one when UPPCL's record of the account has none.
 */
/** 1912's districts, for filing on someone else's connection (the user picks theirs). */
export async function listDistricts(): Promise<Place[]> {
  return places((await lookup("0", [["59929", "60180"]]))["59929"]);
}

/**
 * The account's 1912 district: the one the user picked, else the bill address's city ("GHAZIABAD"), else the
 * district named inside the division ("EUDD IV RAMPUR"; longest name wins, so "MAU" can't match "AZAMGARH MAU…").
 * The city isn't always the district (Noida's is Gautam Buddha Nagar): then the user picks it (listDistricts).
 */
export function pickDistrict(all: Place[], input: { districtId?: string | null; city?: string | null; division?: string | null }): Place | undefined {
  if (input.districtId) return all.find((d) => d.id === input.districtId);
  const city = placeKey(input.city ?? "");
  const exact = city ? all.find((d) => placeKey(d.name) === city) : undefined;
  if (exact) return exact;
  const div = placeKey(input.division ?? "");
  return div ? all.filter((d) => placeKey(d.name).length >= 4 && div.includes(placeKey(d.name))).sort((a, b) => b.name.length - a.name.length)[0] : undefined;
}

export async function prepareSupplyComplaint(input: {
  account: string; city: string | null; districtId?: string | null; division?: string | null; substationHint?: string | null;
  problem: SupplyProblem; outage: "Individual" | "Area";
}): Promise<SupplyDraft> {
  const c: Record<string, string> = Object.fromEntries(SAVED);
  const sub = SUB_TYPE[input.problem];

  const load = await lookup("0", [["59929", "60180"], ["96559", "89446"], ["75039", "99106"]]);
  const district = pickDistrict(places(load["59929"]), input);
  if (!district) throw new ProxyError(404, `1912 doesn't list the district "${input.city ?? "?"}"`, undefined, "complaints");
  const P: [string, string][] = [["129225", input.account], ["59929", district.id]];
  const [byDistrict, found] = await Promise.all([
    lookup("59929", [["60044", "160216", [["59929", district.id]]], ["59932", "46474", [["59929", district.id]]]]),
    lookup("129228", [["129229", "160687", P], ["129275", "159715", P]]),
  ]);
  const row = found["129229"]?.[0];
  if (!row) throw new ProxyError(404, `1912 can't find this account in ${district.name}`, undefined, "complaints");

  Object.assign(c, {
    59929: district.id, 96559: first(load["96559"]), 75039: first(load["75039"]) || c[75039], 60044: first(byDistrict["60044"]),
    59932: place(byDistrict["59932"])?.id ?? "",
    59944: mobile10(first(found["129275"]) || row.MOBILE) ?? "", 59945: row.ACCOUNT_NO || input.account,
    59930: "CT019", 59931: sub, 95303: input.problem === "no_power" ? input.outage : "", // low voltage hides "outage type"
    59942: row.CONSUMER_NAME ?? "", 59946: row.ADDRESS ?? "", 90110: row.METER_NO ?? "", 145779: row.LOAD ?? "", 130595: row.SM_VENDOR_CODE ?? "",
  });
  const draft: SupplyDraft = {
    problem: input.problem, outage: input.outage, account: c[59945], district,
    name: c[59942] || null, mobile: c[59944] || null, substation: null, subdivision: null, divisions: [], substations: [], blocked: null, controls: c,
  };

  if (row.SUBSTATION_CODE && row.DIVISION_CODE) {
    // The account is mapped: the page's "select account" fills the whole area from it.
    // ponytail: written from the page's events, not seen live (the test account isn't mapped).
    const G: [string, string][] = [["129229.25463", row.DIVISION_CODE], ["129229.25464", row.SUBSTATION_CODE]];
    const S: [string, string][] = [["129229.25464", row.SUBSTATION_CODE]];
    const a = await lookup("129229.25384", [
      ["59932", "208361", G], ["59933", "208362", G], ["59934", "208363", G], ["59935", "208364", G], ["59936", "208365", G], ["59937", "208366", G],
      ["60043", "160704", S], ["60042", "160705", S], ["60032", "160706", S], ["60033", "160707", S], ["59941", "173171", S],
    ]);
    const area = { 59932: place(a["59932"]), 59933: place(a["59933"]), 59934: place(a["59934"]), 59935: place(a["59935"]), 59936: place(a["59936"]), 59937: place(a["59937"]) };
    for (const [id, p] of Object.entries(area)) if (p) c[id] = p.id;
    for (const id of ["60043", "60042", "60032", "60033", "59941"]) c[id] = first(a[id]) || c[id];
    draft.substation = area[59937]?.name ?? null;
    draft.subdivision = area[59936]?.name ?? null;
    return validate(draft);
  }

  // Not mapped (seen live on a smart postpaid account): pick the area the way a person would on the page,
  // division (matched to the bill portal's) → circle, zone, sub-divisions → their substations.
  const lists = await lookup("59929", [["59935", "46477", [["59929", district.id]]]]);
  const divisions = places(lists["59935"]);
  const division = divisions.find((d) => input.division && placeKey(d.name) === placeKey(input.division));
  // Someone else's connection (or an unknown spelling): the user picks the division, then the substation.
  if (!division) return { ...draft, divisions };
  return withDivision(draft, division.id, input.substationHint);
}

/** The user's division (one of draft.divisions): lists its substations to pick from. */
export async function chooseDivision(draft: SupplyDraft, divisionId: string): Promise<SupplyDraft> {
  return withDivision(draft, divisionId, null);
}

async function withDivision(draft: SupplyDraft, divisionId: string, substationHint: string | null | undefined): Promise<SupplyDraft> {
  const dv = await lookup("59935", [["59934", "47159", [["59935", divisionId]]], ["59933", "47160", [["59935", divisionId]]], ["59936", "46479", [["59935", divisionId]]]]);
  const c = { ...draft.controls, 59935: divisionId, 59934: place(dv["59934"])?.id ?? "", 59933: place(dv["59933"])?.id ?? "" };
  const subdivisions = places(dv["59936"]);
  const lists2 = await Promise.all(subdivisions.map((s) => lookup("59936", [["59937", "46480", [["59936", s.id]]]])));
  const next: SupplyDraft = { ...draft, controls: c, divisions: [], substation: null, subdivision: null,
    substations: lists2.flatMap((l, i) => places(l["59937"]).map((p) => ({ ...p, subdivision: subdivisions[i] }))) };
  const hint = placeKey(substationHint ?? "");
  const pick = hint ? next.substations.find((s) => hint.includes(placeKey(s.name)) || placeKey(s.name) === hint) : undefined;
  return pick ? chooseSubstation(next, pick.id) : next;
}

/** A second number the engineer can call (1912's "alternate mobile"); not checked, no OTP. */
export function withContact(draft: SupplyDraft, mobile: string | null, who: "Myself" | "Family" | "Others"): SupplyDraft {
  const m = mobile10(mobile);
  return { ...draft, controls: { ...draft.controls, 143142: m ?? "", 143626: m ? who : "" } };
}

/** The user's substation (one of draft.substations): fills the JE, section and agent the page does, then validates. */
export async function chooseSubstation(draft: SupplyDraft, substationId: string): Promise<SupplyDraft> {
  const s = draft.substations.find((x) => x.id === substationId);
  if (!s) throw new ProxyError(400, "Not one of this division's substations", undefined, "app", "app");
  const S: [string, string][] = [["59937", s.id]];
  const a = await lookup("59937", [
    ["60034", "46509", S], ["60032", "46511", S], ["60033", "46518", S], ["60042", "46513", S], ["60043", "46514", S], ["60044", "46521", S], ["59941", "85045", S],
  ]);
  const c: Record<string, string> = { ...draft.controls, 59937: s.id, 59936: s.subdivision.id };
  for (const id of ["60034", "60032", "60033", "60042", "60043", "60044", "59941"]) c[id] = first(a[id]) || c[id];
  return validate({ ...draft, controls: c, substation: s.name, subdivision: s.subdivision.name });
}

/** The page's "validate" step: UPPCL says 0 to allow a save, else why not (seen: 0, empty message). */
async function validate(draft: SupplyDraft): Promise<SupplyDraft> {
  const c = draft.controls;
  const missing = REQUIRED.filter(([id]) => !c[id]).map(([, what]) => what);
  if (missing.length) return { ...draft, blocked: `1912 has no ${missing.join(", ")} for this account` };
  const v = await lookup("151533", [
    ["151532", "210295", [["59944", c[59944]], ["59945", c[59945]], ["59931", c[59931]], ["59937", c[59937]]]],
    ["151534", "210296", [["59937", c[59937]], ["59944", c[59944]], ["59945", c[59945]], ["59931", c[59931]]]],
  ]);
  const ok = first(v["151532"]) === "0";
  return { ...draft, blocked: ok ? null : first(v["151534"]) || "1912 won't take this complaint right now" };
}

/** The remarks field refuses < > , $ | ' " (its own regex); keep the words, drop those. */
export const cleanRemarks = (text: string) => text.replace(/[<>,$|'"]/g, " ").replace(/\s+/g, " ").trim();

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const hex4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);

/** The exact XML the page's Save sends (EventManagerV3 fnSaveData). Pure, so it can be checked. */
export function supplySaveXml(draft: SupplyDraft, remarks: string, now = new Date()): string {
  const date = `${pad(now.getDate())}-${MONTHS3[now.getMonth()]}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const unique = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].reduce((u, n) => u + n + hex4(), hex4());
  const values: Record<string, string> = { ...draft.controls, 59949: cleanRemarks(remarks) };
  return `<?xml version="1.0"?><FORM IUVLOGINID="anonymous" USERID="anonymous" ROLE_ID="${ROLE_ID}" ID="${REG_FORM}" COMPANY_ID="${COMPANY_ID}" EventControlID="59950" SRC="W">` +
    `<DATA DATE="${date}"><UNIQUEID VALUE="${unique}"/><LATITUDE VALUE="" /><LONGITUDE VALUE="" />` +
    SAVED.map(([id, initial]) => `<CONTROL ID="${id}" VALUE="${xmlAttr(values[id] ?? initial)}" />`).join("") + "</DATA></FORM>";
}

/** "…Your Complaint No. is MV01012612345" → "MV01012612345". */
export function complaintNoIn(text: string): string | null {
  return /complaint\s*no\.?\s*(?:is)?\s*:?\s*([A-Z]{2}\d{6,})/i.exec(text)?.[1] ?? null;
}

/**
 * Files the complaint: a real ticket for the line JE. Only on the user's explicit tap, never automatically.
 * Never exercised against the live portal (Oct 2026): the request mirrors the page's own Save.
 */
export async function fileSupplyComplaint(draft: SupplyDraft, remarks: string): Promise<{ ok: boolean; complaintNo: string | null; message: string }> {
  if (draft.blocked) return { ok: false, complaintNo: null, message: draft.blocked };
  if (!cleanRemarks(remarks)) return { ok: false, complaintNo: null, message: "Say what's wrong in a few words" };
  await ensureSession(true, REG_FORM); // the page saves from its own form's session
  const r = await send("complaints", "api/AppsavyServices/UploadSurveyDataNewA", {
    method: "POST", cache: "no-store", headers: apiHeaders(REG_FORM),
    body: JSON.stringify({ xmlString: b64(supplySaveXml(draft, remarks)), EventControlID: "59950", DocVersion: 1 }),
  });
  if (!r.ok) throw new ProxyError(r.status, `1912 portal: HTTP ${r.status}`, undefined, "complaints");
  const raw = await r.text();
  const ok = /<RESULT>\s*1\s*<\/RESULT>/i.test(raw);
  const message = unxml(/<RESULTMESSAGE>([\s\S]*?)<\/RESULTMESSAGE>/i.exec(raw)?.[1]?.trim() ?? "");
  if (!ok) return { ok: false, complaintNo: null, message: message || "1912 didn't take the complaint" };
  // The page then opens "Registration Status" (form 8165), whose message names the number, looked up by mobile.
  let complaintNo = complaintNoIn(message);
  if (!complaintNo && draft.controls[59944]) {
    try {
      const s = await lookup("0", [["83611", "68430", [["83612", draft.controls[59944]]]]], "8165");
      complaintNo = complaintNoIn(first(s["83611"]));
    } catch { /* the Complaints tab lists it by phone anyway */ }
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
