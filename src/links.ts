/**
 * Web links. Some phones have no enabled browser (seen on a Redmi with Mi Browser disabled): then
 * Linking.openURL rejects and the tap looks dead. Fall back to the in-app page (app/web.tsx).
 */
import { Linking } from "react-native";
import { router } from "expo-router";

// app/web.tsx is reachable by deep link, so it only opens the sites the app itself links to (no
// phishing page dressed up as the app, no javascript: URLs).
const IN_APP_HOSTS = ["github.com", "uppcl.sem.jio.com", "consumer.uppcl.org", "wa.me", "www.google.com"];

export function isInAppUrl(url: string | undefined): url is string {
  try { const u = new URL(url ?? ""); return u.protocol === "https:" && IN_APP_HOSTS.includes(u.host); } catch { return false; }
}

export function openLink(url: string): void {
  Linking.openURL(url).catch(() => { if (isInAppUrl(url)) router.push({ pathname: "/web", params: { url } }); });
}

/**
 * A link BillDesk's page wants another app to open → the URL Android/iOS can open.
 * "upi://pay?pa=…" (and tez://, phonepe://, paytmmp://…) as is; Chrome-style
 * "intent://pay?pa=…#Intent;scheme=upi;package=com.phonepe.app;end" → "upi://pay?pa=…" (the phone then offers
 * its UPI apps). Anything else: null.
 */
export function appLinkFor(url: string): string | null {
  const m = /^intent:\/\/([^#]*)#Intent;(.*)end;?$/i.exec(url);
  if (m) {
    const scheme = /(?:^|;)scheme=([^;]+)/i.exec(m[2])?.[1];
    return scheme ? `${scheme}://${m[1]}` : null;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : null;
}
