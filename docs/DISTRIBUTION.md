# DISTRIBUTION.md

The plan's §14 checklist, with the honest current state of each line. Site: **begfi.io**.

Rule of thumb: BegFi grows from **shared links**, so anything that makes a link unfurl well is worth more
than a feature. Anything that makes a link invisible to a crawler is a leak.

---

## 1. SEO foundation — status: ❌ mostly missing

| Item | State | Note |
|---|---|---|
| Unique title + meta description per page | 🟡 | Home, `/beg/[id]`, `/t/[tx]` and `/[username]` have real metadata. Not audited page-by-page. |
| OG / X card images | ✅ | Strong: `app/opengraph-image.tsx`, `/beg/[id]/opengraph-image`, `/t/[tx]/opengraph-image`, `/[username]/opengraph-image`, plus a QR share card at `/api/qr/[username]?card=1`. |
| `sitemap.xml` | ❌ | **Absent.** Dynamic sitemap should be built from `profiles`, `begs`, `campaigns`, `launches` (published rows only). |
| `robots.txt` | ❌ | **Absent.** Should allow public routes and point at the sitemap; keep `/dashboard`, `/api`, `/t/` out of the index where thin. |
| Clean URLs | ✅ | `/username`, `/earn/<slug>`, `/beg/<id>`, `/t/<tx>`. |
| Structured data (JSON-LD) | ❌ | Add `Person`/`Organization` on username pages, `Product`/`Offer`-style data on launches. |
| Fast load | 🟡 | Next.js 16 + Vercel; no measurement on file. Run Lighthouse before claiming it. |
| Semantic headings + alt text | 🟡 | Headings are reasonable; alt text needs a pass. |
| PWA manifest | ❌ | Prerequisite for a Play Store listing and for add-to-home-screen. |

## 2. Analytics — status: ❌ nothing exists

- [ ] GA4 property, ID injected via env; **absent ID must degrade to a no-op**, never a broken page.
- [ ] Google Search Console verification + sitemap submission.
- [ ] Bing Webmaster Tools (the same sitemap; free incremental traffic).
- [ ] Product events with the plan's names: `drop_created`, `drop_funded`, `drop_claimed`,
      `campaign_joined`, `campaign_created`, `payment_received`, `pay_link_created`, `qr_downloaded`.
- [ ] Funnel view: visit → connect → act → share. Without it, no product decision here is evidence-based
      (`KNOWN_ISSUES.md` #10).

## 3. Where to list the site

*Confirm each is still open and current before submitting — rules and relevance change.*

- [ ] **Google Search Console** (sitemap) and **Bing Webmaster Tools**.
- [ ] **Product Hunt** launch — needs a real screenshot set and a demo GIF.
- [ ] **Crypto/dapp directories**: DappRadar, DappBay, and chain-specific directories for Robinhood Chain,
      Base and Ethereum once live. DeFiLlama only if there is TVL to report honestly.
- [ ] **CoinGecko / CoinMarketCap** — for the **token**, if applicable. Not a site listing.
- [ ] **Chain ecosystem showcases and grant programs** for each supported chain.
- [ ] **Reddit**: r/CryptoCurrency, r/ethdev, r/Base etc. — follow each community's self-promotion rules
      exactly, or the account gets banned and the channel is lost permanently.
- [ ] **X / Telegram / Discord communities** — project presence plus the Campaigns product used on itself
      (influencer and KOL partnerships run through our own tool; the campaign page is the pitch).
- [ ] **Airdrop / giveaway listing sites** and Web3 aggregators — the natural home for Drops links once
      Drops ships.

## 4. Built-in virality (already partly true, extend it)

- ✅ Rich X preview on every existing shareable link; "Built on Robinhood Chain" branding in the footer.
- ✅ A tip receipt page framed as something worth posting.
- ✅ QR + downloadable share card for the pay page.
- [ ] Share card + one-tap X post for **Drops**, **campaigns** and **pay requests** (the per-page OG rule in
      `ROADMAP.md` Part C #11).
- [ ] Referral rewards that pay only on a **verified outcome** (ROADMAP Part C #8).

## 5. Google Play — status: ❌ not started

- [ ] PWA manifest + icons + install prompt first (cheapest path to an icon on a home screen).
- [ ] Store listing text (short + full description), screenshots for phone and tablet sizes.
- [ ] Feature graphic and app icon in the required sizes.
- [ ] **Privacy policy URL** — `/privacy` exists; it must be accurate about what is collected, including
      wallet addresses and analytics.
- [ ] Data-safety declaration matching what the code actually does (no guessing).
- [ ] Keyword set: "crypto giveaway", "crypto payment link", "get paid in crypto", "earn crypto", plus the
      chain names.
- [ ] Decide native wrapper vs Trusted Web Activity — TWA is the honest default for a Next.js app, and it
      needs a verified digital-asset-link file served from the domain.

## 6. The one thing to do first

Ship `sitemap.ts` + `robots.ts` + `manifest.ts` and the env-gated analytics module (`ROADMAP.md` Phase 0).
Everything else on this page is guesswork until those exist, because right now there is no crawl coverage
and no measurement.
