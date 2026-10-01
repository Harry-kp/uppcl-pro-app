import { PixelRatio, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../src/i18n";
import { font, useColors } from "../../src/theme";
import { Icon, type IconName } from "../../src/icons";

const TABS: { name: string; label: "tab_home" | "tab_usage" | "tab_bills" | "tab_complaints"; icon: IconName; iconOn: IconName }[] = [
  { name: "index", label: "tab_home", icon: "home", iconOn: "homeFill" },
  { name: "usage", label: "tab_usage", icon: "barChart", iconOn: "barChartFill" },
  { name: "bills", label: "tab_bills", icon: "receiptLong", iconOn: "receiptLongFill" },
  { name: "complaints", label: "tab_complaints", icon: "supportAgent", iconOn: "supportAgentFill" },
];

export default function TabsLayout() {
  const c = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  // Material 3 "label on the selected tab only": a calm bar that still says where you are. The other labels
  // keep their space (transparent) so icons don't jump between tabs; TalkBack reads every tab's title.
  // Grows with the user's font size and clears the gesture bar (BUG-023).
  const scale = Math.min(PixelRatio.getFontScale(), 1.6);
  const barHeight = Math.round(72 + 16 * (scale - 1)) + insets.bottom;

  return (
    <Tabs
      backBehavior="firstRoute" // Android back from any tab returns to Home; only Home exits (BUG-034)
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: barHeight, paddingTop: 8, paddingBottom: insets.bottom + 6 },
        tabBarItemStyle: { minHeight: 56 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarLabel: ({ focused }) => (
              <Text numberOfLines={1} style={{ fontFamily: lang === "hi" ? font.hiSemibold : font.semibold, fontSize: 12, marginTop: 4, color: c.text, opacity: focused ? 1 : 0 }}>
                {t(tab.label)}
              </Text>
            ),
            tabBarIcon: ({ focused }) => (
              <View style={{ width: 64, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: focused ? c.pill : "transparent" }}>
                <Icon name={focused ? tab.iconOn : tab.icon} size={24} color={focused ? c.pillText : c.muted} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
