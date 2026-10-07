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

/**
 * RainbowKit's theme, matched to the design system rather than left at the
 * library default, so the modal reads as part of the site instead of a widget
 * bolted onto it.
 *
 * The light base gets overridden piece by piece so the modal sits on the same
 * cream sheet as everything else: ink text on card stock, ink borders, and the
 * sticker shadow recipe — a hard ink offset with no blur, which is why the
 * overlay blur is off. The accent is Robin Neon, the official Robinhood Chain
 * brand colour, always ink text on neon per the chain's own guidelines.
 */
const WALLET_THEME: Theme = {
  ...lightTheme({
    accentColor: "#ccff00",
    accentColorForeground: "#161616",
    borderRadius: "large",
    fontStack: "system",
    overlayBlur: "none",
  }),
  colors: {
    ...lightTheme().colors,
    accentColor: "#ccff00",
    accentColorForeground: "#161616",
    modalBackdrop: "rgb(22 22 22 / 0.55)",
    modalBackground: "#fffcf2",
    modalBorder: "#161616",
    modalText: "#161616",
    modalTextDim: "#59626f",
    modalTextSecondary: "#59626f",
    generalBorder: "#161616",
    generalBorderDim: "#161616",
    menuItemBackground: "#fff3d6",
    actionButtonBorder: "#161616",
    actionButtonSecondaryBackground: "#fff3d6",
    connectButtonBackground: "#fffcf2",
    connectButtonInnerBackground: "#fff3d6",
    connectButtonText: "#161616",
    profileAction: "#1b9e3f",
    profileActionHover: "#178f37",
    profileForeground: "#fffcf2",
    closeButton: "#161616",
    closeButtonBackground: "#fff3d6",
  },
  shadows: {
    ...lightTheme().shadows,
    dialog: "7px 7px 0 0 #161616",
    selectedOption: "3px 3px 0 0 #161616",
    selectedWallet: "3px 3px 0 0 #161616",
    walletLogo: "none",
    connectButton: "4px 4px 0 0 #161616",
  },
  radii: {
    ...lightTheme().radii,
    modal: "22px",
    modalMobile: "22px",
  },
};

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
