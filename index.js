// Entry: Expo Router, plus the home-screen widget's headless task handler (src/widget.tsx).
import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widget";

registerWidgetTaskHandler(widgetTaskHandler);
