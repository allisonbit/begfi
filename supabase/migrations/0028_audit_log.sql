-- THE AUDIT LOG — who did what to the money, kept where it cannot be rewritten.
--
-- THE PLAN ASKS FOR THIS (§13: "audit log for every admin and money action") and
-- it is the last piece of the incident story the rest of this session built. A
-- kill switch records WHO flipped it in `payout_controls.paused_by` — one fact,
-- on the row it changed. What it cannot answer is the question an incident review
-- actually starts with: "what else happened around then?" A control that stops
-- payouts, a sweep that ran, a reconciliation that found a shortfall: today those
-- leave evidence in four different tables, in four different shapes, and none of
-- them says "these are the things that happened, in order".
--
-- WHY THE APPEND-ONLY POSTURE IS ENFORCED BY ABSENCE OF A POLICY. Like
-- `reconciliation_runs` (0025), this table has NO client-readable policy at all
-- and its privileges are service-role only. Rows name wallets and pool amounts, so
-- the admin console reads them server-side AFTER checking the caller's wallet with
-- `isAdminWallet` — one allowlist, in one language, where every other admin surface
-- already checks it.
--
-- `detail` is TEXT, not a jsonb document, deliberately. The useful audit entry in
-- this product is a sentence a human reads at 2am ("Automatic: reconciliation found
-- the wallet short — BEGFI is short by 210,000"), not a serialised object that
-- needs a schema to interpret. Structured detail is welcome in it, but the rule is
-- that the row is readable on its own.
create table if not exists begfi.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- Lowercase wallet address, or a machine label such as the distributor's own
  -- address for automatic actions. Lowercased by the same rule as every other
  -- address in this schema, so an entry can be matched against a wallet.
  actor text not null check (actor = lower(actor)),
  -- Dotted and verb-shaped: 'payouts.pause', 'payouts.resume', 'payouts.sweep',
  -- 'reconcile.run'. A free-text action column becomes four spellings of the same
  -- event within a month.
  action text not null,
  -- What the action concerned: a token, a cycle date, a pool. Null for actions
  -- that are about the whole system.
  subject text,
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- The console reads newest-first, and an incident window is a range query.
create index if not exists audit_log_at_idx on begfi.audit_log (at desc);
create index if not exists audit_log_action_idx on begfi.audit_log (action, at desc);

alter table begfi.audit_log enable row level security;

grant all privileges on begfi.audit_log to service_role;
