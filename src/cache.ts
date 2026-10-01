/**
 * Instant open: SWR's cache survives app restarts, so the last data shows immediately while
 * UPPCL (often ~10 s) answers in the background. Stored in the app's private document folder;
 * deleted on sign-out. "/health" (signed-in state) is never persisted — the keystore decides that.
 */
import { AppState } from "react-native";
import { File, Paths } from "expo-file-system";
import type { Cache, State } from "swr";
import { unloadAll } from "@shared/api";

const file = new File(Paths.document, "swr-cache-v1.json");
const SKIP = (key: string) => key === "/health" || key.startsWith("$");

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let current: Map<string, State> | null = null;
let dirty = false;

function save() {
  if (!current || !dirty) return;
  dirty = false;
  try {
    const entries = [...current.entries()]
      .filter(([k, v]) => !SKIP(k) && v?.data !== undefined)
      .map(([k, v]) => [k, { data: v.data }]);
    file.write(JSON.stringify(entries));
  } catch {
    // Cache is a convenience; never break the app over it.
  }
}

export function persistentCache(): Cache {
  let entries: [string, State][] = [];
  try {
    if (file.exists) entries = JSON.parse(file.textSync());
  } catch {
    entries = [];
  }
  const map = new Map<string, State>(entries);
  current = map;
  const set = map.set.bind(map);
  map.set = (k, v) => {
    const changed = map.get(k)?.data !== v?.data; // SWR also sets keys for isValidating/error flips
    const r = set(k, v);
    if (changed && !SKIP(k)) {
      dirty = true;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 2000); // debounce: a refresh updates many keys at once
    }
    return r;
  };
  AppState.addEventListener("change", (s) => { if (s !== "active") save(); });
  return map as unknown as Cache;
}

/** Sign-out: drop every response (and tell mounted screens), plus the copy kept for instant open. */
export function clearPersistentCache() {
  unloadAll({ revalidate: false });
  try { if (file.exists) file.delete(); } catch { /* already gone */ }
}
