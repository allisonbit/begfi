#!/usr/bin/env python
"""
Renders every `card` in chapters.json to ONE 1920x1080 sticker card, as a single
HTML file the capture step screenshots element by element.

The palette and the hard-offset shadows are the site's own tokens (web/app/globals.css):
cream sheet, near-white card stock, ink borders, Robin Neon as the accent. A card
that looked like a different product would undercut the whole point of the video.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

chapters = json.loads((ROOT / "chapters.json").read_text(encoding="utf-8"))

cards = []
for chapter in chapters["chapters"]:
    for index, beat in enumerate(chapter["beats"], start=1):
        if "card" not in beat:
            continue
        cards.append(
            {
                "id": f"{chapter['id']}-{index}",
                "chapter": chapter["title"],
                "data": beat["card"],
            }
        )

shell = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BegFi explainer cards</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #fff3d6;
    --card: #fffcf2;
    --line: #161616;
    --ink: #161616;
    --dim: #59626f;
    --lime: #ccff00;
    --logo: #00a651;
    --blue: #3b6bff;
    --yellow: #ffd21f;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    font-family: "Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink);
  }
  /* The site's "sticker sheet": a faint ink polka-dot grid. */
  .card {
    position: relative;
    width: 1920px;
    height: 1080px;
    /* The top strip belongs to the brandmark and the chapter label, so the
       card's own content starts below them and stays vertically centred. */
    padding: 210px 108px 150px;
    background-color: var(--bg);
    background-image: radial-gradient(rgba(22, 22, 22, 0.16) 2.4px, transparent 2.6px);
    background-size: 30px 30px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .brand {
    position: absolute; top: 58px; left: 108px;
    display: flex; align-items: center; gap: 16px;
    font-weight: 800; font-size: 40px; letter-spacing: -0.02em;
  }
  .brand .dot { width: 20px; height: 20px; border-radius: 50%; background: var(--logo); border: 4px solid var(--line); }
  .chapter {
    position: absolute; top: 62px; right: 108px;
    font-size: 26px; font-weight: 700; color: var(--dim); text-transform: uppercase; letter-spacing: 0.14em;
  }
  .kicker {
    display: inline-block; align-self: flex-start;
    background: var(--lime); border: 4px solid var(--line); border-radius: 999px;
    padding: 10px 26px; font-size: 28px; font-weight: 800; letter-spacing: 0.02em;
    box-shadow: 5px 5px 0 0 var(--line); margin-bottom: 34px;
  }
  h1 {
    font-size: 96px; line-height: 1.02; font-weight: 800; letter-spacing: -0.035em;
    max-width: 1500px; text-wrap: balance;
  }
  .lead { margin-top: 26px; font-size: 44px; color: var(--dim); font-weight: 600; max-width: 1400px; }
  ul { margin-top: 46px; display: flex; flex-direction: column; gap: 20px; }
  li {
    list-style: none; display: flex; align-items: center; gap: 22px;
    background: var(--card); border: 4px solid var(--line); border-radius: 20px;
    padding: 20px 30px; font-size: 34px; font-weight: 700; letter-spacing: -0.01em;
    box-shadow: 7px 7px 0 0 var(--line); max-width: 1560px;
  }
  li .bullet { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: var(--blue); border: 4px solid var(--line); }
  li:nth-child(2n) .bullet { background: var(--yellow); }
  li:nth-child(3n) .bullet { background: var(--lime); }
  .foot {
    position: absolute; bottom: 54px; left: 108px; right: 108px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 26px; font-weight: 700; color: var(--dim);
  }
</style>
</head>
<body>
__CARDS__
</body>
</html>
"""

blocks = []
for card in cards:
    data = card["data"]
    points = "\n".join(
        f'      <li><span class="bullet"></span>{point}</li>' for point in data.get("points", [])
    )
    lead = f'<p class="lead">{data["lead"]}</p>' if data.get("lead") else ""
    blocks.append(
        f"""<section class="card" id="card-{card['id']}">
  <div class="brand"><span class="dot"></span>begfi</div>
  <div class="chapter">{card['chapter']}</div>
  <span class="kicker">{data['kicker']}</span>
  <h1>{data['title']}</h1>
  {lead}
  <ul>
{points}
  </ul>
  <div class="foot"><span>begfi.io</span><span>card {card['id']}</span></div>
</section>"""
    )

out = BUILD / "cards.html"
out.write_text(shell.replace("__CARDS__", "\n\n".join(blocks)), encoding="utf-8")
print(f"wrote {out} with {len(cards)} cards")
for card in cards:
    print("  card-" + card["id"], "—", card["data"]["title"])
