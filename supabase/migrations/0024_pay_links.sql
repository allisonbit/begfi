-- Pay Links: a fixed ask with a memo, at begfi.io/pay/<id>.
--
-- WHY A TABLE RATHER THAN A QUERY STRING. The same reasoning as `begs`
-- (migration 0005), and it has aged well: an amount and a memo carried in a
-- URL get truncated by chat clients, mangled by link previews, and mangled a
-- second time by whatever turns them into a card. A row gives a short stable
-- link that survives being pasted anywhere, one place for the owner to close
-- it, and a `created_at` that settlement matching can trust.
--
-- NON-CUSTODIAL, BY CONSTRUCTION. This table holds an ASK, never money: no
-- balance, no deposit address, no custody. The payer sends $BEGFI straight to
-- the owner's wallet, exactly as on `/[username]`, and BegFi never touches it.
-- "Paid" is therefore DERIVED from the indexer's confirmed `transfers` rows
-- (see lib/pay-links.ts) rather than stored here — one truth, the chain, which
-- is also why a wrong row in this table could never move money.
--
-- WHY `amount` IS NULLABLE. A fixed amount is the product the plan asks for,
-- and a link with no amount is a plain "pay me what you like" ask with a memo
-- — the same link, minus the number. Nullable costs nothing and avoids a
-- second table for the open-ended case.

create table if not exists begfi.pay_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references begfi.profiles (id) on delete cascade,

  -- The token asked for, in base units (18 decimals on $BEGFI). Raw integers,
  -- never floats: a decimal 20.5 in a numeric would round in a way that makes
  -- the amount on the page disagree with the amount in the transaction.
  token_address text not null check (token_address = lower(token_address)),

  -- Robinhood Chain today. The column exists now so that adding a chain is a
  -- row rather than a second migration over live links — Phase 1 turns this
  -- into a reference to the `chains` table (docs/ROADMAP.md).
  chain_id integer not null default 4663,

  -- Null means "any amount". Non-null must be positive: a zero ask is not an
  -- ask, and it would make settlement matching meaningless.
  amount numeric(78, 0) check (amount is null or amount > 0),

  -- The one line a payer reads. Short on purpose: it is rendered on a share
  -- card and in a payment confirmation, both of which are small.
  memo text check (memo is null or char_length(memo) between 1 and 90),

  -- Retiring a link must be possible without deleting it: the money that
  -- already arrived is on-chain and the page should still be able to say
  -- "this link was closed" rather than vanish into a 404.
  is_active boolean not null default true,

  created_at timestamptz not null default now()
);

create index if not exists pay_links_owner_idx on begfi.pay_links (owner_id, created_at desc);
create index if not exists pay_links_public_idx on begfi.pay_links (created_at desc) where is_active;

alter table begfi.pay_links enable row level security;

-- PUBLIC READ, and that is the whole point: the link has to work for someone
-- who has never signed in, and for a crawler that unfurls it in a chat. A
-- closed link is still readable so the page can say it is closed — hiding the
-- row would turn a clear answer into a 404.
drop policy if exists pay_links_read_public on begfi.pay_links;
create policy pay_links_read_public on begfi.pay_links
  for select using (true);

-- Only the owner creates their own row, and only through the server route
-- (which resolves the owner from the SESSION, never from the request body).
drop policy if exists pay_links_insert_own on begfi.pay_links;
create policy pay_links_insert_own on begfi.pay_links
  for insert with check (
    owner_id = (select id from begfi.profiles p where p.id = auth.uid())
  );

-- Update is for closing and reopening one's own link. No delete policy: a
-- retired link keeps its history, and the row is a receipt of an ask.
drop policy if exists pay_links_update_own on begfi.pay_links;
create policy pay_links_update_own on begfi.pay_links
  for update using (
    owner_id = (select id from begfi.profiles p where p.id = auth.uid())
  );

grant select on begfi.pay_links to anon, authenticated;
grant all privileges on begfi.pay_links to service_role;
