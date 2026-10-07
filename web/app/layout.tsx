import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteDock, SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { SITE_URL } from "@/lib/config";

/**
 * One family, self-hosted (spec §3). Loaded through `next/font` rather than a
 * <link> so it is served from our own origin, cannot block first paint, and
 * cannot leak a request to Google on every page view.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "BegFi", template: "%s | BegFi" },
  description:
    "Your link. Their $BEG. Straight to your wallet. Noncustodial payment links and token launches on Robinhood Chain.",
  applicationName: "BegFi",
  openGraph: { type: "website", siteName: "BegFi" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#fff3d6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The chrome lives here, once.
 *
 * Every page previously rendered its own `SiteNav`, which is why they drifted —
 * some had navigation, some had none, and the home page had none at all. A single
 * header and footer in the layout means a new page is reachable the moment it
 * exists, and cannot be added without navigation by accident.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="flex min-h-dvh flex-col antialiased">
        <Providers>
          <SiteNav />
          <div className="flex-1">{children}</div>
          <SiteFooter />
          {/*
            Dock clearance: the dock is fixed, so something in flow has to
            reserve its strip — after the footer, which is the page's true
            bottom, or its last links scroll out from under the bar (phone)
            or the pill (desktop).
          */}
          <div aria-hidden className="h-20 md:h-24" />
          <SiteDock />
        </Providers>
      </body>
    </html>
  );
}
