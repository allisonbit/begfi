"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { decodeEventLog } from "viem";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ImageUpload } from "@/components/image-upload";
import { BEG_CONFIGURED } from "@/lib/config";
import { DEFAULT_CHAIN_ID, robinhoodChain, txUrl } from "@/lib/chains";
import { useAuth } from "@/lib/auth-context";
import {
  GENESIS_CREATOR_TAX_BPS,
  LAUNCH_CONFIG_ID,
  LAUNCH_FEE_FALLBACK,
  MAX_CREATOR_TAX_BPS,
  NATIVE_PAIR,
  PONS_FACTORY,
  STANDARD_CREATOR_TAX_BPS,
  ponsFactoryAbi,
} from "@/lib/pons";

/**
 * Launch a token (spec §9.5), through Pons' factory, from BegFi's own site.
 *
 * The wallet here is the launcher's, and the fee comes out of their balance. The
 * one prerequisite BegFi cannot work around is ETH for the launch fee plus gas,
 * so that is checked and named before the button is usable.
 *
 * THE CONTRACT IS THE SOURCE OF TRUTH. The fee, the creator-tax ceiling and the
 * economics commitment are all read live from the factory rather than hardcoded,
 * because a constant here that drifted from the deployed contract would produce
 * a launch that is either rejected or silently priced differently.
 */
type Mode = "standard" | "genesis";

const EMPTY_SOCIALS = { twitter: "", telegram: "", discord: "", website: "", farcaster: "" };

