-- NOTIFICATION KINDS EXTENDED for the automatic payout system.
--
-- WHY THIS MIGRATION EXISTS. `notifications.kind` carries a CHECK constraint
-- listing the bell's allowed kinds. The sweeps grew three new legitimate
-- kinds — the earner's "you got paid" bell, the owner's payout summary and
-- low-pool alert — and every one of those inserts was silently refusing as
-- things stood. The bell is the product's retention loop; a CHECK that a
-- feature cannot write to is a feature that never happens.
--
-- The constraint is REPLACED, not dropped: kinds stay enum-guarded, the list
-- just grew with the product.
--
-- WHY THE LIST IS A SUPERSET OF LATER MIGRATIONS. This file runs before 0025
-- and 0029, but `node scripts/migrate.js` re-applies EVERY file on each run, so
-- a list that only knew this migration's kinds would reject the rows 0025 and
-- 0029 had already written and abort the run — which is exactly what happened
-- the first time a later migration shipped a new kind. Listing the current
-- kinds keeps re-running safe and keeps the column enum-guarded either way.
alter table begfi.notifications
  drop constraint if exists notifications_kind_check;

alter table begfi.notifications
  add constraint notifications_kind_check
  check ((kind = ANY (ARRAY['beg', 'fees', 'launch', 'graduation', 'move', 'claim', 'digest', 'earn_payout', 'campaign_payout', 'campaign_pool_low', 'payouts_paused', 'reconcile_alert', 'drop_reward', 'drop_payout', 'drop_funded'])));
