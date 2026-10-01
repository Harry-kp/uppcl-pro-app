# UPPCL SMART API — reverse-engineering reference

Source of truth for the full UPPCL backend API surface, derived from:
- The official SPA JS bundles at `uppcl.sem.jio.com/uppclsmart/` (endpoint registry).
- A captured HAR of a **postpaid** account session (verified request/response shapes).

All endpoints are `POST https://uppcl.sem.jio.com/accounts/api/<path>` with plaintext JSON
unless noted. Headers: `apikey`, `tenantid` (JSON `{isMultiLevel:true, code:<tenantCode UUID>}`),
`token` + `authorization: Bearer <jwt>`. Our proxy (`src/lib/proxy.ts`, mounted at
`/api/uppcl/*`) forwards these as-is.

> Capture context: device `<deviceId>`, connection `<connectionId>`, `tenantId:"pvvnl"`,
> `connectionType:"postpaid"`, `dataSource:"jeu"`, app version 2.7.4.

---

## 1. Prepaid vs postpaid: the data model that matters

The smart meter **always records daily kWh telemetry** (`eventsummary/*`). Prepaid vs postpaid
only changes the *billing* model:

| Concept | Prepaid | Postpaid |
|---------|---------|----------|
| Balance | `site/prepaidBalance` → live credit | `site/outstandingBalance` → arrears owed (`prepaidBalance:0`) |
| Bills | `bill/search` `type:dailyBill` → daily `dailyBill.daily_chg`/`closing_bal` | **empty** ("Bill not available"). Use `bill/billHistory` `type:monthlyBill` → one monthly invoice |
| Daily usage | `dailyBill` rows | `eventsummary/*` (telemetry — still present!) |
| Charges | deducted daily from balance | monthly invoice `bill_amt`, `due_dt` |

**Why our dashboard goes empty on postpaid:** every metric (runway, burn rate, recharge
lifespans, balance) is derived from `bill/search` `type:dailyBill`, which returns `[]` for
postpaid. The "daily quota" view didn't lose its data — it lost its *source*. Rebuild it from
`eventsummary` (kWh) + `bill/billHistory` (the monthly invoice).

**Discriminator:** `site.connectionType` is `"prepaid"` | `"postpaid"`. Branch on it.

---

## 2. Tenant / ID model (non-obvious)

From `site/search` `data[0]`:

| Field | Value (this account) | Use |
|-------|----------------------|-----|
| `connectionId` / `name` / `code` | `<connectionId>` | body `connectionId` / `consumerId` / `consumer_id` |
| `deviceId` | `<deviceId>` | body `deviceId` (eventsummary, solar, dadata) |
| `tenantId` | `pvvnl` (discom string, **not** a UUID) | body `tenantId` |
| `tenantCode` | `21337975-…` (UUID) | `tenantid` header `code`, `subTenantCode` |
| `discom` | `b3ba0ab0-…` (UUID = `DEFAULT_TENANT`) | — |
| `userId` | `6904c7ab9cc179775fd088f0` | body `userId` for `alert/search`, `ticket/search`, `feedback/create`, `site/search` |
| `dataSource` | `jeu` (also seen: `hes`, `jiostreams`) | controls `eventsummary/v2/search` payload shape |

The **user** record (`user/search`) has `tenantId:"uppcl"`, `tenantCode:b3ba0ab0-…` — different
from the site's. Use the **site's** tenantId (`pvvnl`) in data-endpoint bodies; this already
matches what `ids(site).tid` returns in `src/lib/api.ts`.

We do **not** currently capture `userId` in the session — needed for the alert/ticket/feedback
endpoints. It is available on every `site` record as `site.userId`.

---

## 3. Verified endpoints (live request/response from HAR)

### Balance
```
POST site/outstandingBalance   {connectionId, tenantId:"pvvnl"}
→ {data:{consumerId, outstandingAmount:"0.12", msi}}            // postpaid arrears
POST site/prepaidBalance       {connectionId}                   // prepaid; empty for postpaid
```

### Bills
```
POST bill/billHistory  {type:"monthlyBill", from:"01 Jun 2025", to:"30 Jun 2026",
                        tenantId:"pvvnl", fetchLatestBill:true, consumerId}
→ {data:{invoice_id, bill_from_dt, bill_amt:"1922", due_dt, bill_dt, payment_dt, payment_amt:"1900"}}
   // NOTE: postpaid returns a SINGLE object, not an array. Dates are "DD Mon YYYY".
POST bill/search       {connectionId, type:"dailyBill", from:<ISO>, to:<ISO>,
                        groupBy:"month", tenantId}
→ postpaid: {message:"Bill not available", data:[]}             // prepaid: daily rows
```

### Consumption / usage (the "daily quota" replacement — works on postpaid)
```
POST eventsummary/aggregate           {deviceId, from:"2026-06-01T00:00:00+05:30",
                                        to:"2026-06-30T23:59:59+05:30", uom:"KWH"}
→ {data:[ {energyImportKWH:{value,measureTime}, energyImportKVAH, energyExportKWH,
           power, powerKVA, powerFactor}, … ]}                  // one row per day

POST eventsummary/search              {deviceId, groupBy:"month", month:"06", year:"2026", uom:"KWH"}
→ same row shape, daily series for the month.                   // groupBy also: "year"

POST eventsummary/consumptionAggregation {deviceId, groupBy:"month", uom:"KWH", month:"06", year:"2026"}
→ {data:{averageConsumption:"12.65", maximumConsumption:"15.63", maximumPower:"2.20"}}
```

