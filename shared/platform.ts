/**
 * The native seams shared/ calls (requests, session storage, PDF saving). src/boot.ts fills them in
 * at startup via configurePlatform(); until then every call fails loudly instead of guessing.
 */

/** Upstream an API call is for. */
export type Upstream = "uppcl" | "bootstrap" | "wss" | "complaints";

/** Synchronous key/value store with the sessionStorage shape. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface Platform {
  /** `path` is relative to the upstream's base; it may be a bare "?query". */
  request(upstream: Upstream, path: string, init?: RequestInit): Promise<Response>;
  /** Where the session (JWT + site) lives. null until configured. */
  storage: KeyValueStore | null;
  /** Hand a base64 PDF to the user (share sheet). */
  savePdf(base64: string, filename: string): void | Promise<void>;
  mock?(key: string): unknown; // sample data (src/demo.ts: demo mode + dev scenarios) answers a key without the network
}

const unconfigured = (): never => { throw new Error("platform not configured: src/boot.ts must run first"); };

export const platform: Platform = { request: unconfigured, storage: null, savePdf: unconfigured };

export function configurePlatform(p: Partial<Platform>): void {
  Object.assign(platform, p);
}
