/**
 * Dev tools: test scenarios that feed the app fake data, so screens a real account can't reach
 * (prepaid, bill due/overdue, payment results, UPPCL outages) can be seen and checked.
 *
 * Everything lives in this folder. Main code only has one-line hooks tagged `@dev-tools`
 * (boot.ts, _layout.tsx, settings.tsx, and the `platform.mock` seam in the shared lib).
 * To remove the whole feature: `scripts/remove-dev-tools.sh` (deletes this folder + tagged lines).
 * Nothing here runs in release builds: every hook is behind `__DEV__`.
 */
import { useState } from "react";
import { DevSettings, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { configurePlatform } from "@shared/platform";
import { keystore, NAME_KEY } from "../boot";
import { clearPersistentCache } from "../cache";
import { useColors } from "../theme";
import { Card, Choices, Sheet, Txt } from "../ui";
import { Icon } from "../icons";
import { mockFor, SCENARIOS, setScenario, useScenario, type ScenarioId } from "./scenarios";

/** Called once from boot.ts in dev builds: answer requests from the active scenario. */
export function install() {
  configurePlatform({ mock: (key) => mockFor(key, { outcome: "success" }) });
}

/** Orange marker on every screen while fake data is showing. */
export function DevBanner() {
  const id = useScenario();
  const insets = useSafeAreaInsets();
  if (!id) return null;
  return (
    <View pointerEvents="none" style={[styles.banner, { top: insets.top + 2 }]}>
      <Txt v="caption" weight="bold" style={{ color: "#FFFFFF" }}>{`TEST DATA · ${SCENARIOS.find((s) => s.id === id)?.label ?? id}`}</Txt>
    </View>
  );
}

/** Settings → Developer → Test scenario. Switching reloads the app so every screen reads the new source. */
export function DevSettingsSection() {
  const c = useColors();
  const scenario = useScenario();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Txt v="heading">Developer</Txt>
      <Card style={{ padding: 0, gap: 0 }}>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.row}>
          <Icon name="widgets" size={20} color={c.primary} />
          <Txt v="body" weight="semibold" style={{ flex: 1 }}>Test scenario</Txt>
          <Txt v="label" color="muted">{SCENARIOS.find((s) => s.id === scenario)?.label ?? "Real data"}</Txt>
          <Icon name="chevronRight" size={20} color={c.muted} />
        </Pressable>
      </Card>
      <Sheet visible={open} title="Test scenario" onClose={() => setOpen(false)}>
        <Txt v="caption" color="muted">Fake data for screens a real account can't reach right now. Dev builds only.</Txt>
        <Choices<string> value={scenario ?? "real"} options={[{ value: "real", label: "Real data" }, ...SCENARIOS.map((s) => ({ value: s.id, label: s.label }))]}
          onChange={(v) => {
            setScenario(v === "real" ? null : (v as ScenarioId));
            keystore.removeItem(NAME_KEY); // a test name must never be remembered as the real one
            setOpen(false);
            clearPersistentCache();
            DevSettings.reload();
          }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { position: "absolute", alignSelf: "center", backgroundColor: "#A04A14", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
});