> **`eventsummary/aggregate` ~150-day cap (verified live).** Daily aggregate only
> serves roughly the last 150 days — any request whose `from` is older than ~150 days
> ago returns `data:[]`, even for a narrow span (e.g. `from`=240d ago, `to`=120d ago → empty).
> So daily-granularity history maxes at ~150 days; for a full year use the monthly
> `eventsummary/search` `groupBy:"year"` rollup instead. Request `days ≤ 150` for the daily series.

> **CLAUDE.md corrections.** These three were marked "known-broken"; they work with the right
> params: `consumptionAggregation` needs `groupBy`+`month`+`year`+`uom` (the "[object Object]"
> error was missing params); `eventsummary/search` works with `groupBy:"month"` (not only
> `"year"`); `eventsummary/aggregate` should send `uom` and an end-of-day `to`.

### Payments
```
POST payment/v2/search   {consumer_id, tenantId:"pvvnl"}
→ {data:[{txn_id, amt:"1900", payment_dt, status:"Success", payment_type, channel, msi}, …]}
```

### Alarms / alerts / tickets (new surfaces, all return 200 with [] when empty)
```
POST alarms/search        {connectionId, startDate:<ISO>, endDate:<ISO>, tenantId}
POST alarms/clear-notifications {connectionId, tenantId}
POST alert/search         {userId, startDate:<ISO>, endDate:<ISO>}     // app notifications
POST ticket/search        {status:"open", userId}                     // UPPCL-native complaints
POST feedback/create      {userId, rating:5, deviceType:"Browser", appVersion, username}
```

### Misc
```
POST site/solarTrend          {vendor:"pvvnl", deviceId}      → solar export trend ([] no solar)
POST connectionbudget/search  {connectionId, tenantId}        → budget config (409 if tenantId missing)
POST dadata/v2/search         {deviceId, compare:"week", fromDate:"YYYY-MM-DD", toDate, tenantId}
POST announcements/landing/search {status:"active", tenants:["uppcl","pvvnl"],
                                   types:["Announcements","Offers","Info","Alerts","Updates"]}
POST site/search              {userId, isActive:true, expire:true, flags:{isIgnoreTenantId:true}}
POST user/search              {_id:<userId>}                   // we send {skip,limit} — also works
POST userpreference/search    {userId}
GET  announcements/activeDowntimeAnnouncement  (no body)       → maintenance banner
```

---

## 4. Discovered-but-unexercised endpoints (shapes mined from JS bundle)

Not in the HAR; payload shapes inferred from minified call sites. **Probe live before relying on these.**

```
eventsummary/v2/search?skip=0&limit=1000   {deviceId, groupBy, uom, date:"YYYY-MM-DD"}
    // INTRADAY/granular usage. Payload varies by dataSource:
    //   jeu/hes + day view: add date (+ hes: from/to as "YYYY-MM-DDTHH:mm:ssZ")
    //   jiostreams: time:{from:<ms>, to:<ms>} instead of date
eventsummary/consumptionHistory            {deviceId, …}        // consumption history page
monthlyPrepaidSummary/search               {connectionId?, …}   // prepaid monthly rollup
bill/billDetails                           {…, bpno}            // needs bpno (not in any response we've seen)
bill/download                              {invoice_id?, …}     // bill PDF
site/daily-charges/download                {…}
site/monthly-charges/download              {…}
insight/getDocumentCount                   {…, subTenantCode}
insight/getDocumentDetails                 {…, subTenantCode}   // subTenantCode = site.tenantCode
savingTip/getOne                           {appliance:<code>}   // cachedPost; appliance energy tips
savingTip/search                           {…}
ticket/ticket-category                     GET                  → complaint categories
ticket/complaint-search                    {…, tenantId}        // track complaint by number
ticket/create                              multipart/form-data  // FormData: attachment[], subCategory, …
device/search                              {connectionId?, …}   // meter/device details
discom/search                              {…}                  // list of discoms
userMasterData/checkConnectionId           {consumer_id, returnUserDetails:true}  // validate/add connection
site/validateConnection                    {…}
connectionbudget/create                    {connectionId, tenantId, …}  // set usage budget/alerts
payment/initiate-payment | payment/v2/create | payment/quick-payment
payment/payment-verify | payment/doubleVerification | payment/v2/download
```

### Method-style endpoints (path parameter `/{id}`)
```
connectionbudget/update/{id}      site/update/{id}          site/delete/{id}
ticket/update/{id}                alarms/update/{id}        alarms/delete/{id}
alert/v2/update/{id}              alert/delete/{id}         site/v2/sitePreferences/{id}
site/isFetchDataActivate/{id}     user/v2/{id}              announcements/getOneImage/{id}
tenantMasterData/{update,delete,extend-access}/{id}
```
`alarms/update/{id}` PUT marks a meter alert read; body `{}`, query `{subTenantCode:site.tenantCode}`.

---

## 5. Complete endpoint registry (from SPA `urlService`)

<details><summary>All ~95 fixed-path endpoints</summary>

