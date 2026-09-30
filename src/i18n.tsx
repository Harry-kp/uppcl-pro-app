/**
 * English + Hindi. Strings live in the repo-wide messages/*.json under "app"
 * (shared with the web's next-intl files — add every key to both).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { keystore } from "./boot";

export type Lang = "en" | "hi";
type Key = keyof typeof en.app;

const LANG_KEY = "app_lang";
const STRINGS: Record<Lang, Record<Key, string>> = { en: en.app, hi: hi.app };

interface I18n {
  lang: Lang;
  setLang(l: Lang): void;
  t(key: Key, vars?: Record<string, string | number>): string;
  /** BCP-47 locale for dates and numbers. */
  locale: "en-IN" | "hi-IN";
  /** "2 days ago" / "2 दिन पहले". Daily readings are stamped midnight, so never show a clock time. */
  ago(d: string | Date): string;
  /** A duration: "45 min", "3 h 22 min", "2 days". */
  span(ms: number): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (keystore.getItem(LANG_KEY) === "hi" ? "hi" : "en"));
  const setLang = useCallback((l: Lang) => {
    keystore.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);
  const value = useMemo<I18n>(() => ({
    lang,
    setLang,
    locale: lang === "hi" ? "hi-IN" : "en-IN",
    // Anek Devanagari renders the space after "·" almost zero-width; a no-break space keeps it
    // visible and stops a line starting with "·" (UX-037).
    t: (key, vars) => (lang === "hi" ? fill(STRINGS.hi[key], vars).replace(/ · /g, "\u00A0·\u00A0") : fill(STRINGS.en[key], vars)),
    ago: (d) => relative(STRINGS[lang], d),
    span: (ms) => duration(STRINGS[lang], ms),
  }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function fill(template: string, vars?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
}

function relative(s: Record<Key, string>, d: string | Date): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return s.ago_now;
  if (mins < 60) return fill(s.ago_min, { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return fill(s.ago_hr, { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? s.ago_yesterday : fill(s.ago_day, { n: days });
}

function duration(s: Record<Key, string>, ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return fill(s.span_min, { m: mins });
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? fill(s.span_hm, { h, m }) : fill(s.span_h, { h });
  const d = Math.round(h / 24);
  return d === 1 ? s.span_d1 : fill(s.span_d, { d });
}

/** English defaults if something renders outside the provider (e.g. mid hot-reload) — never crash on copy. */
const FALLBACK: I18n = {
  lang: "en", setLang: () => {}, locale: "en-IN",
  t: (key, vars) => fill(STRINGS.en[key], vars),
  ago: (d) => relative(STRINGS.en, d),
  span: (ms) => duration(STRINGS.en, ms),
};

export function useI18n(): I18n {
  return useContext(Ctx) ?? FALLBACK;
}
