"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { decodeEventLog } from "viem";
import { injected } from "wagmi/connectors";
import { ImageUpload } from "@/components/image-upload";
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
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
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

  const canSubmit =
    isConnected &&
    !wrongChain &&
    name.trim().length > 0 &&
    symbolClean.length > 0 &&
    expectedEconomics !== undefined &&
    canLaunch !== false &&
    !taxTooHigh &&
    !notEnoughGas &&
    !isPending &&
    !confirming;

  function validate(): string | null {
    if (!name.trim()) return "Give the token a name.";
    if (!symbolClean) return "Give the token a ticker.";
    if (!/^[A-Z0-9]{2,10}$/.test(symbolClean)) return "A ticker is 2–10 letters or digits.";
    return null;
  }

  async function launch() {
    setError(null);
    const problem = validate();
    if (problem) return setError(problem);
    if (expectedEconomics === undefined) return setError("Still reading the launch terms. Try again in a moment.");

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
            <a
              href={`/token/${launched.token}`}
              className="mt-3 inline-block rounded-full bg-beg-lime px-5 py-3 font-bold text-beg-bg"
            >
              Open its page
            </a>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-beg-dim">
            Confirmed on-chain. Its page appears once the launch is indexed.
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

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => void connectAsync({ connector: injected() })}
        className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg"
      >
        Connect wallet
      </button>
    );
  }

  if (wrongChain) {
    return (
      <div className="grid gap-3">
        <p className="text-center text-[13px] text-beg-dim">
          Your wallet is on another network. Launches happen on {robinhoodChain.name}.
        </p>
        <button
          type="button"
          onClick={() => void switchChainAsync({ chainId: DEFAULT_CHAIN_ID })}
          className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg"
        >
          Switch to {robinhoodChain.name}
        </button>
      </div>
    );
  }

  const field = "rounded-2xl border-[1.5px] border-beg-line bg-beg-bg p-3 text-beg-ink outline-none focus:border-beg-lime";

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-[13px] text-beg-dim">Which launch is this?</span>
        <div className="flex gap-2">
          {(
            [
              ["standard", "Standard", "3% creator tax"],
              ["genesis", "$BEG itself", "5% to the dev wallet"],
            ] as const
          ).map(([value, label, note]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
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
      <dl className="grid gap-2 rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px]">
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

      {error ? <p className="text-center text-[13px] text-beg-ink">{error}</p> : null}

      <button
        type="button"
        onClick={() => void launch()}
        disabled={!canSubmit}
        className="w-full rounded-full bg-beg-lime p-4 text-[17px] font-bold text-beg-bg disabled:opacity-40"
      >
        {isPending ? "Confirm in your wallet…" : confirming ? "Launching…" : `Launch for ${formatEth(fee)} ETH`}
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