```
auth:        auth/v2/login, auth/v2/login/otp, auth/v2/login/token/verify, auth/logout,
             auth/session-check, auth/in-app-login(/verify), auth/partner-user-login
altcha:      altcha/createAltCaptcha, altcha/verifyAltCaptcha
site:        site/search, site/prepaidBalance, site/v2/prepaidBalance, site/outstandingBalance,
             site/validateConnection, site/unlinkSite, site/solarTrend, site/changeEmail(/verify),
             site/changePhone(/verify), site/v2/connection/sms/{email,phone}(/verify),
             site/v2/link-connection/verify/{email,phone}, site/daily-charges/download,
             site/monthly-charges/download
bill:        bill/search, bill/billHistory, bill/billDetails, bill/download
eventsummary: eventsummary/aggregate, eventsummary/search, eventsummary/v2/search,
             eventsummary/consumptionAggregation, eventsummary/consumptionHistory
payment:     payment/v2/search, payment/v2/create, payment/v2/download, payment/initiate-payment,
             payment/quick-payment, payment/payment-verify, payment/doubleVerification
alarms/alert: alarms/search, alarms/clear-notifications, alert/search, alert/clear-notifications
ticket:      ticket/search, ticket/create, ticket/complaint-search, ticket/ticket-category
budget:      connectionbudget/search, connectionbudget/create
user:        user/search, user/v2/register(+token/email,sms; +/verify), user/registration-complete,
             user/changePassword, user/v2/profileChangePassword(/verify), user/createPassword,
             user/resetPassword, user/deleteRequestCancel,
             user/v2/forgotPassword/token, user/v2/forgotUsername/token (+email/token variants),
             user/v2/updateEmail/token(/verify), user/v2/updatePhone/token(/verify)
userpreference: userpreference/search, userpreference/update, userpreference/language/update,
             userpreference/biometric
insight:     insight/getDocumentCount, insight/getDocumentDetails
savingTip:   savingTip/getOne, savingTip/search
dadata:      dadata/search, dadata/v2/search
announcements: announcements/search, announcements/landing/search, announcements/activeDowntimeAnnouncement
tenantMasterData: tenantMasterData/search, send-invite, resend-invite, accept-invitation,
             revoke-access, deleteMultiple
misc:        device/search, discom/search, monthlyPrepaidSummary/search, feedback/create,
             url/search, userMasterData/checkConnectionId
```
</details>

---

## 6. What this unlocks for the dashboard (postpaid + prepaid parity)

- **Balance card**: prepaid → `prepaidBalance`; postpaid → `outstandingBalance` (amount due) +
  `bill/billHistory` due date. Branch on `connectionType`.
- **"Daily usage" (quota replacement)**: `eventsummary/aggregate`/`search` kWh series for both
  meter types — independent of billing model. `eventsummary/v2/search` for intraday detail.
- **Usage stats**: `consumptionAggregation` (avg/max/peak power) — works for both.
- **This month's bill**: postpaid `bill/billHistory` (amount, due date, paid status).
- **New surfaces**: meter alarms (`alarms/search`), in-app alerts (`alert/search`), native
  UPPCL tickets (`ticket/search`/`create` — distinct from the Appsavy 1912 proxy), energy-saving
  tips (`savingTip/*`), solar (`site/solarTrend`), usage budgets (`connectionbudget/create`).
- **Estimated cost** for postpaid: kWh × tariff, or read straight from the monthly invoice.

### Implementation prerequisites
1. Capture `site.userId` into the session (`src/lib/session.ts` `SiteRecord` already allows
   arbitrary keys; surface it where alert/ticket calls need it).
2. Add `connectionType` to the typed `Site`/`SiteRecord` and branch the fetchers/UI on it.
3. Fix the three eventsummary calls (`uom`, `groupBy:"month"`, correct `consumptionAggregation`
   params) in `src/lib/api.ts`.
4. Add a postpaid `bill/billHistory` fetcher (single-object response, `type:"monthlyBill"`).

---

## 7. Live probe results (verified with a real JWT, June 2026)

Probed directly against `uppcl.sem.jio.com` with a live token. These supersede the inferred
shapes in §4.

### ✅ Newly cracked / confirmed

**`bill/billHistory` — full invoice history.** Omit `fetchLatestBill` to get an **array** of all
invoices instead of just the latest:
```
POST bill/billHistory {type:"monthlyBill", from:"01 Jan 2025", to:"30 Jun 2026",
                       tenantId:"pvvnl", consumerId}      // no fetchLatestBill
→ data:[ {invoice_id, bill_from_dt, bill_amt:"1922", due_dt, bill_dt, payment_dt, payment_amt},
         {…, bill_amt:"-383"},   // negative bill_amt = credit / advance balance
         … ]
```
With `fetchLatestBill:true` → single object (latest). **Feature:** full billing history timeline.

**`bill/download` — official bill PDF link.** (requires `subTenantCode` **header**)
```
HEADER subTenantCode: <site.tenantCode>            // 21337975-…
POST bill/download {billNo:<invoice_id>, connectionId, tenantId, date:"2026-06-03" (=bill_dt YYYY-MM-DD),
                    discom:<site.discom>}           // b3ba0ab0-…
→ {data:"https://consumer.uppcl.org/wss/download_billDLink?token=…"}   // link to the real PDF
```
**Feature:** "Download bill" button per invoice.

**`eventsummary/search` `groupBy:"year"` — 12 monthly rows + power factor.**
```
POST eventsummary/search {deviceId, groupBy:"year", year:"2026", uom:"KWH"}
→ data:[ {energyImportKWH:{value:152,…}, energyImportKVAH, energyExportKWH, power:{value:2.15},
          powerFactor:{value:0.98}}, … one row per month ]
```
`uom` accepts `"KWH"` or `"KVAH"`. Daily aggregate omits `powerFactor`; monthly/yearly include it.

**Telemetry available per eventsummary row** (richer than the dashboard uses today):
`energyImportKWH`, `energyImportKVAH`, `energyExportKWH/KVAH` (solar export), `power` (KW),
`powerKVA`, `powerFactor`, and `voltage` (day view). Enables: import vs export, apparent-power
(kVAh), power-factor trend, peak demand.

