"use client";

import { useMemo, useState } from "react";

import type { Candle, ChartWindow } from "@/lib/chart-data";
import { usdPriceLabel } from "@/lib/eth-price";

/**
 * The token chart: candles in an inline SVG, no library.
 *
 * WHY ROLLED, NOT IMPORTED. A candlestick of 48 buckets is a polylines-and-
 * rects problem, and pulling chart.js apex lightweight-charts in for it adds
 * bundles the send flow never asked for. The interactive parts that matter —
 * window switch, hover readout — are here; the parts that do not (grid
 * lines, logarithmic axis) are not, on purpose:
 *
 * The window fallback is real state, not fake tabs: a window with a single
 * trade per bucket renders nothing (the filter lives in the server read),
 * and the switcher says "n trades" so the emptiness explains itself.
 */
export function TokenChart({
  data,
  currentPrice,
  currentPriceUsd,
  tokenSymbol,
}: {
  data: Record<ChartWindow, { candles: Candle[]; quoteVolumeEth: number | null; trades: number }>;
  /** The headline price in ETH per token — what the candles plot. */
  currentPrice: number | null;
  /** The same price in USD, when the feed allows it; null keeps ETH labels. */
  currentPriceUsd: number | null;
  tokenSymbol: string;
}) {
  const [win, setWin] = useState<ChartWindow>("24h");
  const [hover, setHover] = useState<Candle | null>(null);

  const series = data[win];

  const view = useMemo(() => {
    const candles = series.candles;
    if (candles.length < 2) return null;
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const max = Math.max(...highs, currentPrice ?? 0);
    const min = Math.min(...lows, currentPrice ?? Infinity);
    const pad = (max - min) * 0.08 || max * 0.08 || 1;
    return { max: max + pad, min: Math.max(0, min - pad), candles };
  }, [series, currentPrice]);

  const W = 560;
  const H = 180;

  const last = series.candles.at(-1)?.c ?? null;
  const first = series.candles[0]?.o ?? null;
  const changePct =
    first && last && first > 0 ? ((last - first) / first) * 100 : null;
  const up = (changePct ?? 0) >= 0;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[19px] font-extrabold text-beg-ink">
            {currentPriceUsd !== null
              ? usdPriceLabel(currentPriceUsd)
              : currentPrice !== null
                ? currentPrice > 0 && currentPrice < 0.000001
                  ? `${currentPrice.toFixed(12).replace(/0+$/, "")} ETH`
                  : `${currentPrice.toPrecision(4)} ETH`
                : "—"}
          </span>
          {changePct !== null ? (
            <span className={`text-[13px] font-bold ${up ? "text-[#0a8f4c]" : "text-[#d33]"}`}>
              {up ? "+" : ""}
              {changePct.toFixed(1)}% {win}
            </span>
          ) : null}
        </div>
        <div className="flex gap-1">
          {(["24h", "7d", "30d"] as ChartWindow[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWin(w)}
              className={`rounded-full border-[1.5px] px-3 py-1.5 text-[12px] font-bold transition-colors ${
                w === win ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:text-beg-ink"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {view ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${tokenSymbol} price chart, ${win}`}>
          {view.candles.map((c, i) => {
            const x = (i / (view.candles.length - 1)) * (W - 8) + 4;
            const y = (v: number) => H - ((v - view.min) / (view.max - view.min)) * (H - 10) - 5;
            const bodyTop = y(Math.max(c.o, c.c));
            const bodyBottom = y(Math.min(c.o, c.c));
            const green = c.c >= c.o;
            const color = green ? "#0a8f4c" : "#d33";
            const bw = Math.max(2, (W / view.candles.length) * 0.55);
            return (
              <g
                key={c.t}
                onMouseEnter={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
              >
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1.2} />
                <rect
                  x={x - bw / 2}
                  y={bodyTop}
                  width={bw}
                  height={Math.max(1.2, bodyBottom - bodyTop)}
                  fill={color}
                />
                {/* Hover target: a transparent strip over the whole slot. */}
                <rect x={x - bw} y={0} width={bw * 2} height={H} fill="transparent" />
              </g>
            );
          })}
          {currentPrice !== null ? (
            <line
              x1={0}
              x2={W}
              y1={H - ((currentPrice - view.min) / (view.max - view.min)) * (H - 10) - 5}
              y2={H - ((currentPrice - view.min) / (view.max - view.min)) * (H - 10) - 5}
              stroke="#161616"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.5}
            />
          ) : null}
        </svg>
      ) : (
        <div className="grid h-[120px] place-items-center rounded-xl border-2 border-dashed border-beg-line text-[13px] text-beg-dim">
          {series.trades === 0 ? `No trades in the last ${win} yet.` : "Not enough trades in this window to draw a line."}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-beg-dim">
        <span>
          {hover
            ? `${new Date(hover.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · c ${
                currentPriceUsd !== null && currentPrice
                  ? usdPriceLabel(hover.c * (currentPriceUsd / currentPrice))
                  : hover.c > 0 && hover.c < 0.000001
                    ? hover.c.toFixed(12).replace(/0+$/, "")
                    : hover.c.toPrecision(4)
              }`
            : `${series.trades} trades · ${series.quoteVolumeEth !== null ? `${series.quoteVolumeEth.toFixed(3)} ETH volume` : ""}`}
        </span>
      </div>
    </div>
  );
}
