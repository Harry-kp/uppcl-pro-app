/** iOS widget extension (WidgetKit). Data comes from the app through the App Group in app.json (src/widget.tsx writes it). */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "BijliWidget",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit"],
  entitlements: { "com.apple.security.application-groups": ["group.com.harrykp.uppclpro"] },
  // Same card as the Android widget (src/widget.tsx LIGHT/DARK).
  colors: { $widgetBackground: { light: "#F3F3F8", dark: "#181A2E" }, $accent: { light: "#3B47A8", dark: "#FFE3B0" } },
};
