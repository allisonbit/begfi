# BegFi brand assets

Everything visual the site and future agents need. The mascot is the brand;
everything else in the sticker palette serves it.

## Source files (canonical)

| File | What it is |
|---|---|
| `begfi-logo.jpg` | The original mascot artwork (1254×1254). Never edit — the source of truth. |
| `begfi-logo-512.png` | Square 512×512 PNG export of the full artwork. |

The mascot: a coin with big teary begging eyes, wearing Robinhood's green cap
(with the white "B" and the feather). Begging literally, on-brand for the chain.

## Where the mascot lives in the app

| File | Purpose |
|---|---|
| `web/app/icon.png` | Favicon / site icon (512×512, head+hat crop). Next serves it automatically — browser tabs, bookmarks, WhatsApp/X favicons. |
| `web/app/apple-icon.png` | iOS home-screen icon (180×180). |
| `web/lib/og/mascot.ts` | Generated module embedding the mascot as base64, so the Open Graph cards render it with no network fetch. |
| `web/app/opengraph-image.tsx` | Site-level share card (what crawlers show when begfi.io is posted). |
| `web/app/[username]/opengraph-image.tsx` | **The link card**: what people see when begfi.io/username is shared. |
| `web/app/beg/[id]/opengraph-image.tsx` | Pre-existing per-beg card (dark variant). |

## Regenerate

```bash
python scripts/gen-mascot-og.py   # rewrites web/lib/og/mascot.ts from begfi-logo-512.png
```

## Tokens (globals.css)

| Token | Hex | Role |
|---|---|---|
| `beg-bg` | `#FFF3D6` | The sticker sheet (page background) |
| `beg-card` | `#FFFCF2` | Card stock |
| `beg-ink` / `beg-line` | `#161616` | Borders and text |
| `beg-dim` | `#59626F` | Secondary text |
| `beg-lime` | `#CCFF00` | Robin Neon — the accent, always with ink text |
| `beg-logo` | `#00A651` | Robinhood logo green (the "fi", the feather) |

OG cards hardcode these hex values (Tailwind classes do not reach the Satori
render), and every element carries an explicit `display` — see the note at the
top of any `opengraph-image.tsx` for why.
