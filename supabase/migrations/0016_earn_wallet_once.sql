-- Earn: ONE claim per WALLET, ever.
--
-- THE RULE, STATED ONCE AND ENFORCED TWICE. Eligibility is decided only by
-- the wallet address: a wallet with no claim record may always claim, and a
-- wallet with a record may never claim again — not tomorrow, not from another
-- device, not from another account. Everything device- and IP-shaped from 0014
-- is retired here: those limits made shared hardware (a family phone, a
-- campus NAT, a VPN exit) block wallets that had never claimed, which pushed
-- people who had never earned anything into a false "come back tomorrow".
--
-- The rule is enforced at TWO layers on purpose:
--   1. the applications check `begfi.earn_claims` before paying (readability,
--      the right message);
--   2. the database's UNIQUE constraint rejects the second insert no matter
--      how two racing requests arrive (correctness, no race).

create table if not exists begfi.earn_claims (
  id uuid primary key default gen_random_uuid(),
  -- STORED LOWERCASE. The address is compared lowercase everywhere; a
  -- checksummed duplicate must never become a second identity.
  wallet_address text not null unique check (wallet_address = lower(wallet_address)),
  user_id uuid references begfi.profiles (id) on delete set null,
  username text,
  -- The submission that triggered the claim, for the audit trail.
  last_submission_id uuid,
  total_reward numeric(78,0) not null check (total_reward > 0),
  payout_tx text,
  claimed_at timestamptz not null default now()
);

create index if not exists earn_claims_user_idx on begfi.earn_claims (user_id);

alter table begfi.earn_claims enable row level security;

drop policy if exists earn_claims_read_public on begfi.earn_claims;
create policy earn_claims_read_public on begfi.earn_claims
  for select using (true);

-- No insert/update policies: claims are written only by the server with the
-- service role, so the table cannot be self-crediting from a browser.

grant select on begfi.earn_claims to anon, authenticated;
grant all privileges on begfi.earn_claims to service_role;

-- Backfill: wallets whose approved submissions have already been paid out
-- (payout_tx is set — the transfer really happened) get their claim record, so
-- the new wallet-once rule does not let them claim again from another account.
-- Rows without a payout are left out deliberately: their money never moved.
insert into begfi.earn_claims (wallet_address, user_id, username, last_submission_id, total_reward, payout_tx)
select s.wallet_address, s.user_id, s.username, s.id, s.reward_amount, s.payout_tx
from begfi.earn_submissions s
where s.status = 'approved' and s.payout_tx is not null
on conflict (wallet_address) do nothing;

-- The settings row keeps pool bookkeeping; the daily_limit column stops being
-- the rule and becomes a vestige. Leave it in place (dropping a column the
-- settings UI still selects would break the live site mid-deploy) but default
-- new installs to 1 and stop the UI from reading it as a rule.
update begfi.earn_settings set daily_limit = 1 where daily_limit <> 1;
