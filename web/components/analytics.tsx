"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { ANALYTICS_CONFIGURED, GA_MEASUREMENT_ID, pageview } from "@/lib/analytics";

/**
 * The analytics loader: mounted once in the root layout, renders nothing a user
 * can see, and loads nothing at all when no measurement ID is configured.
 *
 * WHY `strategy="afterInteractive"`. Measurement is the least important byte on
 * the page. It loads after the app is interactive, so a slow or blocked Google
 * request cannot delay a first paint — which on a phone on a bad connection is
 * the difference between seeing your link and bouncing.
 *
 * WHY THE PAGE VIEW IS SENT BY HAND. GA4's automatic page view fires once per
 * document load. This app navigates client-side, so the automatic one would
 * report a single page per session; the effect below sends the real path on
 * every change. `send_page_view: false` in the config stops the two from
 * double-counting the first one.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (ANALYTICS_CONFIGURED) pageview(pathname);
  }, [pathname]);

  if (!ANALYTICS_CONFIGURED) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}
