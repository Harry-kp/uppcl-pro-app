/**
 * "Is it UPPCL or us?" — read-only health check of every upstream the app uses, with the app's own
 * crypto and headers. No login, no side effects; prints only status codes and UPPCL's status fields.
 *   bun scripts/check-upstreams.ts <account-number>
 */
import { wssDecrypt, wssEncrypt } from "../shared/crypto";
import { UPPCL_BASE, WSS_BASE, uppclBrowserHeaders, wssHeaders } from "../shared/upstream";

const kno = process.argv[2];
if (!kno) { console.error("usage: bun scripts/check-upstreams.ts <account-number>"); process.exit(1); }

async function timed(label: string, run: () => Promise<string>) {
  const t0 = Date.now();
  try { console.log(label.padEnd(34), await run(), `${Date.now() - t0} ms`); }
  catch (e) { console.log(label.padEnd(34), "NO ANSWER:", (e as Error).message, `${Date.now() - t0} ms`); }
}

async function wss(path: string, payload: Record<string, unknown>) {
  const r = await fetch(`${WSS_BASE}/uppclwss/${path}`, {
    method: "POST", headers: wssHeaders(), body: JSON.stringify({ _cdata: await wssEncrypt(JSON.stringify(payload)) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await r.json().catch(() => ({}))) as { _cdata?: string };
  const j = body._cdata ? JSON.parse(await wssDecrypt(body._cdata)) : body;
  const status = Object.fromEntries(Object.entries(j).filter(([k]) => /^(status|statusCode|statusMsg|ResMsg)$/.test(k)));
  return `HTTP ${r.status} ${JSON.stringify(status)}`;
}

await timed("UPPCL SMART (reachable?)", async () => `HTTP ${(await fetch(`${UPPCL_BASE}/uppclsmart/`, { headers: uppclBrowserHeaders(), signal: AbortSignal.timeout(20_000) })).status}`);
await timed("bill portal · GetDiscom", () => wss("v2/api/GetDiscom", { kno, discomName: "PVVNL" }));
await timed("bill portal · getConsumerDetails", () => wss("v2/api/getConsumerDetails", { kno, discomName: "PVVNL" }));
await timed("bill portal · GetPayBillDetails", () => wss("v2/InstaPayment/GetPayBillDetails", { kno, discomName: "PVVNL" }));
await timed("1912 portal (appsavy.com)", async () => `HTTP ${(await fetch("https://appsavy.com/", { signal: AbortSignal.timeout(15_000) })).status}`);
