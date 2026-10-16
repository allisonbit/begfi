/**
 * Capture step: the visuals that back each beat of chapters.json.
 *
 *  - every `card` becomes a 1920x1080 sticker card (rendered by cards.py, shot here)
 *  - every `page` becomes a 1920x1080 viewport screenshot of the real live site
 *
 * Playwright is resolved from the machine's global npm root (it is already
 * installed there); Chrome is used as the browser channel, so nothing is
 * downloaded and the project's own dependencies stay untouched.
 *
 *   node tools/capture.mjs [--drop=<drop uuid>] [--base=https://www.begfi.io]
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "shots");
mkdirSync(SHOTS, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = ""] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const BASE = args.base ?? "https://www.begfi.io";
const DROP = args.drop ?? "DEMO_DROP_ID";
// Cards are rendered locally and cost nothing to redo; pages are network work.
const CARDS_ONLY = "cards-only" in args;
const PAGES_ONLY = "pages-only" in args;

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const { chromium } = require(path.join(globalRoot, "playwright"));

const chapters = JSON.parse(readFileSync(path.join(ROOT, "chapters.json"), "utf8"));

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();

// ---- cards -----------------------------------------------------------------
if (!PAGES_ONLY) {
  const cardsHtml = pathToFileURL(path.join(ROOT, "build", "cards.html")).href;
  await page.goto(cardsHtml, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  let cards = 0;
  for (const chapter of chapters.chapters) {
    for (const [index, beat] of chapter.beats.entries()) {
      if (!beat.card) continue;
      const id = `${chapter.id}-${index + 1}`;
      const element = page.locator(`#card-${id}`);
      await element.screenshot({ path: path.join(SHOTS, `${id}.png`) });
      cards += 1;
      console.log(`  card   ${id}  ${beat.card.title}`);
    }
  }
  console.log(`captured ${cards} cards`);
}

// ---- pages -----------------------------------------------------------------
let pages = 0;
for (const chapter of CARDS_ONLY ? [] : chapters.chapters) {
  for (const [index, beat] of chapter.beats.entries()) {
    if (!beat.page) continue;
    const id = `${chapter.id}-${index + 1}`;
    const url = beat.page.replace("../", BASE).replace("DEMO_DROP_ID", DROP);
    const response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const status = response ? response.status() : 0;
    await page.waitForTimeout(2200); // let client-rendered numbers settle
    const scroll = Number(beat.scroll ?? 0);
    if (scroll > 0) {
      await page.evaluate((fraction) => {
        window.scrollTo({ top: document.body.scrollHeight * fraction, behavior: "instant" });
      }, scroll);
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
    pages += 1;
    console.log(`  page   ${id}  ${status}  ${url}`);
  }
}
console.log(`captured ${pages} pages`);

await browser.close();
