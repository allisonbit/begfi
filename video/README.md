# BegFi explainer video

`begfi-explainer.mp4` — a narrated walkthrough of the whole platform: the four products,
the money engine, the safety controls, the public books, and what is deliberately not
built yet. It is assembled from the real live site, so the pictures are the product.

## What is in it

| Chapter | Covers | Visual |
|---|---|---|
| 01 What BegFi is | one sentence, the four products, the shared engine | cards + home page |
| 02 Beg pages | profile pay page, begs with goals, tip receipts | `/leooo`, `/beg/<id>`, `/begs` |
| 03 Pay Links | a request with an amount, and how it settles from the chain | `/pay/<id>` + cards |
| 04 Campaigns | funded pools, daily automatic payouts, verification | `/earn`, `/leaderboard` |
| 05 Drops | the pot, the prize, the cap, the reuse boundary | `/drop/<id>`, `/drops` |
| 06 The money engine | no escrow, one hot key, two layers against double payment, one ledger, attribution by intent | cards |
| 07 The safety controls | kill switch (fails closed), hourly reconciliation, gas alerting, audit log | cards |
| 08 Transparency | the public books, including the bad news | `/transparency` |
| 09 What is not built | custody and refunds, sybil resistance, the indexer's lag, one chain | cards |
| 10 Where it goes next | per-pool addresses first, then the rest | cards + home |

## How it is built

```
chapters.json          the script: chapters -> beats, each beat = narration + one visual
tools/cards.py         renders every `card` to build/cards.html (the site's own palette)
tools/tts.py           edge-tts: one audio clip per BEAT, then measures its exact length
tools/capture.mjs      Playwright + Chrome: cards and live pages -> shots/<beat>.png
tools/build.py         ffmpeg (imageio-ffmpeg's bundled binary) -> segments -> final MP4
tools/fixture.cjs      capture-time demo drop, seeded before the Drops chapter is shot
```

One segment per beat, and a segment's length **is** its narration's length, so the
picture cannot drift from the voice. Motion is a slow crop drift rather than a zoom:
deterministic, fast to encode, and it does not fight the loop demuxer.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install edge-tts imageio-ffmpeg      # ffmpeg comes bundled
.venv/Scripts/python tools/cards.py
node tools/fixture.cjs seed            # prints a drop id
node tools/capture.mjs --drop=<id>
.venv/Scripts/python tools/tts.py      # needs network: edge-tts is an online voice
.venv/Scripts/python tools/build.py
node tools/fixture.cjs remove          # removes the demo pot it created
```

`shots/`, `audio/`, `build/` and `.venv/` are build output and are not committed.

## Honesty notes

- **The Drops chapter shows a demo pot.** It was seeded with `tools/fixture.cjs`,
  captured, and then deleted — the database ends with zero drops, which the script
  prints. Its own description on the page says it is a demo pot made for this video,
  and its deposit and payout hashes are fixture strings, not real transactions.
- **Every other visual is the live production site** (`https://www.begfi.io`),
  captured in a 1920x1080 session. Nothing is mocked up.
- **No dashboard screenshots.** The dashboard needs a signed-in wallet, and signing in
  means holding a key, which this pipeline does not. The narration describes the
  dashboard instead of showing it.
- **The narration states the current limitations out loud** (no per-pool deposit
  addresses, no refund path, identity-only sybil resistance, indexer lag, one chain).
  The video is written to survive a viewer checking it against the site.
