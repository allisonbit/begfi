"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { RainbowKitProvider, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Chain } from "viem";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { AuthProvider } from "@/lib/auth-context";

/**
 * Wallet connection, with RainbowKit on top of wagmi.
 *
 * ONE CHAIN. Robinhood Chain is the only network BegFi supports. A link that
 * could resolve on two networks is a way to send money to the wrong place, so
 * the switch prompt offers exactly one destination.
 *
 * WHY THERE IS NO BRANDED WALLET LIST HERE. RainbowKit's named connectors are
 * exported from one barrel, `@rainbow-me/rainbowkit/wallets`, and importing that
 * barrel pulls in Coinbase's connector and with it @coinbase/cdp-sdk — a package
 * whose transitive Solana peer dependency does not resolve in this tree, and
 * because the barrel is imported eagerly the whole build fails on code that
 * would never have run. Removing just the Coinbase entry is not enough: the
 * barrel imports it anyway.
 *
 * So the connector is wagmi's own injected one, which the browser supplies, and
 * RainbowKit still provides the modal, the account view, the chain switching and
 * the theming over it. Nothing about the user experience is missing except the
 * wallet logos.
 *
 * TO ADD THE BRANDED LIST: get a WalletConnect project id, set
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, and import the individual wallet modules
 * by their deep paths rather than from the barrel, so the Coinbase connector is
 * never pulled in. A project id is required for those connectors regardless, so
 * this is one change made once, not a workaround.
 */
const chains = SUPPORTED_CHAINS as unknown as readonly [Chain, ...Chain[]];

const config = createConfig({
  chains,
  connectors: [injected()],
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])),
  ssr: true,
});

/** RainbowKit's accent, matched to the design system rather than left at the
 *  library default, so the modal reads as part of the site instead of a widget
 *  bolted onto it. Lime is the button fill everywhere else here. */
const WALLET_THEME: Theme = darkTheme({
  accentColor: "#CCFF00",
  accentColorForeground: "#07080A",
  borderRadius: "large",
  overlayBlur: "small",
  fontStack: "system",
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={WALLET_THEME} modalSize="compact" appInfo={{ appName: "BegFi" }}>
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