export function LaunchForm() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState("");
  const [socials, setSocials] = useState(EMPTY_SOCIALS);
  const [mode, setMode] = useState<Mode>("standard");
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { userId } = useAuth();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  const wrongChain = isConnected && chainId !== DEFAULT_CHAIN_ID;

  const { data: launchFee } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "launchFee",
  });

  const { data: canLaunch } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "canLaunch",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && !wrongChain },
  });

  const { data: ceiling } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "maxCreatorTaxBps",
  });

  /**
   * The factory's on/off switch, read rather than assumed. `launchEnabled()`
   * is how Pons retires a factory version — V1 still has deployed bytecode and
   * reports false, and its launches revert. Existence proves nothing here; the
   * question has to be asked, and the answer shown.
   */
  const { data: launchEnabled } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "launchEnabled",
  });

  /**
   * The economics commitment, fetched for the exact (config, pair) being used.
   * The factory compares this against its own computation at launch, so a stale
   * or invented value makes the transaction revert — it cannot be defaulted to
   * zero and left to sort itself out.
   */
  const { data: expectedEconomics } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "previewLaunchEconomics",
    args: [LAUNCH_CONFIG_ID, NATIVE_PAIR],
  });

  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) && !wrongChain },
  });

  const fee = launchFee ?? LAUNCH_FEE_FALLBACK;
  const creatorTaxBps = mode === "genesis" ? GENESIS_CREATOR_TAX_BPS : STANDARD_CREATOR_TAX_BPS;

  /** What a trader actually pays: the factory's own curve fee plus our tax. */
  const { data: config } = useReadContract({
    abi: ponsFactoryAbi,
    address: PONS_FACTORY,
    functionName: "getLaunchConfig",
    args: [LAUNCH_CONFIG_ID],
  });

  const curveFeeBps = config?.[1];
  const totalTraderFee = useMemo(() => {
    if (curveFeeBps === undefined) return null;
    return Number(curveFeeBps + creatorTaxBps) / 100;
  }, [curveFeeBps, creatorTaxBps]);

  /** The token address, read out of the launch receipt rather than guessed. */
  const launched = useMemo(() => {
    if (!receipt) return null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: ponsFactoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "TokenLaunched") {
          return { token: decoded.args.token, curve: decoded.args.curve };
        }
      } catch {
        /* not our event */
      }
    }
    return null;
  }, [receipt]);

  const taxTooHigh = ceiling !== undefined && creatorTaxBps > ceiling;
  const symbolClean = symbol.trim().toUpperCase();
  const notEnoughGas = balance !== undefined && balance.value < fee;

  /*
   * Recording the launch into BegFi's catalog. The transaction confirming is
   * not enough for the site's own pages: /token and /explore serve only what
   * /api/launch has verified and recorded, so this call is what turns "a
   * receipt" into "a BegFi launch". Its failure is shown with a retry rather
   * than hidden — a launch that never lands in the catalog would otherwise be
   * invisible on BegFi forever, with no error anywhere.
   */
  const [recordState, setRecordState] = useState<"idle" | "recording" | "done" | "failed">("idle");
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuccess || !hash || !launched || recordState !== "idle") return;
    let cancelled = false;
    setRecordState("recording");
    void (async () => {
      try {
        const res = await fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: launched.token,
            txHash: hash,
            mode,
            image: logo.trim() ? logo.trim() : undefined,
          }),
        });
        const result = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !result?.ok) {
          setRecordError(result?.error ?? "Couldn't add the token to the launchpad.");
          setRecordState("failed");
          return;
        }
        setRecordState("done");
      } catch {
        if (!cancelled) {
          setRecordError("Couldn't reach the server.");
          setRecordState("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuccess, hash, launched, mode, logo, recordState]);

  /* Retry resets to idle, which is what re-arms the effect above. */
  function retryRecord() {
    setRecordError(null);
    setRecordState("idle");
  }

  /*
   * Genesis is reserved for BegFi's own launch, and that launch does not
   * exist yet: no $BEG contract, no address (README, "blocked on things
   * outside the code"). The factory would happily accept a 5%-to-self launch
   * from any wallet — which is exactly the thing the label must not invite —
   * so until $BEG is configured the button stays dead in this mode, with the
   * notice above saying why.
   */
  const genesisReserved = mode === "genesis" && !BEG_CONFIGURED;

  function validate(): string | null {
    if (!name.trim()) return "Give the token a name.";
    if (!symbolClean) return "Give the token a ticker.";
    if (!/^[A-Z0-9]{2,10}$/.test(symbolClean)) return "A ticker is 2 to 10 letters or digits.";
    return null;
  }

  async function launch() {
    setError(null);
    const problem = validate();
    if (problem) return setError(problem);
    if (expectedEconomics === undefined) return setError("Still reading the launch terms. Try again in a moment.");
    if (genesisReserved) return setError("The $BEG launch is reserved. Standard mode is open to any wallet.");
    if (launchEnabled === false) return setError("This factory is switched off right now; launches are not possible.");
    if (canLaunch === false) return setError("This wallet isn't permitted to launch right now.");
    if (taxTooHigh) return setError("The creator tax is above the cap this factory allows.");
    if (notEnoughGas) return setError(`Not enough ETH. You need ${formatEth(fee)} for the fee plus gas.`);

    try {
      await writeContractAsync({
        abi: ponsFactoryAbi,
        address: PONS_FACTORY,
        functionName: "launchToken",
        // The recipient is the launcher's own wallet. Sending it to a BegFi
        // splitter is the next step, and deliberately not done here: that
        // contract is unaudited and nothing should be routed into it yet.
        args: [
          {
            name: name.trim(),
            symbol: symbolClean,
            logo: logo.trim(),
            description: description.trim(),
            socials: {
              twitter: socials.twitter.trim(),
              telegram: socials.telegram.trim(),
              discord: socials.discord.trim(),
              website: socials.website.trim(),
              farcaster: socials.farcaster.trim(),
            },
            creatorFeeRecipient: address as `0x${string}`,
            creatorTaxBps: Number(creatorTaxBps),
            buybackEnabled: false,
            expectedEconomics,
            // Random, so two identical tokens never collide on CREATE2. Not a
            // secret — the same salt can be reused by anyone who wants the same
            // address, which is why it is not derived from anything sensitive.
            salt: `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")}` as `0x${string}`,
          },
          LAUNCH_CONFIG_ID,
          NATIVE_PAIR,
          [],
        ],
        value: fee,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /reject|denied|cancel/i.test(msg)
          ? "You rejected the transaction."
          : /insufficient funds/i.test(msg)
            ? "Not enough ETH to cover the launch fee and gas."
            : /user rejected/i.test(msg)
              ? "You rejected the transaction."
              : "The launch didn't go through. Nothing was created.",
      );
    }
  }

  // ---- done -----------------------------------------------------------------
  if (isSuccess && hash) {
    return (
      <div className="rounded-3xl border-[1.5px] border-beg-lime p-6">
        <p className="text-xl font-extrabold text-beg-lime">Launched</p>
        {launched ? (
          <>
            <p className="mt-2 text-[13px] text-beg-dim">The token is live at</p>
            <p className="mt-1 break-all font-mono text-[13px] text-beg-ink">{launched.token}</p>

            {recordState === "recording" || recordState === "idle" ? (
              <p className="mt-3 text-[13px] text-beg-dim">Adding it to the BegFi launchpad…</p>
            ) : null}

            {recordState === "failed" ? (
              <div className="mt-3 grid gap-2">
                <p className="text-[13px] text-beg-ink">
                  {recordError} The launch itself went through. This is only the catalog entry,
                  and its page on BegFi stays hidden until it is added.
                </p>
                <button
                  type="button"
                  onClick={() => void retryRecord()}
                  className="btn-ghost justify-self-start px-4 py-2 text-[13px] font-bold text-beg-ink"
                >
                  Try again
                </button>
              </div>
            ) : null}

            {/*
              The link appears only once the catalog entry exists — the token
              page it points at serves recorded launches, and showing it earlier
              would send the launcher straight to a 404.
            */}
            {recordState === "done" ? (
              <a href={`/token/${launched.token}`} className="btn-primary mt-3 inline-block">
                Open its page
              </a>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-beg-dim">
            Confirmed on-chain. Its page is already live at{" "}
            <span className="font-mono">/token/&lt;its address&gt;</span>; the token address is in
            the transaction below.
          </p>
        )}
        <p className="mt-3 text-[13px] text-beg-dim">
          <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            View the transaction
          </a>
        </p>
      </div>
    );
  }

  /*
   * The form itself is always visible, like every other launchpad: what the
   * connection gates is only the submit button at the bottom. Hiding the whole
   * form behind a lone connect button made the page look empty and asked the
   * visitor to commit before showing them what a launch even involves.
   */
  const notReady = !isConnected || wrongChain;

  const field = "rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime";

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Which launch is this?</span>
        <div className="flex gap-2">
          {(
            [
              ["standard", "Standard", "3% creator tax to you"],
              ["genesis", "$BEG itself (reserved)", "BegFi's own launch, not open"],
            ] as const
          ).map(([value, label, note]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`flex-1 rounded-2xl border-[1.5px] p-3 text-left text-[13px] ${
                mode === value ? "border-beg-lime text-beg-lime" : "border-beg-line text-beg-ink"
              }`}
            >
              <b className="block">{label}</b>
              <span className="text-beg-dim">{note}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === "genesis" ? (
        <p className="notice p-4">
          $BEG has not launched, so there is no genesis launch to join. And when it happens, the
          5% goes to BegFi&apos;s dev wallet, not to whoever has this form open. Standard is the
          mode open to any wallet.
        </p>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Token name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={field} placeholder="BegFi" />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Ticker</span>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          maxLength={10}
          className={field}
          placeholder="BEG"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={280}
          className={`${field} resize-none`}
          placeholder="Plain text."
        />
      </label>

      {/*
        Upload when there is a session, a plain URL field when there is not.
        Uploads are scoped to a signed-in account — the storage path begins with
        the user id — so offering the picker to someone with no session would
        produce a failure after they had chosen a file, which is the worst moment
        to be told to sign in. A URL still works for anyone with the image hosted
        somewhere already.
      */}
      {userId ? (
        <ImageUpload
          bucket="token-logos"
          userId={userId}
          value={logo || null}
          onChange={(url) => setLogo(url ?? "")}
          label="Logo"
          hint="Shown beside your token everywhere it is listed. PNG, JPG, WebP or GIF, up to 2MB."
        />
      ) : (
        <label className="grid gap-1.5">
          <span className="text-[13px] text-beg-dim">Logo URL</span>
          <input
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            className={field}
            placeholder="https://…"
          />
          <span className="text-[12px] text-beg-dim">
            Sign in to upload an image instead of pasting a link.
          </span>
        </label>
      )}

      <details className="rounded-2xl border-[1.5px] border-beg-line p-3">
        <summary className="cursor-pointer text-[13px] text-beg-dim">Socials (optional)</summary>
        <div className="mt-3 grid gap-2">
          {(["twitter", "telegram", "discord", "website", "farcaster"] as const).map((key) => (
            <input
              key={key}
              value={socials[key]}
              onChange={(e) => setSocials({ ...socials, [key]: e.target.value })}
              className={field}
              placeholder={key}
            />
          ))}
        </div>
      </details>

      {/* What the launcher is agreeing to, before they sign. */}
      <dl className="card grid gap-2 text-[13px]">
        <Row label="Launch fee">{formatEth(fee)} ETH, paid once</Row>
        <Row label="Your creator tax">
          {Number(creatorTaxBps) / 100}% of every trade, to your wallet
        </Row>
        {totalTraderFee !== null ? (
          <Row label="Traders pay">{totalTraderFee}% total (Pons curve fee + your tax)</Row>
        ) : null}
        <Row label="Supply">1,000,000,000, fixed</Row>
        <Row label="Paired against">robinhood ETH</Row>
        <Row label="Graduates at">4.2 ETH of pooled liquidity</Row>
      </dl>

      {wrongChain ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          Your wallet is on another network. Launches happen on {robinhoodChain.name}; switch to
          continue.
        </p>
      ) : null}

      {notEnoughGas ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          Not enough ETH. You need {formatEth(fee)} for the fee plus gas.
        </p>
      ) : null}

      {canLaunch === false ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          This wallet isn&apos;t permitted to launch right now. Pons can restrict who may launch.
        </p>
      ) : null}

      {taxTooHigh ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          The creator tax is above the cap this factory allows.
        </p>
      ) : null}

      {launchEnabled === false ? (
        <p className="rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] text-beg-ink">
          This factory has been switched off, so launches are not possible on it right now. Nothing
          about this form is wrong; the contract itself is closed.
        </p>
      ) : null}

      {error ? <p className="text-center text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => (notReady ? openConnectModal?.() : void launch())}
        disabled={isPending || confirming || genesisReserved}
        className="btn-primary w-full p-4 text-[17px] disabled:opacity-40"
      >
        {isPending
          ? "Confirm in your wallet…"
          : confirming
            ? "Launching…"
            : !isConnected
              ? "Connect wallet to launch"
              : wrongChain
                ? `Switch to ${robinhoodChain.name} to launch`
                : `Launch for ${formatEth(fee)} ETH`}
      </button>

      <p className="text-center text-[13px] text-beg-dim">
        A launch cannot be undone. Check the name and ticker before you sign.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-beg-dim">{label}</dt>
      <dd className="text-right text-beg-ink">{children}</dd>
    </div>
  );
}

/** Wei as a short ETH string, without trailing zeros. */
function formatEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
