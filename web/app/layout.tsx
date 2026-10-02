import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { IS_TESTNET } from "@/lib/chains";
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
  title: { default: "BegFi", template: "%s · BegFi" },
  description: "Your link. Their $BEG. Straight to your wallet. A non-custodial payment link on Robinhood Chain.",
  applicationName: "BegFi",
  openGraph: { type: "website", siteName: "BegFi" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#07080A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="antialiased">
        {/*
          On testnet the site says so, on every page, as the first thing in the
          document. This is a safety control, not decoration: on the testnet
          every flow works and every token is worthless, so an unlabelled test
          build looks exactly like a working product. Someone who sent coins
          they believed were real, or believed they had received real coins,
          needs the page to have told them plainly.
        */}
        {IS_TESTNET ? (
          <div className="safe-top bg-beg-lime text-center text-[13px] font-bold text-beg-bg">
            <div className="px-4 py-2">
              Testnet — the tokens here are not real and have no value.
            </div>
          </div>
        ) : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
