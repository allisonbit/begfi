-- Trade events for BegFi catalog tokens.
--
-- The explore page shows 24h volume, trade counts and price change the way
-- odys does, and odys' numbers come from trade events. BegFi's curves emit
-- CurveBuy and CurveSell; the indexer records them here so the page can rank
-- and sum real trades instead of inventing them.
--
-- Applied by pasting into the Supabase SQL editor, like every migration here.
-- Additive only: no existing table or view is touched.

-- The curve address, cached next to the catalog row. The indexer backfills it
-- from the factory once per token; the trade scan then queries logs per curve
-- directly instead of re-reading the factory for the whole catalog every run.
alter table begfi.launches
  add column if not exists curve_address text
  check (curve_address is null or curve_address = lower(curve_address));

-- One row per curve trade log. `quote_amount` is positive wei of ETH in (a
-- buy) or out (a sell) — the volume figure, kept raw so sums are exact and a
-- display rounding can never compound. `token_amount` is the token side
-- (tokensOut on a buy, tokensIn on a sell), also raw: quote per token is the
-- trade's price, and the first-to-last ratio across a window is the price
-- change odys shows. Trade identity is the log identity: (tx_hash, log_index),
-- which makes a re-run over an overlapping window a no-op rather than a
-- double count.
create table if not exists begfi.trades (
  tx_hash text not null,
  log_index integer not null,
  token_address text not null check (token_address = lower(token_address)),
  curve_address text not null check (curve_address = lower(curve_address)),
  trader text not null check (trader = lower(trader)),
  is_buy boolean not null,
  quote_amount numeric(78,0) not null,
  token_amount numeric(78,0) not null,
  block_number bigint not null,
  block_time timestamptz not null,
  primary key (tx_hash, log_index)
);

create index if not exists trades_token_time_idx on begfi.trades (token_address, block_time desc);

alter table begfi.trades enable row level security;

-- No policies on purpose, the same call as `transfers`: rows are written and
-- read by the server (indexer and the explore page) with the service role,
-- which bypasses RLS. A client that could write a row could mint fake volume
-- on a page that ranks by it; a client that could read every trade would
-- publish the whole trader graph for no rendering need.
