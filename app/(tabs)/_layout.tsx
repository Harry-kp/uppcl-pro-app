import { PixelRatio, Text } from "react-native";
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
  // Material 3 navigation bar with every tab named (icons alone are ambiguous except Home; user's pick):
  // the selected tab is a filled icon + bold name in the brand colour; the rest are muted outlines.
  // No box behind the icon (the M3 pill read as a clumsy highlight here; user feedback).
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
              <Text numberOfLines={1} style={{
                fontFamily: focused ? (lang === "hi" ? font.hiBold : font.bold) : (lang === "hi" ? font.hiRegular : font.medium),
                fontSize: 12, marginTop: 4, color: focused ? c.primary : c.muted,
              }}>
                {t(tab.label)}
              </Text>
            ),
            tabBarIcon: ({ focused }) => (
              <Icon name={focused ? tab.iconOn : tab.icon} size={26} color={focused ? c.primary : c.muted} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
