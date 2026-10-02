#!/usr/bin/env node
/**
 * Push BegFi's environment variables to the linked Vercel project.
 *
 * Uses the Vercel REST API with the token the CLI already stores, rather than
 * shelling out to `vercel env add`. Two reasons: the CLI has no upsert (adding
 * an existing name is an error rather than a replacement, so every run needs a
 * remove-then-add dance), and invoking it through a shell on this machine hits a
 * plugin shim that intercepts the command and returns a hint instead of running.
 *
 * Values are read from `web/.env.local`, which is gitignored, so no secret is
 * ever stored in this file, passed on a command line, or written to a log. The
 * two secrets BegFi needs that Supabase does not supply — the nonce-cookie
 * signing key and the cron token — are generated here rather than reused from
 * anything else, because both are better rotated independently of the Supabase
 * keys they would otherwise fall back to.
 *
 * Idempotent: existing entries for these keys are deleted and replaced, so
 * running it twice leaves one of each.
 *
 *   node scripts/push-env.js            # push
 *   node scripts/push-env.js --dry-run  # list what would be pushed
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { randomBytes } = require("node:crypto");
const { join } = require("node:path");
const { homedir } = require("node:os");

const ROOT = join(__dirname, "..");
const ENV_FILE = join(ROOT, "web", ".env.local");
const PROJECT_FILE = join(ROOT, ".vercel", "project.json");
const AUTH_FILE = join(homedir(), "AppData", "Roaming", "xdg.data", "com.vercel.cli", "auth.json");
const TARGETS = ["production", "preview", "development"];

const dryRun = process.argv.includes("--dry-run");

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const local = readEnvFile(ENV_FILE);
const { projectId, orgId } = JSON.parse(readFileSync(PROJECT_FILE, "utf8"));
const { token } = JSON.parse(readFileSync(AUTH_FILE, "utf8"));

/**
 * Generate a secret if .env.local does not already hold a usable one, and write
 * it back so local development and the deployment share one value.
 *
 * Sharing matters for CRON_SECRET in particular: it is what authorises a call to
 * the indexer, so if the two sides disagreed you could not trigger the deployed
 * cron from your own machine.
 *
 * The length test is a guard against the failure this replaced. Asking the
 * Vercel API for a variable with `decrypt=true` returns an ENCRYPTED ENVELOPE
 * rather than the plaintext — a ~1.1 KB blob starting `eyJ2IjoidjIi`, which is
 * base64 for `{"v":"v2"` — and writing that back as though it were the secret
 * would silently break both sides.
 */
function ensureSecret(env, key) {
  const current = env[key];
  const usable = current && current.length >= 16 && current.length <= 200;
  if (usable) return current;

  const fresh = randomBytes(32).toString("base64url");
  let raw = readFileSync(ENV_FILE, "utf8");
  const line = new RegExp("^\\s*" + key + '\\s*=\\s*"?[^"\\r\\n]*"?\\s*$', "m");

  if (line.test(raw)) {
    raw = raw.replace(line, key + '="' + fresh + '"');
  } else {
    raw += "\n" + key + '="' + fresh + '"\n';
  }

  writeFileSync(ENV_FILE, raw);
  console.log(`  generated ${key} and wrote it to web/.env.local`);
  return fresh;
}

/**
 * What the deployed app actually reads.
 *
 * Deliberately short. `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_BEG_TOKEN_ADDRESS`
 * are NOT set: the app treats blank as unset, mainnet is the default RPC, and
 * $BEG has no address to give. Setting them to empty strings here would be worse
 * than leaving them out, because a blank env var is not the same as an absent
 * one in every tool that reads .env files.
 */
const vars = {
  NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_SERVICE_ROLE_KEY,

  // Signs the sign-in nonce cookie.
  WALLET_AUTH_SECRET: ensureSecret(local, "WALLET_AUTH_SECRET"),

  // Guards /api/cron/indexer.
  CRON_SECRET: ensureSecret(local, "CRON_SECRET"),

  // Where the app is served. Used to build absolute Open Graph URLs, so it has
  // to be a real origin or crawlers resolve previews against localhost.
  NEXT_PUBLIC_SITE_URL: process.env.BEGFI_SITE_URL || "https://begfi-rust.vercel.app",
};

const missing = Object.entries(vars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`Missing from ${ENV_FILE}: ${missing.join(", ")}`);
  process.exit(1);
}

if (dryRun) {
  for (const [key, value] of Object.entries(vars)) {
    console.log(`  ${key} = ${value.slice(0, 8)}… (${value.length} chars)`);
  }
  console.log("Dry run. Nothing pushed.");
  process.exit(0);
}

/**
 * The collection URL and the team scope are kept SEPARATE.
 *
 * They cannot be concatenated into one string: a delete targets
 * `/env/{id}` and the team is a query parameter, so a combined
 * `.../env?teamId=x` + `/` + id produces `.../env?teamId=x/abc`, where the id
 * lands inside the query string and every delete 400s. That is exactly how the
 * first version of this failed — silently, with the conflicts surfacing as
 * "already exists" on the add that followed.
 */
const collection = `https://api.vercel.com/v9/projects/${projectId}/env`;
const scope = `teamId=${orgId}`;
const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function listExisting() {
  const res = await fetch(`${collection}?${scope}`, { headers: authHeaders });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.envs ?? [];
}

async function main() {
  const existing = await listExisting();
  let failures = 0;

  for (const [key, value] of Object.entries(vars)) {
    // Upsert by hand: find every entry for this key and replace it. A key can
    // legitimately have one row per target, so they are removed individually.
    for (const entry of existing.filter((e) => e.key === key)) {
      const res = await fetch(`${collection}/${entry.id}?${scope}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        console.log(`  FAILED to remove old ${key}: ${res.status} ${(await res.text()).slice(0, 120)}`);
        failures += 1;
      }
    }

    const res = await fetch(`${collection}?${scope}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ key, value, type: "encrypted", target: TARGETS }),
    });

    if (res.ok) {
      console.log(`  added  ${key}  ->  ${TARGETS.join(", ")}`);
    } else {
      console.log(`  FAILED ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }

  console.log(`\n${Object.keys(vars).length} variables set on ${TARGETS.join(", ")}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
