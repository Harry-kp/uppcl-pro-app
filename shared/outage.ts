/** Public UPPCL complaint channels (printed on every bill — not secrets). */
export const HELPLINE_TEL = "1912";            // 24×7 toll-free
export const TOLL_FREE = "1800-180-0440";      // alternative toll-free
export const COMPLAINT_SMS_NUMBER = "5616195"; // SMS shortcode

/** UPPCL's SMS complaint format for a supply outage. */
export function noPowerSms(site: { connectionId: string; tenantId?: string }): string {
  return `NO POWER ${site.connectionId} ${site.tenantId?.toUpperCase() ?? ""}`.trim();
}

/** A ready-to-send complaint SMS link. iOS wants `sms:<n>&body=`; Android (and the web) `sms:<n>?body=`. */
export function noPowerSmsUrl(site: { connectionId: string; tenantId?: string }, ios = false): string {
  return `sms:${COMPLAINT_SMS_NUMBER}${ios ? "&" : "?"}body=${encodeURIComponent(noPowerSms(site))}`;
}
