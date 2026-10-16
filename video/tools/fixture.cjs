/**
 * CAPTURE-TIME FIXTURE — a demo drop, so the Drops chapter of the explainer
 * video has a funded pot to show instead of the empty state.
 *
 * It writes ONE clearly-labelled demo pot (owner profile `demodrop`), one
 * credited deposit and one paid claim, all with fixture hashes, and `remove`
 * deletes every row it created. Nothing here is presented as a real user:
 * the drop's own description says it is a demo pot made for this video.
 *
 *   node tools/fixture.cjs seed      -> prints the drop id
 *   node tools/fixture.cjs remove
 */
const { readFileSync } = require("node:fs");
const { Client } = require("pg");

const EMAIL = "explainer-demo@example.invalid";
const TOKEN = "0x" + "e".repeat(40);
const FUNDER = "0x" + "f".repeat(40);
const OWNER_WALLET = "0x" + "d".repeat(40);
const CLAIMER = "0x" + "a".repeat(40);

function connectionString() {
  const raw = readFileSync(require("node:path").join(__dirname, "..", "..", "web", ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*POSTGRES_URL_NON_POOLING\s*=\s*"?([^"]+)"?\s*$/.exec(line);
    if (match) return match[1];
  }
  throw new Error("no POSTGRES_URL_NON_POOLING in web/.env.local");
}

function withoutSslParams(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("supa");
  return parsed.toString();
}

(async () => {
  const client = new Client({ connectionString: withoutSslParams(connectionString()), ssl: { rejectUnauthorized: false } });
  await client.connect();

  const existing = await client.query("select id from auth.users where email = $1", [EMAIL]);

  if (process.argv[2] === "remove") {
    for (const row of existing.rows) {
      await client.query("delete from begfi.earn_payouts where drop_id in (select id from begfi.drops where owner_id = $1)", [row.id]);
      await client.query("delete from begfi.drops where owner_id = $1", [row.id]);
      await client.query("delete from begfi.profiles where id = $1", [row.id]);
      await client.query("delete from auth.users where id = $1", [row.id]);
    }
    const left = await client.query("select count(*)::int n from auth.users where email = $1", [EMAIL]);
    const drops = await client.query("select count(*)::int n from begfi.drops");
    console.log(`fixture removed — demo users left: ${left.rows[0].n}, drops left in the database: ${drops.rows[0].n}`);
    await client.end();
    return;
  }

  const uid = existing.rows[0]?.id ?? (await client.query("select gen_random_uuid() id")).rows[0].id;
  if (!existing.rows[0]) {
    await client.query(
      "insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2)",
      [uid, EMAIL],
    );
    await client.query("insert into begfi.profiles (id, wallet_address, username) values ($1, $2, $3)", [uid, OWNER_WALLET, "demodrop"]);
  }
  await client.query("delete from begfi.drops where owner_id = $1", [uid]);

  const drop = await client.query(
    `insert into begfi.drops (owner_id, name, description, token_name, token_symbol, token_address, token_decimals, amount_per_claim, max_claims, status, closes_at)
     values ($1, 'Friday giveaway', $2, 'Pepe', 'PEPE', $3, 6, '200000000', 10, 'open', now() + interval '3 days')
     returning id`,
    [uid, "Demo pot, created for the BegFi explainer video. Two hundred PEPE to the first ten people.", TOKEN],
  );
  const dropId = drop.rows[0].id;

  await client.query(
    `insert into begfi.drop_deposits (drop_id, token_address, amount, depositor, tx_hash, log_index, block_number)
     values ($1, $2, '2000000000', $3, '0xdemo_deposit_for_the_explainer', 1, 1)`,
    [dropId, TOKEN, FUNDER],
  );
  await client.query(
    `insert into begfi.drop_claims (drop_id, user_id, username, wallet_address, amount, payout_tx, created_at)
     values ($1, $2, 'demodrop', $3, '200000000', '0xdemo_payout_for_the_explainer', now() - interval '2 minutes')`,
    [dropId, uid, CLAIMER],
  );

  console.log(dropId);
  await client.end();
})();
