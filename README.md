# Meter Pro for UPPCL

An **unofficial** Android companion app for UPPCL smart electricity meters (Uttar Pradesh, India).
It shows what the official apps bury: how many days your prepaid balance will last, what this month's
postpaid bill is heading to, your daily usage, your bills as PDFs, and a one-tap "no power" complaint.

> **iOS support is on the way.** The app is built with Expo / React Native, so an iPhone build is planned.
> Today only Android APKs are published.

Meter Pro is not made by, endorsed by, or affiliated with UPPCL, its discoms (PVVNL, MVVNL, DVVNL,
PuVVNL, KESCo) or Jio. It talks to UPPCL's own public systems using APIs that were reverse-engineered
from their web apps (see [docs/](docs/)). They can change or break at any time.

## Screenshots

Images go in [`docs/screenshots/`](docs/screenshots/). TODO: add these.

| Screen | File | Status |
|---|---|---|
| Home, prepaid (days left, recharge advice) | `docs/screenshots/home-prepaid.png` | TODO |
| Home, postpaid (bill due, month projection) | `docs/screenshots/home-postpaid.png` | TODO |
| Usage | `docs/screenshots/usage.png` | TODO |
| Bills + in-app PDF | `docs/screenshots/bills.png` | TODO |
| Complaints (no-power SMS, status) | `docs/screenshots/complaints.png` | TODO |
| Pay bill | `docs/screenshots/pay.png` | TODO |
| Home-screen widget | `docs/screenshots/widget.png` | TODO |
| Hindi + dark mode | `docs/screenshots/hindi-dark.png` | TODO |

## Features

- **Home for prepaid and postpaid.** Prepaid: balance, days left, when it runs out and how much to
  recharge for ~40 days. Postpaid: amount due and due date, or, before the bill is out, an estimate of
  the bill that's coming.
- **Usage.** Daily kWh, monthly history, spikes against your normal.
- **Bills.** Your bills and payments, with the official bill PDF opened inside the app (share or save it).
- **One-tap "no power" complaint.** Opens your SMS app with UPPCL's complaint SMS already written for
  your account; you just press send. Or call 1912.
- **Complaint status.** Your 1912 complaints, their status and the officer assigned.
- **Pay your bill in the app (NEW, still being verified).** Uses UPPCL's own bill-portal payment flow,
  which hands you to BillDesk (UPPCL's payment gateway) to pay. Meter Pro never sees card or UPI details.
  This path is new: until it's confirmed on many accounts, check the receipt, and use the official
  UPPCL site if anything looks off.
- **Bill budget alert.** Set a monthly budget; get told when the month is heading over it.
- **Alerts (opt-in).** Low prepaid balance, new bill, bill due soon, planned power cuts.
- **Home-screen widget.** Days of balance left, or your bill due.
- **App shortcuts.** Long-press the icon: no-power SMS, latest bill, pay.
- **Update check.** The app looks at this repo's latest GitHub Release and offers the newer APK.
- **Report a problem.** Opens a pre-filled GitHub issue (with the error details) for you to review and submit.
- **Hindi and English**, **light and dark mode**.
- **Errors say whose side they're on.** When something fails the app tells you whether it was UPPCL SMART,
  the bill portal, the 1912 portal or the app, and **Details → Copy details** gives you text to paste
  into a bug report.

## How it works

- The app talks **directly from your phone** to UPPCL SMART (`uppcl.sem.jio.com`, the smart-meter
  system) and to UPPCL's consumer portal (`consumer.uppcl.org`, bills, PDFs, payment). There is no
  Meter Pro server in between and no server stores your password.
- You sign in with your UPPCL SMART username and password. The session token is kept in the Android
  keystore (`expo-secure-store`) on your phone.
- **One exception: complaint status.** The 1912 complaint portal needs cookie handling that a phone app's
  networking can't do, so the complaint lookup goes through a small server route of the companion web
  project, [uppcl-pro](https://github.com/Harry-kp/uppcl-pro), deployed at
  `https://uppcl-pro.vercel.app/api/complaints`. It is sent your registered mobile number (no password,
  no token) and forwards it to the 1912 portal. That route is stateless: it doesn't store or log it.
  If that deployment is down, complaint status is unavailable; everything else keeps working.
- **Alerts** (off by default) need to sign in again in the background after your session expires. If you
  turn them on, your UPPCL username and password are stored **encrypted in the Android keystore on your
  phone only**, and removed when you turn alerts off or sign out. The checks run on the phone.
- The API notes are in [docs/api-reverse-engineering.md](docs/api-reverse-engineering.md) and
  [docs/payment-reverse-engineering.md](docs/payment-reverse-engineering.md).

## Limitations and known issues

- **Unofficial.** UPPCL can change its APIs without notice and the app will break until it's updated.
- **UPPCL outages are common.** The bill portal (`CCB_ISE_SE_503` = UPPCL's billing backend is down) and
  UPPCL SMART go down; the app tells you when it's their side. Retry later.
- **The 1912 complaint portal is flaky.** Lookups often hang or fail; the app gives up after 30 s.
- Only accounts on UPPCL SMART (smart meters) are supported.
- Numbers like "days left" and the bill estimate are predictions from your recent usage, not UPPCL figures.
- In-app payment is new (see above).

## Privacy

- No analytics, no ads, no tracking, no Meter Pro account.
- Your data goes only between your phone and UPPCL's servers, plus your mobile number to the complaint
  route described above. The update check asks `api.github.com` for the latest release (no account data).
  "Report a problem" only opens GitHub in your browser; nothing is sent until you submit the issue there,
  and issues are public, so remove anything personal first.
- Everything the app keeps (session, cached screens, budget, and your password only if you enabled alerts)
  stays on your phone. Signing out clears the session, the cached screens and the saved password.

## Install

1. On your Android phone, open the [latest release](https://github.com/Harry-kp/meter-pro/releases/latest).
2. Download `meter-pro-vX.Y.Z.apk` (each release also lists its SHA-256 checksum).
3. Open it. Android will ask you to allow installing apps from this source (your browser or Files app);
   allow it, then install.
4. Updates: the app tells you when a newer version is out; install the newer APK over the old one.
   Your sign-in is kept.

## Build from source

Needs [Bun](https://bun.sh), and for a device build the Android SDK and JDK 17.

```sh
bun install
bun run typecheck
bun test
bunx expo run:android          # debug build on a device or emulator
```

Release APK (what CI does): `bunx expo prebuild --platform android`, then
`cd android && ./gradlew assembleRelease` with a signing config. See
[.github/workflows/release.yml](.github/workflows/release.yml).

**Dev tools** (fake-data test scenarios) live in `src/dev`, run in dev builds only, and are removable
with `scripts/remove-dev-tools.sh`.

## Contributing

Bug reports and PRs are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). For a bug, please include the
text from **Details → Copy details** on the error. Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Harshit Chaudhary
