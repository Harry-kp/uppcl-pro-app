/**
 * Opt-in alerts. Off by default. When the user turns them on we keep their UPPCL username +
 * password in the OS keystore (so the check can sign in again after the JWT expires), let Android
 * wake us about twice a day, work everything out on the phone, and post local notifications.
 * No server involved.
 *
 *  prepaid : balance lasts ≤ ALERT_DAYS
 *  postpaid: a new bill is ready · an unpaid bill is due within DUE_DAYS
 *  both    : UPPCL announced a planned power cut · the month is heading over the user's budget
 * Each fires at most once (per day, per bill, or per notice).
 */
import "./boot";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { getDashboard, getDowntime, getLatestInvoice, login, type MonthlyInvoice } from "@shared/api";
import { derivePostpaid, derivePrepaid } from "@shared/insights";
import { isAuthenticated } from "@shared/session";
import { billingPeriod, daysBetween, rupees } from "@shared/utils";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { keystore } from "./boot";
import { saveSnapshot } from "./widget";

const TASK = "meter-pro-alerts";
const CREDS_KEY = "app_alert_creds";
const SEEN = { low: "app_alert_low_day", bill: "app_alert_bill_id", due: "app_alert_due_day", cut: "app_alert_cut", budget: "app_alert_budget_month" } as const;
const BUDGET_KEY = "app_budget";

/** The user's monthly bill budget in ₹, or null when off. Kept on the phone only. */
export function getBudget(): number | null {
  const n = Number(keystore.getItem(BUDGET_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function setBudget(n: number | null): void {
  if (n && n > 0) keystore.setItem(BUDGET_KEY, String(Math.round(n)));
  else keystore.removeItem(BUDGET_KEY);
  keystore.removeItem(SEEN.budget); // a new amount may warn again this month
}
const CHANNEL = "alerts";
/** Prepaid: warn when the balance lasts this many days or fewer. */
export const ALERT_DAYS = 3;
/** Postpaid: remind this many days before an unpaid bill is due. */
export const DUE_DAYS = 3;

export function alertsEnabled(): boolean {
  return keystore.getItem(CREDS_KEY) !== null;
}

async function ensureChannel() {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Meter Pro alerts", importance: Notifications.AndroidImportance.DEFAULT, lightColor: "#3B47A8",
  });
}

/**
 * Check the password (throws UPPCL's error if wrong), ask for notification permission,
 * then store credentials and register the background task. Returns false if notifications are blocked.
 */
export async function enableAlerts(username: string, password: string): Promise<boolean> {
  await login(username, password);
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return false;
  await ensureChannel();
  keystore.setItem(CREDS_KEY, JSON.stringify({ username, password }));
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 12 * 60 }); // minutes
  void checkAlerts(); // first check now, so the first alert doesn't wait half a day
  return true;
}

export async function disableAlerts(): Promise<void> {
  keystore.removeItem(CREDS_KEY);
  Object.values(SEEN).forEach((k) => keystore.removeItem(k));
  if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}

/** "Send a test notification" in Settings: lets the user confirm alerts reach them. */
export async function sendTestNotification(): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return false;
  await ensureChannel();
  const s = strings();
  await notify(s.test_title, s.test_body);
  return true;
}

function strings() {
  const lang = keystore.getItem("app_lang") === "hi" ? "hi" : "en";
  return { ...(lang === "hi" ? hi : en).app, lang: lang as "en" | "hi", locale: lang === "hi" ? "hi-IN" : "en-IN" };
}
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

function notify(title: string, body: string, href?: string) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: href ? { href } : {} },
    trigger: { channelId: CHANNEL },
  });
}

