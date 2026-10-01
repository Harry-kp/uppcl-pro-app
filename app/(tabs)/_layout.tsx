import { View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../src/i18n";
import { useColors } from "../../src/theme";
import { Icon, type IconName } from "../../src/icons";

const TABS: { name: string; label: "tab_home" | "tab_usage" | "tab_bills" | "tab_complaints"; icon: IconName; iconOn: IconName }[] = [
  { name: "index", label: "tab_home", icon: "home", iconOn: "homeFill" },
  { name: "usage", label: "tab_usage", icon: "barChart", iconOn: "barChartFill" },
  { name: "bills", label: "tab_bills", icon: "receiptLong", iconOn: "receiptLongFill" },
  { name: "complaints", label: "tab_complaints", icon: "supportAgent", iconOn: "supportAgentFill" },
];

export default function TabsLayout() {
  const c = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // Icons only (user's call): the names still reach TalkBack through each tab's title.
  // 64dp clears the gesture bar on every phone; no text, so it no longer grows with font size (BUG-023).
  const barHeight = 64 + insets.bottom;

  return (
    <Tabs
      backBehavior="firstRoute" // Android back from any tab returns to Home; only Home exits (BUG-034)
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.muted,
        tabBarShowLabel: false,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: barHeight, paddingTop: 12, paddingBottom: insets.bottom + 12 },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
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
