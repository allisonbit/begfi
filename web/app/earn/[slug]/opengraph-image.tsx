import { ImageResponse } from "next/og";

import { getCampaignBySlug } from "@/lib/campaigns";
import { formatAmount } from "@/lib/erc20";

export const alt = "Post & earn for this project on BegFi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * THE CAMPAIGN SHARE CARD.
 *
 * The card a poster attaches when they shout about a campaign. It carries the
 * project identity, the live pool-left and participants figures, and the
 * required tag — enough that a stranger seeing the card knows (1) what to
 * post, (2) what it pays, (3) that the pool is real money, not vibes.
 */
export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) {
    return new ImageResponse(
      (
        <div style={{ ...base, background: "#fffbe6", color: "#171208" }}>
          <div style={{ fontSize: 72, fontWeight: 800 }}>BegFi</div>
          <div style={{ fontSize: 40, color: "#6b6250" }}>This campaign could not be found.</div>
        </div>
      ),
      size,
    );
  }
  // Simple, honest figures for the card: the pool left is NOT an async call
  // here (edge/runtime OG renders should stay fast); the live numbers are on
  // the page itself, this card carries the pitch plus the serious labels.
  const emptyStats = {
    poolRemaining: 0n,
    poolTotal: 0n,
    totalPaid: 0n,
    participants: 0,
    todaySubmissions: 0,
    daysLeft: null as number | null,
  };

  return new ImageResponse(
    (
      <div style={{ ...base, background: "#fffbe6", color: "#171208", padding: "56px 64px", justifyContent: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 108,
              height: 108,
              borderRadius: 28,
              border: "4px solid #171208",
              background: "#b8ff2f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 800,
              overflow: "hidden",
            }}
          >
            {campaign.tokenSymbol.slice(0, 3)}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }}>
              {campaign.name}
              {campaign.isVerified ? " ✓" : ""}
            </div>
            <div style={{ fontSize: 30, color: "#6b6250", marginTop: 6 }}>
              Post on X with {campaign.requiredEntry} — get paid automatically
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
          {[
            { label: "pool remaining", value: `${formatAmount(emptyStats.poolRemaining, campaign.tokenDecimals)} ${campaign.tokenSymbol}` },
            { label: "daily budget", value: `${formatAmount(campaign.dailyBudget, campaign.tokenDecimals)} ${campaign.tokenSymbol}` },
            { label: "posters", value: String(emptyStats.participants) },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "20px 28px",
                borderRadius: 20,
                border: "3px solid #171208",
                background: "#ffffff",
              }}
            >
              <div style={{ fontSize: 44, fontWeight: 800 }}>{s.value}</div>
              <div style={{ fontSize: 22, color: "#6b6250", textTransform: "uppercase", letterSpacing: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", fontSize: 26, color: "#6b6250" }}>begfi.io/earn/{campaign.slug} · paid automatically, one post per wallet per day</div>
      </div>
    ),
    size,
  );
}

const base: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, 'Segoe UI', sans-serif",
};
