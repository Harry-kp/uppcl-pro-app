# Privacy policy: Bijli Saathi for UPPCL

_Last updated: 1 October 2026_

Bijli Saathi is an unofficial, open-source app for UPPCL smart-meter customers. It is not made by, or affiliated
with, UPPCL or any discom. There is no server of ours: the app on your phone talks directly to UPPCL.

## What the app handles, and where it goes

| Data | Why | Where it goes |
|---|---|---|
| Your UPPCL SMART username and password | To sign you in | Sent only to UPPCL SMART (`uppcl.sem.jio.com`). Not stored, unless you turn on alerts (below). |
| Your session (UPPCL's sign-in token) | To stay signed in | Stored on your phone only, in a file encrypted with AES-GCM; the key lives in the Android keystore. |
| Account details UPPCL returns (name, address, mobile, email, meter, usage, bills, payments, complaints) | To show them to you | Fetched from UPPCL and shown on your phone; a copy is cached on your phone so the app opens fast. |
| Bill payments | To pay your bill | Handled by UPPCL's own payment page (BillDesk). The app never sees your card or UPI details. |
| Complaints you file | To report a power problem | Sent only when you tap the button, to UPPCL's 1912 portal (`1912.uppcl.org`): your account number, the mobile UPPCL has on record (or another number you add) and your note. |
| Complaint status lookups | To show your complaints | Your registered mobile number is sent to UPPCL's 1912 portal. |
| Alerts (off by default) | Bill and balance reminders | If you turn them on, your UPPCL username and password are stored encrypted on your phone so the app can sign in again in the background. Removed when you turn alerts off or sign out. |

**We collect nothing.** No analytics, no ads, no tracking, no account with us. Nothing is sent to the developer.

The GitHub version of the app asks GitHub (`api.github.com`) for the latest release number; no account data is sent.
"Report a problem" opens GitHub in your browser, and nothing is sent until you submit it yourself.

**Sample data.** "Try with sample data" shows invented accounts. Nothing is sent to UPPCL while it is on.

## Deleting your data

Sign out (Settings → Sign out). This deletes everything the app stored on your phone: session, cached screens,
saved password (if alerts were on) and the home-screen widget's data. Uninstalling the app does the same.
Your data at UPPCL (account, bills, complaints) is UPPCL's; contact UPPCL to change it.

## Security

All connections to UPPCL use HTTPS. Stored data is encrypted with keys held in the Android keystore.
The code is public: https://github.com/Harry-kp/uppcl-pro-app

## Children

The app is for electricity account holders and is not directed at children under 13.

## Contact

Questions or problems: https://github.com/Harry-kp/uppcl-pro-app/issues
