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
alter table begfi.notifications
  drop constraint if exists notifications_kind_check;

alter table begfi.notifications
  add constraint notifications_kind_check
  check ((kind = ANY (ARRAY['beg', 'fees', 'launch', 'graduation', 'move', 'claim', 'digest', 'earn_payout', 'campaign_payout', 'campaign_pool_low'])));
