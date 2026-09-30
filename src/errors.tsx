/**
 * One way to show a failure everywhere: whose side it is on (UPPCL's system, the connection, or this
 * app), UPPCL's own words, and copyable details — so an outage is never mistaken for our bug.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { ProxyError, type ErrorSource } from "@shared/api";
import { reportProblem } from "./github";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Txt } from "./ui";
import { Icon } from "./icons";

const SYSTEM: Record<ErrorSource, string> = {
  uppcl: "UPPCL SMART", wss: "UPPCL bill portal", complaints: "UPPCL 1912 complaint portal", app: "Meter Pro",
};

export function describeError(e: unknown) {
  const pe = e instanceof ProxyError ? e : null;
  const source: ErrorSource = pe?.source ?? "app";
  const kind = pe?.kind ?? "app"; // anything that isn't a tagged UPPCL error came from our own code
  return {
    kind, source, system: SYSTEM[source],
    status: pe?.status, reason: pe?.reason ?? (e as Error)?.message ?? String(e), at: pe?.at ?? new Date().toISOString(),
  };
}

/** Title + one line in plain words, and a "Details" fold with what support needs. */
export function ErrorNote({ error, onRetry, compact, stale }: { error: unknown; onRetry?: () => void; compact?: boolean; stale?: boolean }) {
  const c = useColors();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = describeError(error);
  const title = stale ? t("err_stale_title") : d.kind === "network" ? t("err_network_title", { system: d.system })
    : d.kind === "session" ? t("err_session_title")
    : d.kind === "upstream" ? t("err_upstream_title", { system: d.system })
    : t("err_app_title");
  const body = d.kind === "network" ? t("err_network_body", { system: d.system })
    : d.kind === "session" ? t("err_session_body")
    : d.kind === "upstream" ? t("err_upstream_body")
    : t("err_app_body");
  const tone = d.kind === "app" ? c.critical : c.warn;
  const lines = [
    `${t("err_system")}: ${d.system}`,
    d.status ? `${t("err_status")}: HTTP ${d.status}` : d.kind === "network" ? `${t("err_status")}: ${t("err_no_answer")}` : null,
    `${d.kind === "upstream" || d.kind === "session" ? t("err_uppcl_said") : t("err_app_said")}: ${d.reason}`, // no answer = UPPCL said nothing
    `${t("err_time")}: ${new Date(d.at).toLocaleString("en-IN")}`,
    `Meter Pro ${Constants.expoConfig?.version ?? ""}`,
  ].filter(Boolean) as string[];
  return (
    <View style={[styles.box, { backgroundColor: c.accentSoft }]}>
      <View style={styles.head}>
        <Icon name="warning" size={20} color={tone} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="body" weight="semibold">{title}</Txt>
          <Txt v="caption" color="muted">{body}</Txt>
        </View>
      </View>
      {!compact && onRetry && <Button label={t("retry")} kind="soft" onPress={onRetry} />}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.fold}>
        <Txt v="label" color="primary" weight="semibold">{open ? t("err_hide_details") : t("err_details")}</Txt>
      </Pressable>
      {open && (
        <View style={[styles.details, { backgroundColor: c.surface, borderColor: c.line }]}>
          {lines.map((l) => <Txt key={l} v="caption" color="muted">{l}</Txt>)}
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            <Pressable accessibilityRole="button" onPress={async () => { await Clipboard.setStringAsync(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={styles.fold}>
              <Txt v="label" color="primary" weight="semibold">{copied ? t("copied") : t("err_copy")}</Txt>
            </Pressable>
            {/* Our bug → report it; UPPCL's → still useful, so people see it's known. */}
            <Pressable accessibilityRole="button" onPress={() => reportProblem(lines.slice(0, -1))} style={styles.fold}>
              <Txt v="label" color="primary" weight="semibold">{t("report_github")}</Txt>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, padding: 12, gap: 8 },
  head: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  fold: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" },
  details: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 3 },
});