export async function checkAlerts(now: number = Date.now()): Promise<void> {
  const raw = keystore.getItem(CREDS_KEY);
  if (!raw) return;
  if (!isAuthenticated()) {
    const { username, password } = JSON.parse(raw) as { username: string; password: string };
    await login(username, password);
  }
  const s = strings();
  const today = new Date(now).toDateString();
  const day = (d: Date | string) => new Date(d).toLocaleDateString(s.locale, { weekday: "short", day: "numeric", month: "short" });
  const data = await getDashboard();
  let estimate = 0; // this month's projected bill (postpaid) or 30-day spend estimate (prepaid)

  if (data.site.connectionType === "postpaid") {
    const resp = await getLatestInvoice().catch(() => null);
    const inv = (resp?.data as MonthlyInvoice | undefined)?.invoice_id ? (resp!.data as MonthlyInvoice) : null;
    estimate = derivePostpaid(data, { inv: inv ?? undefined }, now).projectedBill;
    if (inv) {
      const month = billingPeriod(inv.bill_dt).from.toLocaleDateString(s.locale, { month: "long" });
      const amount = rupees(Math.abs(Number(inv.bill_amt)), { decimals: 0 });
      // New bill: only when the id changes after we've seen one (never alert on the first check).
      const seenBill = keystore.getItem(SEEN.bill);
      if (seenBill && seenBill !== inv.invoice_id) {
        await notify(fill(s.bill_ready_title, { month }), fill(s.bill_ready_body, { amount, date: day(inv.due_dt) }), "/bills");
      }
      keystore.setItem(SEEN.bill, inv.invoice_id);
      // Due soon and still unpaid: once a day.
      const paid = Boolean((inv.payment_dt || "").trim());
      const daysLeft = daysBetween(new Date(now), inv.due_dt);
      if (!paid && daysLeft >= 0 && daysLeft <= DUE_DAYS && keystore.getItem(SEEN.due) !== today) {
        await notify(fill(s.due_soon_title, { n: daysLeft }), fill(s.due_soon_body, { amount, month, date: day(inv.due_dt) }), "/");
        keystore.setItem(SEEN.due, today);
      }
    }
  } else {
    const days = data.runway.days;
    estimate = derivePrepaid(data, undefined, undefined, undefined, now).next;
    if (days !== null && days <= ALERT_DAYS && keystore.getItem(SEEN.low) !== today) {
      const { recommendedAmount } = derivePrepaid(data, undefined, undefined, undefined, now);
      const coverUntil = new Date(now + ((data.balance.inr + recommendedAmount) / data.runway.avg_daily_spend) * 86400_000);
      await notify(
        fill(s.notif_title, { n: Math.max(0, Math.floor(days)) }),
        fill(s.notif_body, { balance: rupees(data.balance.inr, { decimals: 0 }), amount: rupees(recommendedAmount, { decimals: 0 }), date: day(coverUntil) }),
        "/",
      );
      keystore.setItem(SEEN.low, today);
    }
    // Keep the widget fresh while the app is closed.
    if (days !== null) {
      saveSnapshot({
        label: s.balance_lasts, big: String(Math.floor(days)), unit: Math.floor(days) === 1 ? s.day : s.days,
        line: fill(s.balance_only, { balance: rupees(data.balance.inr, { decimals: 0 }) }),
        tone: Math.floor(days) <= 2 ? "critical" : Math.floor(days) <= ALERT_DAYS ? "warn" : "ok", updated: new Date(now).toISOString(), lang: s.lang,
      });
    }
  }

  // Budget: once a month, when the estimate first goes over the user's amount.
  const budget = getBudget();
  const ym = new Date(now).toISOString().slice(0, 7);
  if (budget && estimate > budget && keystore.getItem(SEEN.budget) !== ym) {
    await notify(fill(s.budget_notif_title, { amount: rupees(budget, { decimals: 0 }) }), fill(s.budget_notif_body, { proj: rupees(estimate, { decimals: 0 }) }), "/usage");
    keystore.setItem(SEEN.budget, ym);
  }

  // Planned power cut: once per distinct notice.
  const cut = await getDowntime().catch(() => null);
  const notice = String(cut?.data?.body || cut?.data?.title || "").trim();
  if (notice && keystore.getItem(SEEN.cut) !== notice) {
    await notify(s.cut_title, notice, "/");
    keystore.setItem(SEEN.cut, notice);
  }
}

// Must be defined at module scope so Android can run it with the app closed.
TaskManager.defineTask(TASK, async () => {
  try {
    await checkAlerts();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});