### ⚠️ Partially cracked (auth OK, body schema unresolved — return Joi `[object Object]`)
- **`insight/getDocumentCount` / `insight/getDocumentDetails`** — need `subTenantCode` **header**
  (passing it flips the error from "Sub Tenant Code is missing" to a body-validation error).
  Body schema still TBD — this is the stored-documents / bills-archive feature.
- **`eventsummary/v2/search`** — intraday/granular series. URL `?skip=0&limit=1000`,
  `groupBy` = calendarType (`"day"`). The default consumption call for week/month/year is plain
  `eventsummary/search?skip=0&limit=1000`. Exact v2 body schema for `jeu` still rejected; not
  blocking — `eventsummary/aggregate`+`search` already cover daily/monthly.

### ❌ Not deployed on this backend (404 "Invalid URL" / "Not Found")
`device/search`, `discom/search`, `payment/v2/download`, `site/daily-charges/download`,
`site/monthly-charges/download`, `announcements/search`, `dadata/search` (v1), `alert/v2/search`.
Use the working equivalents (`dadata/v2/search`, `alert/search`, `announcements/landing/search`).

### Other
- **`dadata/v2/search`** = appliance disaggregation ("DaData"): per-appliance breakdown
  (`ac`, `fridge`, `geyser`, `washing_machine`, `nightbaseload`, `others`). **Empty for this meter**
  (model not yet trained / insufficient data) but valid — powers the official `/appliance/summary` page.
- **`monthlyPrepaidSummary/search`** — prepaid-only; rejects with "ConsumerId missing" regardless of
  casing. Deprioritize for postpaid.
- **`ticket/ticket-category`** — `GET`, 200 with empty body here.
- **`userMasterData/checkConnectionId`** — needs an ALTCHA payload (it's part of the add-connection
  flow, not a data read).

---

## 8. Second API base: `/bootstrap/api`

`bootstrap = window.location.origin + "/bootstrap/api"` (vs `jps = origin + "/accounts/api"`).
Proxied at `/api/bootstrap/*` by the same `src/lib/proxy.ts` handler (same headers).

### `tenant/searchPreference` — UPPCL's entire feature catalog + discom config
```
POST /bootstrap/api/tenant/searchPreference {tenantId:"pvvnl"}
→ data: { landingPage, homePage, usage, applianceLevel, payment, myConnection, editConnection,
          alerts, applianceSurvey, customerService, discomDetails, feedback, ev_charging,
          serviceRequest, language }   // nested {isEnabled} feature flags for EVERYTHING
```
This is the competitive map — every capability the official app gates. Highlights:
- `homePage.usage`: energyConsumed, dailyAverage, usageLastMonth, **maxDemand**, **carbonEmission**
- `homePage`: budget, applianceLevel, alerts, insights, tips, **solarCalculator**, contacts, faq
- `homePage.currentBalance`: `balanceCard` (prepaid: paymentHistory, **prepaidLedger**, recharge,
  viewBill, monthlySummary) and `postpaidArrears` (payArrear, viewBill, monthlySummary)
- `usage`: load, voltage, pf, totalConsumption, maxConsumption, avgConsumption, maxDemand,
  consumption.**chargeCalculation**
- `payment`: **myTariff**, **enableAutopay**, **chargesAndAdjustments**, viewBills (+downloadBill)
- `applianceLevel`: applianceTrends, savingTips
- `ev_charging`, `applianceSurvey`, `serviceRequest` — whole feature areas

`discomDetails` (PVVNL): customer care `1912`, WhatsApp `+917859804803`, email `1912@pvvnl.org`,
`postpaidBalanceSource:"jeu"`, `prepaidBalanceSource:"jeu"`, `dataSource:"dap"`, discomCode `1001`,
play-store `com.jio.uttarurja`. → support-contact card, "report outage on WhatsApp" CTA.

> `tenant/searchOfflineCenters` exists too (physical payment/service centers — geolocation feature).

### `savingTip/getOne` / `savingTip/search` — localized energy tips
```
POST /accounts/api/savingTip/getOne {appliance:"fridge"}
→ data:[{tipEnglish:"Clean condenser coils…", tipHindi?, _id}]   // localized appliance tips
```
Valid appliance codes: `fridge`, `geyser`, `washing_machine`, `nightbaseload`, `others`.
`savingTip/search {appliance}` returns a different/general tip set.

---

## 9. The `/wss` legacy bill portal (consumer.uppcl.org) — official bill PDF ✅

The jio/uppclsmart `bill/download` deep-link is broken for jio-platform meters
("No Bill Details Found"). The **real official bill PDF** comes from UPPCL's legacy
portal at `https://consumer.uppcl.org/uppclwss`. **Cracked and wired end-to-end.**

**Crypto.** Every request *and* response body is AES-encrypted as `_cdata`:
```
_cdata = saltHex(32 bytes) + ivHex(16 bytes) + base64( AES-256-CBC(plaintext) )
key    = PBKDF2-SHA1(passphrase, salt, 1989 iterations, 32 bytes)
passphrase    = "2b57ea4715h#2d6abf1360e8"   (responseEncryptionKey, constant in the SPA)
appServiceKey = constant header, also from the SPA bundle (not user-specific)
```
Implemented in `src/lib/crypto.ts` (`wssEncrypt`/`wssDecrypt`, Web Crypto) + proxy
`src/app/api/wss/[...path]/route.ts`. Decryption verified against live `_cdata`.

