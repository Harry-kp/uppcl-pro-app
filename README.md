# UPPCL Pro

**Your electricity, made simple.** · बिजली की हर बात, आसान

**[⬇ Download the latest APK](https://github.com/Harry-kp/uppcl-pro-app/releases/latest)** · Android 7+ · [how to install](#install)

> **Unofficial — not affiliated with UPPCL.** UPPCL Pro is an independent open-source app. It is not made
> by, endorsed by, or connected to UPPCL, its discoms (PVVNL, MVVNL, DVVNL, PuVVNL, KESCo) or Jio. It talks
> to UPPCL's own public systems using APIs that were reverse-engineered from their web apps
> (see [docs/](docs/)), which can change or break at any time.

An Android companion app for UPPCL smart electricity meters (Uttar Pradesh, India). It shows what the
official apps bury: how many days your prepaid balance will last, what this month's postpaid bill is
heading to, your daily usage, your bills as PDFs, and a one-tap "no power" complaint.

> **iOS support is on the way.** The app is built with Expo / React Native, so an iPhone build is planned.
> Today only Android APKs are published.

## Screenshots

<p align="center">
  <img src="docs/screenshots/01-bill-answered-first.png" width="24%" alt="Postpaid home: amount due and a Pay button"> <img src="docs/screenshots/02-prepaid-days-left.png" width="24%" alt="Prepaid home: days of balance left"> <img src="docs/screenshots/03-pay-in-one-tap.png" width="24%" alt="Paying a bill in the app"> <img src="docs/screenshots/04-usage-verdict.png" width="24%" alt="Usage: is this normal?">
</p>
<p align="center">
  <img src="docs/screenshots/05-bills-and-payments.png" width="24%" alt="Bills and payments with PDFs"> <img src="docs/screenshots/06-no-power-complaint.png" width="24%" alt="One-tap no-power complaint"> <img src="docs/screenshots/07-dark-mode.png" width="24%" alt="Dark mode"> <img src="docs/screenshots/08-hindi.png" width="24%" alt="Hindi">
</p>

<sub>Shown with invented test data (Settings → Developer → test scenarios in a dev build), never a real account.</sub>

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
  which hands you to BillDesk (UPPCL's payment gateway) to pay. UPPCL Pro never sees card or UPI details.
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
  UPPCL Pro server in between and no server stores your password.
- You sign in with your UPPCL SMART username and password. The session is kept on your phone in an
  encrypted file (AES-GCM) whose key lives in the Android keystore.
- **One exception: complaint status.** The 1912 complaint portal needs cookie handling that a phone app's
  networking can't do, so the complaint lookup goes through a small server route of the companion web
  project [uppcl-pro](https://github.com/Harry-kp/uppcl-pro), deployed at
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

- No analytics, no ads, no tracking, no UPPCL Pro account.
- Your data goes only between your phone and UPPCL's servers, plus your mobile number to the complaint
  route described above. The update check asks `api.github.com` for the latest release (no account data).
  "Report a problem" only opens GitHub (in your browser, or inside the app if the phone has none); nothing
  is sent until you submit the issue there,
  and issues are public, so remove anything personal first.
- Everything the app keeps (session, cached screens, budget, and your password only if you enabled alerts)
  stays on your phone. Signing out clears the session, the cached screens and the saved password.

## Install

**First time? You need a UPPCL SMART login.** UPPCL Pro signs in with the same username and password as
UPPCL's official UPPCL SMART app. If you don't have one, [sign up on UPPCL SMART](https://uppcl.sem.jio.com/uppclsmart/signup)
first. The app's sign-in screen also links to
sign-up and forgot username / password.

1. On your Android phone, open the [latest release](https://github.com/Harry-kp/uppcl-pro-app/releases/latest).
2. Download `uppcl-pro-vX.Y.Z.apk` (each release also lists its SHA-256 checksum).
3. Open it. Android will ask you to allow installing apps from this source (your browser or Files app);
   allow it, then install.
4. Updates: the app tells you when a newer version is out; install the newer APK over the old one.
   Your sign-in is kept.

**Check it's really this app.** Every official APK is signed with this key (SHA-256 certificate fingerprint):

```
42:5E:6D:CC:C8:67:2D:27:CD:F7:28:F7:BE:24:86:60:AD:D6:17:CC:39:5E:F8:59:C9:13:95:D7:FF:22:C5:CC
```

Android refuses to install an update signed with a different key over this one. If a site offers
"UPPCL Pro" signed differently, it isn't this app. To check a download yourself:
`apksigner verify --print-certs uppcl-pro-vX.Y.Z.apk`.

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
