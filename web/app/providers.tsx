"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { RainbowKitProvider, lightTheme, connectorsForWallets, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { Chain } from "viem";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { AuthProvider } from "@/lib/auth-context";

//
// The wallet modules come from `@rainbow-me/rainbowkit/wallets`, the package's
// one public export surface — its `exports` map blocks every deeper path, so
// the "import by deep path" plan this file used to describe is not possible
// on 2.2.11. What made the barrel safe here is the dependency tree, not the
// import style: the Coinbase SDK that once broke the build through the barrel
// is an OPTIONAL peer of wagmi's connectors and is simply not installed.
// The two peers the wallets below DO need (@walletconnect/ethereum-provider
// for the QR flow, @metamask/connect-evm for MetaMask) are installed, so the
// barrel resolves completely. Adding the Coinbase connector later means
// installing @coinbase/wallet-sdk first and re-testing the build.
import {
  metaMaskWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";

/**
 * Wallet connection, with RainbowKit on top of wagmi.
 *
 * ONE CHAIN. Robinhood Chain is the only network BegFi supports. A link that
 * could resolve on two networks is a way to send money to the wrong place, so
 * the switch prompt offers exactly one destination.
 *
 * THE WALLET LIST. MetaMask, Rainbow and Trust by name, plus the generic
 * WalletConnect QR so any of the hundreds of mobile wallets can scan in.
 * Every one of these needs a WalletConnect project id; without one set, the
 * config falls back to the plain injected connector (browser-extension
 * wallets still work, mobile does not), so a missing key degrades rather
 * than breaks.
 *
 * Coinbase's connector is deliberately absent. It is what pulls the
 * unresolvable SDK in through the barrel; it can be added later by deep
 * import, once its dependency tree installs cleanly.
 */
const chains = SUPPORTED_CHAINS as unknown as readonly [Chain, ...Chain[]];

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "";

/**
 * The connector set, built at module load. With a project id this is the
 * branded list; without one it is the bare injected connector, so a missing
 * key degrades to extension-wallets-only rather than breaking the site.
 */
const walletConnectors = WALLETCONNECT_PROJECT_ID
  ? connectorsForWallets(
      [
        {
          groupName: "Popular",
          // The factories go in UNCALLED, exactly as getDefaultWallets does:
          // connectorsForWallets applies the project id and its own details
          // when it invokes them. Calling them here produced Wallet objects
          // where the list wants factories.
          wallets: [metaMaskWallet, rainbowWallet, trustWallet, walletConnectWallet],
        },
      ],
      {
        appName: "BegFi",
        projectId: WALLETCONNECT_PROJECT_ID,
      },
    )
  : [injected()];

const config = createConfig({
  chains,
  connectors: walletConnectors,
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])),
  ssr: true,
});

/** RainbowKit's accent, matched to the design system rather than left at the
 *  library default, so the modal reads as part of the site instead of a widget
 *  bolted onto it. The light base matches the cream sticker sheet; the accent
 *  is the same Robinhood green as every button fill on the site. */
const WALLET_THEME: Theme = lightTheme({
  accentColor: "#00CC6D",
  accentColorForeground: "#FFFFFF",
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
