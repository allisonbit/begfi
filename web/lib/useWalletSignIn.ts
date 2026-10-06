"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useConnect, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { injected } from "wagmi/connectors";

/**
 * Wallet sign-in as its own path.
 *
 * Connects the browser wallet if needed, asks the server for a challenge, has
 * the wallet sign it, and lets the server mint the session. On success we do a
 * full navigation so the freshly-set auth cookies are visible to both the client
 * and the server-rendered pages.
 *
 * This is deliberately separate from the wagmi connection used for sending:
 * signing in proves who you are, connecting a wallet lets you pay. The two are
 * different things and the UI says so.
 *
 * THE CONNECT STEP HAS TWO DOORS. The injected connector is tried first: on a
 * desktop with an extension it connects silently and the flow continues without
 * a modal. When there is no injected provider — every mobile browser, and any
 * desktop without one — the RainbowKit modal opens instead, which offers the
 * branded mobile wallets and the WalletConnect QR. This is what made sign-in
 * look broken on phones: the old code only ever tried injected, so mobile died
 * with "No browser wallet detected" and the modal never appeared. Once a modal
 * connect lands, an effect resumes the flow automatically; if the visitor
 * closes the modal without connecting, the pending flag clears and nothing
 * happens until they press Sign in again.
 */
/** What a signIn() attempt reports. `pending` means the modal is open and the
 *  flow will resume on its own once a wallet connects — it is not an error and
 *  it is not success, so callers must neither show an error nor reload. */
export type SignInResult = { error: string | null; pending: boolean };

export function useWalletSignIn() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync, isPending: connecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingModalConnect, setAwaitingModalConnect] = useState(false);
  const signInRef = useRef<((opts?: { next?: string }) => Promise<SignInResult>) | null>(null);

  const signIn = useCallback(
    async (opts?: { next?: string }): Promise<SignInResult> => {
      setError(null);
      setBusy(true);

      try {
        let addr = address ?? null;
        if (!isConnected || !addr) {
          try {
            const res = await connectAsync({ connector: injected() });
            addr = res.accounts[0] ?? null;
          } catch (injectedError) {
            const msg = injectedError instanceof Error ? injectedError.message : String(injectedError);

            // A deliberate reject inside the wallet popup is not a reason to
            // open the modal — say so and stop.
            if (/reject|denied|cancel/i.test(msg)) {
              const friendly = "Connection request was rejected.";
              setError(friendly);
              return { error: friendly, pending: false };
            }

            // No injected provider: the modal is the way in. The flow resumes
            // from the effect below once the connect lands. `pending` tells the
            // caller this is neither success (no reload) nor failure (no error
            // copy) — the modal is simply open and working.
            if (openConnectModal) {
              setAwaitingModalConnect(true);
              setBusy(false);
              openConnectModal();
              return { error: null, pending: true };
            }

            throw injectedError;
          }
        }
        if (!addr) return { error: "No wallet address available.", pending: false };

        const nonceRes = await fetch("/api/auth/wallet/nonce", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: addr, chainId }),
        });
        const challenge = (await nonceRes.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;

        if (!nonceRes.ok || !challenge?.message) {
          const message = challenge?.error ?? "Could not start sign-in.";
          setError(message);
          return { error: message, pending: false };
        }

        const signature = await signMessageAsync({ message: challenge.message });

        const verifyRes = await fetch("/api/auth/wallet/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: challenge.message, signature }),
        });
        const verified = (await verifyRes.json().catch(() => null)) as
          | { ok?: boolean; hasProfile?: boolean; error?: string }
          | null;

        if (!verifyRes.ok || !verified?.ok) {
          const message = verified?.error ?? "The wallet sign-in did not finish.";
          setError(message);
          return { error: message, pending: false };
        }

        // An account with no username has no link yet, so it goes to the claim
        // step rather than to a dashboard that would be empty.
        const fallback = verified.hasProfile ? "/dashboard" : "/#claim";
        window.location.assign(opts?.next ?? fallback);
        return { error: null, pending: false };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const friendly = /reject|denied|cancel/i.test(msg)
          ? "Signature request was rejected."
          : /no ethereum|not found|provider/i.test(msg)
            ? "No browser wallet detected. Install a wallet extension to sign in this way."
            : msg || "The wallet sign-in did not finish.";

        setError(friendly);
        return { error: friendly, pending: false };
      } finally {
        setBusy(false);
      }
    },
    [address, isConnected, chainId, connectAsync, signMessageAsync, openConnectModal],
  );

  // Resume a sign-in that paused for the modal. The ref dance avoids re-running
  // on every render of the (recreated) callback.
  signInRef.current = signIn;
  useEffect(() => {
    if (!awaitingModalConnect) return;
    if (isConnected && address) {
      setAwaitingModalConnect(false);
      void signInRef.current?.();
    }
  }, [awaitingModalConnect, isConnected, address]);

  // The visitor closed the modal without connecting: stop waiting. A later
  // connect (from the nav's own connect button, say) will not fire a surprise
  // sign-in — they press Sign in again instead.
  useEffect(() => {
    if (awaitingModalConnect && !connectModalOpen && !isConnected) {
      setAwaitingModalConnect(false);
    }
  }, [awaitingModalConnect, connectModalOpen, isConnected]);

  return { signIn, busy: busy || connecting, error };
}
