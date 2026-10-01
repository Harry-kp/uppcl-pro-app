/** Target of the app-icon shortcuts (see useAppShortcuts in app/_layout.tsx): do the job, then land on its tab. */
import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { downloadBillPdf, getLatestInvoice, useDashboard, type MonthlyInvoice } from "@shared/api";
import { useI18n } from "../../src/i18n";
import { Centered, Txt } from "../../src/ui";

export default function QuickAction() {
  const { action } = useLocalSearchParams<{ action: string }>();
  const { t } = useI18n();
  const { data } = useDashboard(); // usually instant from the saved cache
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (action === "pay" && data) {
      done.current = true;
      router.replace("/pay");
    } else if (action === "sms") {
      // Straight to the two-tap no-power sheet (it falls back to SMS itself when 1912 can't take it).
      done.current = true;
      router.replace({ pathname: "/complaints", params: { report: "1" } });
    } else if (action === "bill") {
      done.current = true;
      router.replace("/bills");
      void getLatestInvoice()
        .then((r) => {
          const inv = r.data as MonthlyInvoice | undefined;
          if (inv?.invoice_id) return downloadBillPdf(inv); // opens the in-app viewer
        })
        .catch(() => {}); // Bills tab is already showing, with its own PDF links
    }
  }, [action, data]);

  return <Centered><Txt v="body" color="muted">{t("loading")}</Txt></Centered>;
}
