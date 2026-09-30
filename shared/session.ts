/**
 * Client-side session management.
 *
 * JWT and site info live ONLY on the user's device — never on the server.
 * Web: sessionStorage, gone when the tab closes. Mobile: the OS keystore
 * (see platform.ts). Users can also clear it via logout().
 */
import { platform } from "./platform";

const STORAGE_KEY = "uppcl_session";
const EXPIRED_KEY = "uppcl_session_expired";

export interface Session {
  jwt: string;
  jwtExpiresMs: number;
  tenant: string;
  site?: SiteRecord;
}

export interface SiteRecord {
  _id: string;
  connectionId: string;
  deviceId: string;
  tenantId: string;
  tenantCode: string;
  discom: string;
  userId: string;
  name: string;
  customerName: string;
  address: string;
  pincode: string;
  sanctionedLoad: string;
  connectionType: string;
  meterInstallationNumber: string;
  meterPhase: string;
  meterType: string;
  [k: string]: unknown;
}

export function getSession(): Session | null {
  const store = platform.storage;
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s.jwtExpiresMs <= Date.now()) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  platform.storage?.setItem(STORAGE_KEY, JSON.stringify(s));
  platform.storage?.removeItem(EXPIRED_KEY);
}

export function clearSession(): void {
  platform.storage?.removeItem(STORAGE_KEY);
}


/** Clear the session because UPPCL rejected it, so the login gate can say why. */
export function expireSession(): void {
  clearSession();
  platform.storage?.setItem(EXPIRED_KEY, "1");
}

/** True after expireSession() until the next successful sign-in. */
export function sessionWasExpired(): boolean {
  return platform.storage?.getItem(EXPIRED_KEY) === "1";
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getJwt(): string | null {
  return getSession()?.jwt ?? null;
}

export function getSite(): SiteRecord | null {
  return getSession()?.site ?? null;
}

export function setSite(site: SiteRecord): void {
  const s = getSession();
  if (!s) return;
  s.site = site;
  saveSession(s);
}

export function jwtExpiresInDays(): number | null {
  const s = getSession();
  if (!s) return null;
  return (s.jwtExpiresMs - Date.now()) / 86_400_000;
}
