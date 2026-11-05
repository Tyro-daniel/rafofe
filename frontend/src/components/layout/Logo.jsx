import React from "react";

/**
 * Single source of truth for the app's logo, used in every navigation
 * chrome location (desktop sidebar, mobile topbar, login/register pages).
 *
 * TO REPLACE THE LOGO WITH YOUR REAL COMPANY LOGO:
 *   1. Drop your logo file into frontend/public/, e.g. as "logo.svg" or
 *      "logo.png" — files in `public/` are served as-is from the site
 *      root in both dev (Vite) and production (Nginx), no import needed.
 *   2. If you used a different filename or extension than "logo.svg",
 *      update the `src="/logo.svg"` line below to match.
 *   3. That's it — every page using <Logo /> updates automatically.
 *      Nothing else in the codebase needs to change.
 *
 * Do NOT hardcode the logo (emoji, inline SVG, or an <img> tag) directly
 * in AppShell.jsx, Login.jsx, Register.jsx, etc. — always import and use
 * this component, so a future logo change stays a one-file edit.
 */
export function Logo({ size = 48, showWordmark = true, wordmarkText = "LOAN MANAGEMENT SYSTEM" }) {
  return (
    <span className="app-logo" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      <img src="/logo.svg" alt={showWordmark ? "" : wordmarkText} width={size} height={size} style={{ display: "block" }} />
      {showWordmark && <span className="app-logo-wordmark">{wordmarkText}</span>}
    </span>
  );
}