**Direct PDF (one call):**
```
POST /uppclwss/v2/api/viewBillDownloadPDF   {_cdata: enc({
  kno: <connectionId>, discomName: "PVVNL" (UPPERCASE!), billNo: <invoice_id>,
  category: "10" (= site.accountType), identifierType: "UNMASKED" })}
→ {_cdata: enc({statusCode:"VIEW_BILL_PDF_200", Response: <base64 PDF>})}
```
Gotchas that cost time: `discomName` must be **UPPERCASE** (`"pvvnl"` → "not registered");
`category` is `site.accountType` (`"10"`); request body **must be encrypted**. Since ~Sep 2026
the portal ignores the old `flag: "BILL"` and returns `VIEW_BILL_PDF_200` with an **empty**
`Response` — send `identifierType: "UNMASKED"` (what the official SPA sends). Verified for
all 6 invoices (each ~1 MB PDF, incl. credit bills). Wired as `downloadBillPdf()` in `api.ts`.

**More `/wss` endpoints (same crypto, mostly unauthenticated via appServiceKey) — feature ideas:**
- `getConsumerDetails`, `getBillingSummary`, `GetDiscom` — official consumer + billing detail
- `consumption_history`, `consumption-calculator` — official usage + a bill estimator
- `bill-on-email` — register paperless/email bills from the app
- `online-payment-status`, `v2/InstaPayment/{viewArrear,accountArrear}` — arrears + payment status
- `service-request/*` — raise name/address correction, **load enhancement**, category change,
  disconnection, connection transfer, **meter complaints**, **solar-roof** application in-app
- `self-bill-generation`, `self-bill-gen-net-meter` — generate a bill (net-meter/solar)
- BillDesk SDK integration (`pay.billdesk.com`) — actually **pay the bill** in-app

### Verified `/wss` endpoints (live, decrypted — data collected)

Auth model: most read endpoints work with just the `appServiceKey` header (no login).
**Param-name quirk:** field names vary per endpoint — account id is `kno` / `accountID`
/ `accountId` / `kNumber`, and discom is `discomName` / `discom`. Match the SPA exactly.

| Endpoint | Payload (verified) | Returns | Auth |
|----------|--------------------|---------|------|
| `v2/api/GetDiscom` | `{kno, discomName}` | `{DiscomName}` | public |
| `v2/api/getConsumerDetails` | `{kno, discomName}` | full profile ↓ | public |
| `v2/api/viewBillDownloadPDF` | `{kno, discomName(UPPER), billNo, category, identifierType:"UNMASKED"}` | `{Response: base64 PDF}` | public |
| `v2/lastOnlinePaymentReciept` | `{kno, discomName}` | `{bytecode: base64 PDF}` (payment receipt) | public |
| `v2/InstaPayment/GetPayBillDetails` | `{kno, discomName}` | `{PayBillHomeDTO:{payableAmt, customerDetailsDTO}}` | public |
| `v2/InstaPayment/getArrearAmountStatus` | `{accountID, discom}` | `{data:{amount, status}}` | public |
| `v2/InstaPayment/viewArrear` | `{discomName, kno, reportName:"ARREAR"}` | `{byteCode: base64 PDF}` (arrears report) | public |
| `v2/Utility/getMeterData` | `{kNumber, discom, sanctionedLoad, connectionType}` | meter data ↓ | public |
| `v1/billSummary/getBillingSummary` | `{kno, discomName}` | — | **login** |
| `v1/consumptionDetails/getConsumptionDetails` | `{kno, discomName}` | — | **login** |
| `v1/api/onlinePaymentStatus`, `serviceRequestStatus` | `{kno, discomName}` | — | **login** |
| `v1/solarRoof/*`, `validateCategoryChangeRequest`, `selfBillGeneration/*` | — | — | **login** |

`getConsumerDetails.ConsumerDetails` (official, richer than jio): `kno`, `mobileNo`, `email`,
`currentAddress` (carries a scheme-eligibility note, e.g. "Bijli Bill Rahat Yojna 2025"),
`billingAddress`, `installationAddress`, `category` (`"10"`), `dueAmount` (`"1922"`),
`dueDate` (`"24-06-2026"`), `billNo`, `dateOfBirth`, `onlineBillingStatus` (`"EMAIL"`),
`division` (`"EUDD IV <CITY>"`), `subDivision`.

`getMeterData.data`: `purposeOfSupply` (`"LMV1"` — tariff category name), `supplyType` (`"10"`),
`badgeNumber`/`meterSerialNumber` (`"<deviceId>"`), `manufacturerCode` (`"CPS"`),
`meterConfigType` (`"SIMKW"`), `meterStatus` (`"ACTIVE"`), **`previousReadingKWH` (`"1256.62"`)**,
`previousReadDateTime` (`"01-JUN-2026"`), `leftDigit`/`rightDigit` (meter face config).

**PDFs available (all base64):** bill (`viewBillDownloadPDF`), payment receipt
(`lastOnlinePaymentReciept`), arrears report (`viewArrear`).

### `/wss` action endpoints (NOT probed — side effects; for future opt-in flows)
Payments: `InstaPayment/{updateConsumerInputAmount, processPaymentRequest, processPaymentRequestWithPG}`,
`SIPayment/CreateOrder`, `InstaPayment/getPaymentReciept`. Service requests:
`nameChangeRequest`, `addressChangeRequest`, `connectionTransferRequest`, `connDisconnRequest`,
`meterComplaintRequest`, `billCorrectionRequest`, `loadEnchancement/*`, `solarRoof/createCase`,
`selfBillGeneration/submitMeterReadingDetails`. Account/OTP: `registerUser`, `generateOtp`,
`sendOTP`/`verifyOTP`, `addSecondaryAccount`, `WAP/addWAPSubscription` (WhatsApp), `doKyc`.

---

