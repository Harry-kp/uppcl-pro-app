/**
 * Web links. Some phones have no enabled browser (seen on a Redmi with Mi Browser disabled): then
 * Linking.openURL rejects and the tap looks dead. Fall back to the in-app page (app/web.tsx).
 */
import { Linking } from "react-native";
import { router } from "expo-router";

export function openLink(url: string): void {
  Linking.openURL(url).catch(() => router.push({ pathname: "/web", params: { url } }));
}
