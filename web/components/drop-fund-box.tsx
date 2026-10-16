"use client";

import { useState } from "react";
import { useAccount, useBalance, useChainId, useConnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";

import { DEFAULT_CHAIN_ID, robinhoodChain, shortAddress, txUrl } from "@/lib/chains";
import { erc20Abi, formatAmount, parseAmount } from "@/lib/erc20";

/**
 * FUND A POT — the one flow in a drop that spends the OWNER's money, so it is
 * built to make the money land in the right pot and to say why when it cannot.
 *
 * TWO STEPS, IN THIS ORDER, because the order is what makes attribution exact:
 *
 *   1. REGISTER THE INTENT. The server writes a `drop_fundings` row naming
 *      THIS wallet, this drop and this token. Nothing is transferred yet.
 *   2. SEND. The transfer goes from the wallet to the payout address the server
 *      returned, with the amount the server computed against the token's own
 *      decimals. Then the "check" call scans a recent window with the indexer's
 *      own matcher so the pot becomes claimable in seconds.
 *
 * THE WALLET MATCH IS CHECKED AND SAID OUT LOUD. The match key is the FUNDER's
 * address: a transfer from a different wallet than the one the intent names is
 * a transfer no intent claims, and it would sit credited nowhere. So the panel
 * refuses to send from the wrong wallet and says which one to switch to, rather
 * than letting someone fund a pot with money the ledger cannot see.
 */
export function DropFundBox({
  dropId,
  tokenAddress,
  tokenDecimals,
  tokenSymbol,
  prizeDisplay,
  distributorAddress,
  funderWallet,
}: {
  dropId: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
  prizeDisplay: string;
  distributorAddress: string;
  /** The signed-in profile's own wallet — the ONLY wallet an intent can name. */
  funderWallet: string;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [intent, setIntent] = useState<{
    fundingId: string;
    amount: string;
    address: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [matched, setMatched] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  const connectedWallet = address?.toLowerCase() ?? null;
  const wrongWallet = connectedWallet !== null && connectedWallet !== funderWallet.toLowerCase();

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: tokenAddress as `0x${string}`,
    functionName: "balanceOf",
    args: [funderWallet as `0x${string}`] as const,
    chainId: DEFAULT_CHAIN_ID,
  });

  const parsed = parseAmount(amount, tokenDecimals);
  const tooMuch = parsed !== null && typeof balance === "bigint" && parsed > balance;

  async function registerIntent() {
    setError(null);
    setStatus(null);
    if (parsed === null || parsed <= 0n) {
      setError(`That isn't a valid amount for a token with ${tokenDecimals} decimals — use a number like 5000 or 12.5.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/drop/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", dropId, amount }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; fundingId?: string; address?: string; amount?: string }
        | null;
      if (res.ok && body?.ok && body.fundingId && body.address && body.amount) {
        setIntent({ fundingId: body.fundingId, amount: body.amount, address: body.address });
        setStatus("Deposit registered. Now send the tokens from the wallet below.");
      } else {
        setError(body?.error ?? "Could not register the deposit.");
      }
    } catch {
      setError("Network problem — nothing was registered. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!intent) return;
    setError(null);
    setStatus(null);
    try {
      if (!isConnected) await connectAsync({ connector: injected() });
      if (chainId !== DEFAULT_CHAIN_ID) await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
      const value = BigInt(intent.amount);
      // No `account` override: the SENDER is whatever wallet is connected, and
      // the wrong-wallet guard above is what keeps it the intent's own wallet.
      // Forcing an account here would ask the connector to sign for a wallet it
      // does not hold.
      await writeContractAsync({
        chain: robinhoodChain,
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [intent.address as `0x${string}`, value],
      });
      setStatus("Sent — waiting for the transfer to confirm, then the pot is credited.");
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 160) : "The wallet refused the transfer.");
    }
  }

  async function check() {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drop/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check", fundingId: intent.fundingId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: string; credited?: number; note?: string; error?: string }
        | null;
      if (body?.status === "matched") {
        setMatched(true);
        setStatus("Credited — the pot can pay prizes now.");
      } else {
        setStatus(body?.note ?? body?.error ?? "Not credited yet.");
      }
    } catch {
      setError("Network problem — could not check just now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <b className="text-[15px] text-beg-ink">Fund this pot</b>
        <p className="mt-1 text-[12px] text-beg-dim">
          Your deposit pays the prizes — {prizeDisplay} {tokenSymbol} each. Register it first, then send; the ledger credits only the
          transfer your own wallet makes.
        </p>
      </div>

      {!intent ? (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="text-[12px] font-bold text-beg-ink">Amount of {tokenSymbol} to deposit</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              inputMode="decimal"
              spellCheck={false}
              className="w-full rounded-full border-2 border-beg-ink bg-beg-card px-4 py-2.5 text-[14px] font-bold text-beg-ink outline-none placeholder:font-normal placeholder:text-beg-dim"
            />
          </label>
          {typeof balance === "bigint" ? (
            <p className="text-[11px] text-beg-dim">
              Balance: {formatAmount(balance, tokenDecimals)} {tokenSymbol}
            </p>
          ) : null}
          <button type="button" onClick={() => void registerIntent()} disabled={busy} className="btn-primary w-fit px-5 py-3 text-[14px]">
            {busy ? "Registering…" : "Register deposit"}
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="card-sm grid gap-1 p-3">
            <span className="text-[12px] font-bold text-beg-ink">
              Send {formatAmount(BigInt(intent.amount), tokenDecimals)} {tokenSymbol} to
            </span>
            <span className="break-all font-mono text-[11px] text-beg-dim">{intent.address}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(intent.address);
                setCopied(true);
              }}
              className="btn-ghost w-fit px-3 py-1.5 text-[11px] font-bold text-beg-ink"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <span className="text-[11px] text-beg-dim">
              From your own wallet: <span className="font-mono">{shortAddress(funderWallet)}</span> — a transfer from any other wallet
              cannot be credited to this pot.
            </span>
          </div>

          {wrongWallet ? (
            <p className="text-[12px] font-bold text-beg-ink">
              Your connected wallet is {shortAddress(connectedWallet ?? "")}. Switch to {shortAddress(funderWallet)} to send, or the
              deposit will not match.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void send()} disabled={isPending || confirming || wrongWallet} className="btn-primary px-5 py-3 text-[14px]">
              {isPending ? "Confirm in wallet…" : confirming ? "Confirming…" : "Send from my wallet"}
            </button>
            <button type="button" onClick={() => void check()} disabled={busy} className="btn-ghost px-4 py-3 text-[13px] font-bold text-beg-ink">
              I&apos;ve sent it — check
            </button>
          </div>

          {confirmed && hash && !matched ? (
            <p className="text-[12px] text-beg-dim">
              Transfer confirmed.{" "}
              <a href={txUrl(hash)} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-beg-ink">
                View it ↗
              </a>{" "}
              Press “check” to credit it now.
            </p>
          ) : null}
        </div>
      )}

      {status ? <p className="text-[13px] font-bold text-beg-ink">{status}</p> : null}
      {error ? <p className="text-[13px] font-bold text-beg-ink">{error}</p> : null}
      {tooMuch ? <p className="text-[12px] text-beg-dim">That is more than the wallet holds.</p> : null}
    </div>
  );
}