> **Derived metrics (no endpoint — compute client-side from `eventsummary` kWh):** carbon emission
> (kWh × grid factor **0.8** kg CO₂/kWh), solar-savings calculator, effective ₹/kWh tariff
> (bill_amt ÷ units). These are how UPPCL implements `carbonEmission`/`solarCalculator`.
>
> **Carbon factor verified (June 2026).** UPPCL's Usage page shows 70.85 kg for 88.56 kWh →
> factor = 70.85 ÷ 88.56 = **0.80** exactly. There is **no carbon API**: `consumptionAggregation`
> returns only `{averageConsumption, maximumConsumption, maximumPower}` — no total, no carbon. The
> "Total" (88.56) is the client-side **sum of daily `eventsummary/aggregate` rows**, and carbon is
> that total × 0.8. Use 0.8 (not the CEA 0.71) so our numbers match UPPCL's app and bill.
</content>
</invoke>

## 10. October 2026 audit (live, read-only, signed in)

What changed, what's newly used, and what to avoid. Verified on a real postpaid PVVNL account (meter data
source `jeu`) while UPPCL's billing backend was down.

**Outage pattern.** When UPPCL's billing backend (CCB) is down, everything billing fails together and
everything else keeps working:
- bill portal: every call → HTTP 400 `CCB_ISE_SE_503` (a made-up account gets the same; it isn't our request)
- UPPCL SMART `bill/billHistory` → 409 "Unable to fetch bill history." (official site's exact body too)
- UPPCL SMART `site/outstandingBalance` → 409, with `?fetchCache=true|false` too
- still fine: dashboard, `eventsummary/*`, `bill/search`, `payment/v2/search`, `site/prepaidBalance`
`bun scripts/check-upstreams.ts <account>` tells the two apart in seconds.

**1912 complaint portal moved.** `appsavy.com/coreapps/…` stopped accepting connections; the same Appsavy
backend answers at `https://1912.uppcl.org/…` with no `/coreapps` prefix: `UI/Anonymous?PROJECTID=119&FORMID=4235`
→ `UI/Form?FormId=4235` (session cookies) → `POST api/AppsavyServices/GetRelationalDataA`. The app calls it
directly (`shared/complaints.ts`); the native cookie jar keeps the session. Officer fields are messy:
`JE_NAME` can be a line name ("11 KV LT 9000000021"), phones are `00`-padded, names carry "SHRI" and cut
brackets — cleaned at parse time (`mobile10`, `personName`).

**Newly used**
- `POST payment/v2/download` `{consumer_id, paymentId: <payment _id>, language, tenantId}` → a receipt PDF
  (binary, `%PDF`) for *any* payment. Replaces the bill portal's latest-receipt-only call.
- `POST eventsummary/v2/search?skip=0&limit=1000` → one day in 15-minute rows (96/day). Body depends on
  `site.dataSource`: `jeu` = `{deviceId, groupBy:"day", uom:"kWh", date, fromDate, toDate (IST ISO), consumerId,
  periodicity:"IN"}`; `hes` = `{…date, from: day-start − 1 s, to}`. Plain `{deviceId, groupBy, date}` → 409.
  No `voltage` on `jeu` meters (UPPCL SMART draws a voltage chart only where rows carry it; ideal 210–240 V).
- `eventsummary/aggregate` daily rows carry `power` (the day's peak, kW): the peak-vs-sanctioned-load gauge.
- site record (`site/search`): `meterPhase` ("1-PH-SMTMTR"), `meterInstallationDate`, `email`,
  `isPaperlessBillEnabled`, `dataSource`. `connectionDate` equals the smart-meter install date — not "connected since".

**Avoid**
- `connectionbudget/search` returns the account's **password hash and old password hashes** (`user[].password`,
  `oldPasswords[]`). Never fetch or cache it (the app's SWR cache is a plain JSON file).
- `eventsummary/consumptionAggregation` always answers `[]` — use the daily `power` instead.
- `ticket/create` is UPPCL SMART's help-desk ticket, not a 1912 power complaint; `ticket/ticket-category` is empty
  for PVVNL. Power complaints go by SMS (`NO POWER <account> <discom>` to 5616195), 1912, or the discom's WhatsApp.
- `tenant/searchPreference` for the super-tenant (to find SMART's "register complaint" `launchLink`) → 409
  outside UPPCL's own app; the discom-level answer has only on/off flags plus `discomDetails` (helpline, email, WhatsApp).

**Due-date rebate.** The bill PDF's "Payable by Due Date" is in the bill portal's `GetPayBillDetails` →
`PayBillHomeDTO.customerDetailsDTO.payAmtBeforeDueDt` (and `payAmtAfterDueDt` for after it); found in the portal's
`main.<hash>.js`. UPPCL SMART's `bill/billHistory` has no rebate field. Unverified with a live due bill: whether
`payableAmt` already includes the rebate before the due date.

**Gone:** `eventsummary/consumptionHistory` `{consumerId, TxID:"2345"}` (UPPCL SMART's "current bill" with
`dueDateRebate`, `amountPayableWithDueDate`, charges breakdown) → 404 "Invalid URL" (Oct 2026), though its web app
still calls it.

**Still unexplored:** `ticket/complaint-search` `{complaintNo, tenantCode}` (1912 status via UPPCL SMART — a
backup if the 1912 portal goes down again), `bill/download` (bill PDF via SMART; needs an invoice from billHistory).

## 11. Complaint registration (reverse-engineered, not exercised)

Researched read-only, Oct 2026. Nothing below was submitted: no save, no OTP, no account lookup with real
data. **Verified** means seen in the portal's JS or in an anonymous read the page itself makes when it loads.
**Inferred** means it follows from that code but no request was sent. Example values are made up.

### 11.1 1912 portal: anonymous web registration (Appsavy, project 119)

**Finding the form (verified).** On page load the anonymous session (from `UI/Anonymous?PROJECTID=119&FORMID=4235`,
same as `shared/complaints.ts`) calls `POST api/AppsavyServices/GetFormsMenu` `{"PROJECTID":"119","ROLEID":"883"}`.
That call lists every form the `anonymous` role can open. The complaint forms:

| FORM_ID | NAME | Caption | Notes |
|---|---|---|---|
| **6444** | CONSUMER_REGISTRATION | Consumer Complaint Registration | The one "Complaint Registration" on Consumer Home (13180) opens. `CAPTCHA=N`, `ISVERIFIED=N` |
| 13138 | CONSUMER_SMART_METER_REG | Consumer Complaint Registration Form | "Consumer App" variant (SOC default `CONSUMER APP`); account → discom/division/substation prefill |
| 8165 | Registration_Status | Registration Status | 6444's Save opens this page (`OPENPAGE`), passing UNIQUEID → 96556 and mobile → 83612 |
| 12257 | VALIDATE_OTP | Validate OTP | Dialog that 6444 opens for non-supply types |
| 4235 / 13493 | Status / COMPLAINT_STATUST_APP | Complaint status | 4235 is the one the app already uses |

`UI/Anonymous?PROJECTID=119&FORMID=6444` (and 13138) answers 200 and redirects to `UI/Form?FormId=…`. The landing
page's `fnOnClickRegComp` still points to `PROJECTID=304&FORMID=10228`, which is dead (404).

**Form definition (verified).** `POST api/AppsavyServices/GetControlsA` `{"PROJECTID":119,"USER":"anonymous"}`
(about 1.5 MB XML) returns every control (`Control_Rowset`) and event (`Event_Rowset`: `EVENT_CONTROL` → `ACTION`
on `CONTROL_ID` using `QUERY_ID` = the AC_ID, with `PARENT` inputs) for all anonymous forms. This is how the
control ids below were mapped. All headers are the same as for status lookups, except `formid` = enc("6444").

**Master data (verified, anonymous `GetRelationalDataA`).** Same XML envelope as `shared/complaints.ts`:

```xml
<Event Control_Id="0"/>                                   <!-- page load -->
<Child Control_Id="59930" Report="HTML" AC_ID="46416"/>   <!-- complaint types -->
<Child Control_Id="59929" Report="HTML" AC_ID="60180"/>   <!-- districts: DATA_ID, DISTRICT (e.g. 1015 AGRA) -->

<Event Control_Id="59930"/>                               <!-- type changed -->
<Child Control_Id="59931" Report="HTML" AC_ID="46492"><Parent Control_Id="59930" Value="CT019" Data_Form_Id=""/></Child>   <!-- sub-types -->
<Child Control_Id="129282" Report="HTML" AC_ID="158578"><Parent Control_Id="59930" Value="CT019" Data_Form_Id=""/></Child> <!-- COMP_TYPE flag -->
```

The types and sub-types that matter to the ReportSheet, with the `COMP_TYPE` flag that decides which fields
show (verified):

| App problem | Type | Sub-type | COMP_TYPE | OTP step? |
|---|---|---|---|---|
| No power / one phase gone | CT019 SUPPLY RELATED | CST120 NO SUPPLY | Y | **No** (Y hides REGISTERED_MOBILE_NO + VALIDATE_OTP) |
| Low / fluctuating voltage | CT019 | CST147 VOLTAGE FLUCTUATION | Y | No |
| Sparking at meter/cable | CT006 METER RELATED | CST223 LOOSE TERMINALS/SPARKING/CABLE ISSUE | N | **Yes** (N shows the OTP dialog) |
| Danger / accident | CT025 INFORMATION / QUERY | CST205 ELECTRICAL ACCIDENT INTIMATION | N | Yes |
| Prepaid cut-off after recharge | CT026 SMART METER/PREPAID | CST222 PAYMENT DONE BUT NOT RECONNECTED / CST109 METER POWER OFF | M | No |
| (pole / line) | CT027 SERVICE RELATED | CST134 POLE/LINE SHIFTING/POLE BROKEN | N | Yes |

There is no "phase" sub-type. One phase gone files as NO SUPPLY, with the detail in Remarks.

**Form 6444 flow for SUPPLY RELATED (control ids verified, sequence inferred from events):**
1. DISTRICT `59929` (from AC 60180), complaint type `59930`, sub-type `59931`, OUTAGE_TYPE `95303` (`Individual`/`Area`).
2. ACCOUNT_NO `129225` + ACCOUNT_SEARCH `129228`: event ACs 159164–159169, 159179, 159400, 159698, 160687 with
   parents ACCOUNT_NO and DISTRICT. These fill DISCOM_CODE `59932`, ZONE `59933`, CIRCLE `59934`, DIV `59935`,
   SUB_DIV `59936`, SUBSTATION `59937`, CONSUMER_NAME `59942`, MOBILENO `59944`, ADDRESS `59946`, and the ACCOUNT_DETAILS grid
   `129229`. Selecting a grid row (`129229.25384`) copies CUSTOMERACNTNO `59945`, JE_NAME/JE_MOBILE, SECTION and AREADOWN.
   **Not called**: it returns a real consumer's name, address and mobile.
3. VALIDATE_COMPLAINT_DETAILS `151533`: ACs 210295/210296 with MOBILENO, CUSTOMERACNTNO, sub-type and SUBSTATION →
   VALIDATE_CHK `151532`. SAVE `59950` becomes visible only when it returns `0`. Inferred to be a duplicate or
   open-complaint check; the message comes back in `ABC` `151534`. Not called.
4. REMARKS `59949` (mandatory; regex forbids `< > , $ | ' "`), then SAVE.

**Save (verified from `EventManagerV3.js` `fnSaveData` and `ServiceManagerV3.js` `fnUploadSurveyDataAsync`; never sent):**

```
POST https://1912.uppcl.org/api/AppsavyServices/UploadSurveyDataNewA
headers: same encrypted set as GetRelationalDataA (formid=enc("6444"))
body: {"xmlString": base64(utf8(xml)), "EventControlID": "59950", "DocVersion": 1}
```
```xml
<?xml version="1.0"?><FORM IUVLOGINID="anonymous" USERID="anonymous" ROLE_ID="883" ID="6444" COMPANY_ID="64" EventControlID="59950" SRC="W">
  <!-- only when a control-level OTP was verified: <OTP_REFRENCES VALUES="refNo:controlId:value:otp"/> -->
  <DATA DATE="<fnGetFormattedDate()>"><UNIQUEID VALUE="<random+yyyy+m+d+h+m+s>"/><LATITUDE VALUE=""/><LONGITUDE VALUE=""/>
    <CONTROL ID="59929" VALUE="1015"/>        <!-- district DATA_ID -->
    <CONTROL ID="59930" VALUE="CT019"/><CONTROL ID="59931" VALUE="CST120"/><CONTROL ID="95303" VALUE="Individual"/>
    <CONTROL ID="59932" VALUE="…"/> … <CONTROL ID="59937" VALUE="…"/>   <!-- discom…substation codes from the account search -->
    <CONTROL ID="59945" VALUE="1234567890"/><CONTROL ID="59944" VALUE="9000000000"/>
    <CONTROL ID="59942" VALUE="…"/><CONTROL ID="59946" VALUE="…"/><CONTROL ID="59949" VALUE="No supply since 9 pm"/>
    <!-- + hidden TO_BE_SAVED labels the page fills itself: JE_NAME 60043, JE_MOBILE 60042, SECTION 60032, INBOUND_AGENT 60044, PRIMARY_COMPLAINT_NO 60034, SOC 75039, … -->
  </DATA></FORM>
```

The response is XML `<RESULT>1</RESULT><RESULTMESSAGE>…</RESULTMESSAGE>`. The complaint number is inferred to be in
RESULTMESSAGE and/or on the Registration_Status page (8165), which the app reaches with the UNIQUEID. Not verified.

**Auth:** anonymous, no captcha (`CAPTCHA=N`), and for SUPPLY RELATED and prepaid types no OTP. Other types open
dialog 12257, which presumably sends an SMS OTP to the registered mobile.
**Risks:** this writes a real ticket that lands with the substation JE. Replaying ~25 hidden fields correctly is
fragile, because the server trusts the client to send JE, substation and agent values. The undocumented
`VALIDATE_CHK` gate decides whether Save is allowed at all. Rate limits are unknown, there's no published API, and
UPPCL could read automated filing as abuse. The control and AC ids change whenever UPPCL edits the form (13138 and
the 304/10228 link are both drift from earlier versions).

### 11.2 UPPCL SMART (uppcl.sem.jio.com), verified from the bundle

- "Register complaint" is not an API call. It runs `preference.homePage.serviceRequest.launchLink` (with
  `{{connectionId}}`/`{{discom}}` placeholders) or `customerService.raiseRequest.launchLink` through `openLinks`,
  which opens an external page. The target URL lives only in the super-tenant preference, which answers 409
  outside UPPCL's own app (§10). Inferred to be the 1912 form.
- `POST ticket/create` is a **multipart FormData** with `heading` (category), `sub_heading`, `description`,
  `status:"open"`, `userId`, `connectionId` (site `_id`), `consumerId` (account), `consumerName`,
  `deviceSource:"Web"|"Mobile"` and optional `attachment` files. The categories come from `GET ticket/ticket-category`. This is the
  SMART help desk (account, bill and app issues), not the 1912 outage queue. Confirms §10.
- `POST ticket/complaint-search` `{complaintNo, tenantCode}` (or `{connectionId, complaintNo}`) reads 1912 status. Read-only.

### 11.3 consumer.uppcl.org (/wss) bill portal, verified from `main.2dc555616dbad9af.js`

No power-complaint API. `complaint_reg` renders "SERVICE UNAVAILABLE"; `power_failure` is a static page listing
1800-180-1912. The one complaint-like call is `POST /v1/api/meterComplaintRequest` (a meter service request from
the logged-in, OTP-gated service-request flow), so it doesn't fit outages.

### 11.4 SMS keywords (verified, 1912 login page `popUpSmsCode`)

`NOPOWER <ACCOUNTID>` (no supply), `MTR <ACCOUNTID>` (defective meter) and `SOS <phone>` (emergency). The page gives
no shortcode; the app sends `NO POWER <account> <DISCOM>` to 5616195 (`shared/outage.ts`). Whether both spellings
parse is unverified.

### 11.5 Recommendation

Keep the user-sent channels for now and add one improvement: **pre-fill the right SMS keyword per problem**
(`NOPOWER`, `MTR` for meter sparking, `SOS` for danger). It's zero risk, and UPPCL logs it as a real complaint the
status screen already reads. In-app filing without OTP is **technically feasible for SUPPLY RELATED only**
(form 6444, anonymous, no captcha). It would need district + account (both already in the app), a registered mobile,
type/sub-type, outage type, and remarks. Before shipping it, run one supervised test filing from the owner's own
account to confirm the account-search → validate → save chain and where the complaint number comes back. Also
guard the server-side `VALIDATE_CHK` result, and file only on an explicit user tap, never automatically.
