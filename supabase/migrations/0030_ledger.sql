-- ONE LEDGER FOR EVERY MOVEMENT ------------------------------------------------
--
-- Until now a movement lived only in the table that happened to record it:
-- campaign deposits in campaign_deposits, drop deposits in drop_deposits,
-- payouts in earn_payouts. Reading "what has this pool received and paid"
-- meant three queries and a join in the caller, and every new money path had
-- another chance to forget one of them.
--
-- This table is that one read. It is append only: nothing updates an amount,
-- nothing deletes. Rows arrive from triggers on the three source tables, so a
-- money path cannot be added without its movement landing here as long as it
-- writes one of those tables. The triggers run after the source row commits,
-- in the same transaction, so the ledger cannot be ahead of or behind the
-- thing it describes.
--
-- `token_address` NULL means $BEGFI itself: the pool's own payouts predate the
-- token column and still have no address stored. The display layer reads it
-- that way; do not invent an address for it.
--
-- `source_key` is the idempotency key. A re-scanned deposit carries the same
-- tx_hash and log_index, and a payout is keyed by its row id, so replaying
-- either inserts nothing.

create table if not exists begfi.ledger (
  id bigserial primary key,
  kind text not null check (kind in ('deposit', 'payout', 'refund', 'fee')),
  pool_kind text not null check (pool_kind in ('campaign', 'drop', 'pool')),
  -- Polymorphic on purpose: a campaign, a drop or the pool, and no FK that
  -- would have to be one of three tables. The row keeps its pool id after the
  -- pool is retired, which is the append-only rule.
  pool_id uuid,
  token_address text,
  amount numeric(78, 0) not null check (amount > 0),
  wallet_address text,
  tx_hash text,
  source_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists ledger_pool_idx on begfi.ledger (pool_kind, pool_id, created_at desc);
create index if not exists ledger_created_idx on begfi.ledger (created_at desc);

alter table begfi.ledger enable row level security;

-- No public policy. The ledger is read through the server's admin client
-- (`web/lib/ledger.ts`) so a row is never exposed without its pool's context.
grant select on begfi.ledger to service_role;

-- Campaign deposits ----------------------------------------------------------
create or replace function begfi.ledger_record_campaign_deposit()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  insert into begfi.ledger
    (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
  values
    ('deposit', 'campaign', new.campaign_id, new.token_address, new.amount,
     new.depositor, new.tx_hash,
     'deposit:campaign:' || new.tx_hash || ':' || new.log_index,
     new.created_at)
  on conflict (source_key) do nothing;
  return new;
end;
$$;

drop trigger if exists ledger_campaign_deposit on begfi.campaign_deposits;
create trigger ledger_campaign_deposit
  after insert on begfi.campaign_deposits
  for each row execute function begfi.ledger_record_campaign_deposit();

-- Drop deposits --------------------------------------------------------------
create or replace function begfi.ledger_record_drop_deposit()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  insert into begfi.ledger
    (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
  values
    ('deposit', 'drop', new.drop_id, new.token_address, new.amount,
     new.depositor, new.tx_hash,
     'deposit:drop:' || new.tx_hash || ':' || new.log_index,
     new.created_at)
  on conflict (source_key) do nothing;
  return new;
end;
$$;

drop trigger if exists ledger_drop_deposit on begfi.drop_deposits;
create trigger ledger_drop_deposit
  after insert on begfi.drop_deposits
  for each row execute function begfi.ledger_record_drop_deposit();

-- Payouts --------------------------------------------------------------------
-- One trigger covers both the row created already sent and the row flipped to
-- sent after its transfer confirmed. `source_key` is the payout id, so the two
-- orderings cannot produce two ledger rows.
create or replace function begfi.ledger_record_payout()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  if new.status <> 'sent' then
    return new;
  end if;

  insert into begfi.ledger
    (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
  values
    ('payout',
     case
       when new.campaign_id is not null then 'campaign'
       when new.drop_id is not null then 'drop'
       else 'pool'
     end,
     coalesce(new.campaign_id, new.drop_id),
     new.token_address,
     new.amount,
     new.wallet_address,
     new.tx_hash,
     'payout:' || new.id,
     coalesce(new.sent_at, now()))
  on conflict (source_key) do nothing;
  return new;
end;
$$;

drop trigger if exists ledger_payout_insert on begfi.earn_payouts;
create trigger ledger_payout_insert
  after insert on begfi.earn_payouts
  for each row execute function begfi.ledger_record_payout();

drop trigger if exists ledger_payout_sent on begfi.earn_payouts;
create trigger ledger_payout_sent
  after update of status on begfi.earn_payouts
  for each row execute function begfi.ledger_record_payout();

-- Backfill -------------------------------------------------------------------
-- Historical rows predate the triggers. Deposits first, then confirmed
-- payouts; `on conflict` makes this safe to run again.
insert into begfi.ledger
  (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
select 'deposit', 'campaign', d.campaign_id, d.token_address, d.amount, d.depositor,
       d.tx_hash, 'deposit:campaign:' || d.tx_hash || ':' || d.log_index, d.created_at
from begfi.campaign_deposits d
on conflict (source_key) do nothing;

insert into begfi.ledger
  (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
select 'deposit', 'drop', d.drop_id, d.token_address, d.amount, d.depositor,
       d.tx_hash, 'deposit:drop:' || d.tx_hash || ':' || d.log_index, d.created_at
from begfi.drop_deposits d
on conflict (source_key) do nothing;

insert into begfi.ledger
  (kind, pool_kind, pool_id, token_address, amount, wallet_address, tx_hash, source_key, created_at)
select 'payout',
       case
         when p.campaign_id is not null then 'campaign'
         when p.drop_id is not null then 'drop'
         else 'pool'
       end,
       coalesce(p.campaign_id, p.drop_id),
       p.token_address, p.amount, p.wallet_address, p.tx_hash,
       'payout:' || p.id, coalesce(p.sent_at, p.created_at)
from begfi.earn_payouts p
where p.status = 'sent'
on conflict (source_key) do nothing;
