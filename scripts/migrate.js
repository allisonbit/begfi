#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql to the BegFi database.
 *
 * The Supabase CLI is not installed on this machine, and the migrations are
 * plain SQL with no CLI-specific syntax, so this runs them over a direct
 * connection instead. It reads the connection string out of web/.env.local
 * rather than taking it as an argument, so the password never lands in shell
 * history or a process listing.
 *
 * Uses the SESSION pooler (5432), not the transaction pooler (6543). In
 * transaction mode a multi-statement script can be split across backends, which
 * is fine for single queries but wrong for a migration that creates a schema and
 * then objects inside it.
 *
 * Idempotent: every statement in the migrations is guarded (if not exists,
 * create or replace, drop policy if exists), so re-running is safe.
 *
 *   node scripts/migrate.js            # apply
 *   node scripts/migrate.js --dry-run  # list what would run
 */
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { Client } = require("pg");

const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const ENV_FILE = join(ROOT, "web", ".env.local");

function connectionString() {
  if (process.env.POSTGRES_URL_NON_POOLING) return process.env.POSTGRES_URL_NON_POOLING;

  let raw;
  try {
    raw = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new Error(`No connection string. Set POSTGRES_URL_NON_POOLING, or create ${ENV_FILE}.`);
  }

  // Deliberately a tiny parser rather than a dotenv dependency: these files are
  // written by hand, one KEY="value" per line, and adding a package to read them
  // would be more moving parts than the thing it parses.
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*POSTGRES_URL_NON_POOLING\s*=\s*"?([^"]+)"?\s*$/.exec(line);
    if (match) return match[1];
  }

  throw new Error(`POSTGRES_URL_NON_POOLING not found in ${ENV_FILE}.`);
}

/**
 * Drop the connection-string SSL parameters.
 *
 * Supabase's pooler presents a certificate that does not chain to a public root,
 * so a strict verify fails with "self-signed certificate in certificate chain".
 * The fix is `ssl: { rejectUnauthorized: false }` on the client — but pg parses
 * `sslmode=require` from the URL into *verify-full* semantics and that wins over
 * the explicit option. Removing the parameter is what lets the option apply.
 *
 * The trade-off is that this trusts the connection without verifying the
 * server's identity, which is what `sslmode=require` meant here anyway. That is
 * acceptable for a migration run over the pooler from a developer machine. It
 * would NOT be acceptable for the app's runtime traffic, which goes through
 * supabase-js and does verify.
 */
function withoutSslParams(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("supa");
  return parsed.toString();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found.");
    return;
  }

  console.log(`Migrations: ${files.join(", ")}`);

  if (dryRun) {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`  ${file} — ${sql.length} bytes`);
    }
    console.log("Dry run. Nothing applied.");
    return;
  }

  const client = new Client({
    connectionString: withoutSslParams(connectionString()),
    ssl: { rejectUnauthorized: false },
    // Long enough for the schema creation and the view to build on a cold project.
    statement_timeout: 120_000,
  });

  await client.connect();
  console.log("Connected.");

  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`  applying ${file} ... `);

      // One transaction per file, so a failure in the middle of a migration
      // leaves the database on the previous one rather than half-migrated.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback");
        console.log("FAILED");
        throw error;
      }
    }

    // Report what exists, so a silent no-op cannot look like success.
    const { rows } = await client.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'begfi'
        order by table_name`,
    );
    console.log(`\nbegfi schema now holds ${rows.length} objects:`);
    for (const row of rows) console.log(`  ${row.table_name}`);

    const { rows: policies } = await client.query(
      `select count(*)::int as n from pg_policies where schemaname = 'begfi'`,
    );
    console.log(`RLS policies: ${policies[0].n}`);

    const { rows: invoker } = await client.query(
      `select reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'begfi' and c.relname = 'profile_stats'`,
    );
    console.log(`profile_stats options: ${JSON.stringify(invoker[0]?.reloptions ?? null)}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
