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

const PROJECT_ID = "119", FORM_ID = "4235", ROLE_ID = "883", COMPANY_ID = "64";
const EVENT_CONTROL = "38068";
const LIST = { event: "38064", child: "38068", childAc: "30065", parent: "38062" };

// The portal's header "encryption": AES-128-CBC with a constant published key/IV (not a secret).
const KEY = new TextEncoder().encode("80".repeat(8));
const enc = (plain: string) => {
  const ct = cbc(KEY, KEY).encrypt(new TextEncoder().encode(plain)); // noble pads PKCS7 itself
  return btoa(String.fromCharCode(...ct));
};

let sessionAt = 0;
const SESSION_TTL = 15 * 60_000;

async function ensureSession(force = false) {
  if (!force && Date.now() - sessionAt < SESSION_TTL) return;
  // Each hop sets cookies; fetch follows the redirects and the native cookie jar keeps them.
  for (const path of [`UI/Anonymous?PROJECTID=${PROJECT_ID}&FORMID=${FORM_ID}`, `UI/Form?FormId=${FORM_ID}`]) {
    const r = await send("complaints", path, { headers: { accept: "text/html" }, cache: "no-store" });
    if (!r.ok) throw new ProxyError(r.status, `1912 portal session: HTTP ${r.status}`, undefined, "complaints");
  }
  sessionAt = Date.now();
}

async function postApi(inputXml: string, retry = true): Promise<string> {
  await ensureSession();
  const r = await send("complaints", "api/AppsavyServices/GetRelationalDataA", {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/xml, text/xml, */*; q=0.01",
      "content-type": "application/json",
      version: "1",
      "x-requested-with": "XMLHttpRequest",
      appsavylogin: enc("anonymous"), formid: enc(FORM_ID), roleid: enc(ROLE_ID), sourcetype: enc("WEB"), token: enc(""),
    },
    body: JSON.stringify({ inputxml: btoa(inputXml), DocVersion: 1 }),
  });
  if (r.status === 401 && retry) { sessionAt = 0; return postApi(inputXml, false); }
  if (!r.ok) throw new ProxyError(r.status, `1912 portal: HTTP ${r.status}`, undefined, "complaints");
  return r.text();
}

type Row = Record<string, string>;

function parseRowsets(raw: string): Row[] {
  const rows: Row[] = [];
  for (const block of raw.matchAll(/<RESULTS[^>]*>([\s\S]*?)<\/RESULTS>/gi)) {
    for (const set of block[1].matchAll(/<Rowset>([\s\S]*?)<\/Rowset>/gi)) {
      const row: Row = {};
      for (const f of set[1].matchAll(/<(\w+)\b[^>]*>([\s\S]*?)<\/\1>/g)) row[f[1]] = f[2].trim();
      if (Object.keys(row).length) rows.push(row);
    }
  }
  return rows;
}

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
    closed_by: pick("CLOSEDBY"), type: pick("COM_TYPE_NAME"), sub_type: pick("COM_SUB_TYPE_NAME"), source: pick("SRC"),
    je_name: pick("JE_NAME"), je_mobile: pick("JE_MOBILE"), ae_name: pick("AE_NAME"), ae_mobile: pick("AE_MOBILE"),
    xen_name: pick("XEN_NAME"), xen_mobile: pick("XEN_MOBILE"), subdivision: pick("SUBDIVISION"), substation: pick("SUBSTATION"),
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
