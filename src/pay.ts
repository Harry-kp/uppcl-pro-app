/**
 * Until one-tap recharge ships: UPPCL's payment page asks for the account number, which most
 * people don't know by heart — so copy it first and say so, then open the page.
 */
import * as Clipboard from "expo-clipboard";
import { Linking, Platform, ToastAndroid } from "react-native";
import { UPPCL_SMART_URL } from "./boot";

export async function openPay(accountNo: string, copiedMessage: string): Promise<void> {
  await Clipboard.setStringAsync(accountNo).catch(() => {});
  if (Platform.OS === "android") ToastAndroid.show(copiedMessage, ToastAndroid.LONG);
  await Linking.openURL(UPPCL_SMART_URL);
}
