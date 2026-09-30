/**
 * The seams that let src/lib run in both the browser (this Next.js app) and
 * React Native (mobile/). Defaults are the web behaviour; the mobile app calls
 * configurePlatform() once at startup to swap in its own.
 */

/** Upstream an API call is for. Web routes all four through its own /api/* proxy. */
export type Upstream = "uppcl" | "bootstrap" | "wss" | "complaints";

/** Synchronous key/value store with the sessionStorage shape. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface Platform {
  /** `path` is relative to the upstream's base; it may be a bare "?query". */
  request(upstream: Upstream, path: string, init?: RequestInit): Promise<Response>;
  /** Where the session (JWT + site) lives. null during SSR. */
  storage: KeyValueStore | null;
  /** Hand a base64 PDF to the user (browser download, or share sheet on mobile). */
  savePdf(base64: string, filename: string): void | Promise<void>;
  mock?(key: string): unknown; // @dev-tools seam: src/dev test scenarios answer a key (fetcher key or "wss:<path>") without the network
}

function browserDownload(b64: string, filename: string): void {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const platform: Platform = {
  request: (upstream, path, init) =>
    fetch(`/api/${upstream}${path.startsWith("?") ? path : `/${path}`}`, init),
  storage: typeof window === "undefined" ? null : window.sessionStorage,
  savePdf: browserDownload,
};

export function configurePlatform(p: Partial<Platform>): void {
  Object.assign(platform, p);
}
