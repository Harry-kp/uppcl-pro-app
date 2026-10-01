# Publishing on Google Play

Everything the app and repo need is done. What's left needs the maintainer's Google account.

## Already in the repo
- **Play build**: every `vX.Y.Z` tag's release workflow also builds `uppcl-pro-vX.Y.Z.aab` with
  `EXPO_PUBLIC_STORE=play` (no GitHub update check; Play forbids self-updating) and checks it.
  Download it from the workflow run's artifacts (kept 90 days).
- **Demo mode** for reviewers: "Try with sample data" on the sign-in screen (invented data; nothing is
  sent to UPPCL, complaints and payments included).
- **Listing text** (English + Hindi): `fastlane/metadata/android/{en-US,hi-IN}/`, screenshots in
  `…/images/phoneScreenshots/` (from demo mode: no real person on them).
- **Privacy policy**: `docs/privacy.md`. Its public URL:
  https://github.com/Harry-kp/uppcl-pro-app/blob/main/docs/privacy.md
- Permissions trimmed in `app.json` (`blockedPermissions`).

## One-time setup (maintainer)
1. Create a Play Console developer account ($25, identity verification).
2. Create the app: name from `title.txt`, default language English (India), app, free.
3. **Signing: keep the GitHub key.** Under App integrity → Play App Signing, choose to use your own key
   and upload the existing release keystore (kept outside the repo) with Google's
   PEPK tool, as the console shows. Same key = people who installed the GitHub APK can update from Play.
   A new Google-generated key would make the Play app unable to install over the GitHub one.
4. New personal accounts must run a **closed test with at least 12 testers for 14 days** before production.
   Start this first: it's the long pole.

## Forms (copy these answers)

**App access**: Some features need sign-in. Instructions for reviewers: "On the sign-in screen tap
*Try with sample data*. It opens a full sample account (postpaid, a bill due, complaints, usage). Nothing is
sent to UPPCL in sample mode." No credentials needed.

**Ads**: No ads.

**Content rating** (IARC): utility; no violence, sexual content, gambling, drugs, user-generated content shared
with others, or location sharing. Users interact with a third party (UPPCL) only through its official services.

**Target audience**: 18+ (account holders). Not designed for children.

**Data safety**
- Data collected (all *processed on the device or sent to UPPCL*, never to the developer):
  - Personal info: name, email, address, phone number: shown from UPPCL's records; phone and account number
    sent to UPPCL 1912 when filing or looking up complaints. Purpose: app functionality.
  - Financial info: purchase/payment history (shown from UPPCL); payments happen on UPPCL's BillDesk page.
    Purpose: app functionality.
  - App info: none. Device IDs: none. Location: none. Analytics: none.
- Shared with third parties: the data goes only to UPPCL, the service the user is using; declare as
  "not shared" (transfers to the service provider the user directs it to are not sharing).
- Encrypted in transit: yes (HTTPS). Users can request deletion: yes, sign out deletes all app data on the
  device; no account is created by the app.
- Credentials: the UPPCL password is sent only to UPPCL; stored (encrypted, on the device) only if alerts
  are turned on.

**Government apps declaration**: not a government app. The listing says it is unofficial and not affiliated
with UPPCL, and links to https://www.uppcl.org.

**Financial features**: none (no loans, no wallet); bill payment is handled by UPPCL's own gateway.

## Every release
1. Bump `expo.version` and `android.versionCode` in `app.json`, add `fastlane/metadata/android/*/changelogs/<versionCode>.txt`.
2. Push tag `vX.Y.Z` (the release workflow builds the APK for GitHub and the AAB for Play).
3. Download the AAB artifact and upload it to the Play track (internal → closed → production).

## Store assets still to make
- 512×512 icon (from `assets/` app icon) and a 1024×500 feature graphic.
- Phone screenshots: take them in demo mode (light, dark, Hindi), 2–8 per language.
