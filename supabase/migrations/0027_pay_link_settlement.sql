-- THE PAY-LINK SETTLEMENT, RECORDED AT DETECTION TIME — and the bell that says so.
--
-- WHY THIS REPLACES THE WINDOW SEARCH (`KNOWN_ISSUES.md` #17). Until now, "was
-- this request paid?" was answered at RENDER time by looking at the most recent 50
-- transfers to the owner for that token and picking one that covered the ask. A
-- link paid earlier than that window read "waiting" while its total above still
-- showed the money — the number was right and the badge was wrong, on the page a
-- payer decides on.
--
-- The fix is not a bigger window: it is to decide ONCE, at the moment the transfer
-- is indexed, and keep the answer. `settled_tx` is that answer. The indexer already
-- holds the confirmed transfer — the exact event — so no second detection path is
-- invented, and "paid" becomes one row of ours instead of a query that has to
-- guess which of fifty payments was the one meant.
--
-- THREE COLUMNS, NOT A BOOLEAN, for the same reason nothing else here stores a
-- verdict without its evidence: the hash is what a payer can check, the amount is
-- what arrived (which may exceed the ask — a tip over the request is still a
-- settlement), and the timestamp is when the chain said so. A `paid boolean` would
-- be an assertion with nothing behind it.
alter table begfi.pay_links
  add column if not exists settled_tx text,
  add column if not exists settled_amount numeric(78, 0),
  add column if not exists settled_at timestamptz;

-- AT MOST ONE LINK PER TRANSACTION. A single transfer pays one wallet once, and the
-- settlement rules settle one link from it, so the same hash appearing twice means
-- a bug — and an index is what makes that impossible rather than merely unlikely.
create unique index if not exists pay_links_settled_tx_idx
  on begfi.pay_links (settled_tx)
  where settled_tx is not null;

-- The bell's allowed kinds, extended by the payment bell and the gas alert.
-- REPLACED, not dropped, and the full list is repeated: a dropped constraint would
-- let any string into `kind` forever, which is how a column that was an enum becomes
-- an arbitrary text field. The list is 0025's plus the two new kinds.
alter table begfi.notifications drop constraint if exists notifications_kind_check;
alter table begfi.notifications
  add constraint notifications_kind_check
  check (
    kind = any (
      array[
        'beg', 'fees', 'launch', 'graduation', 'move', 'claim', 'digest',
        'earn_payout', 'campaign_payout', 'campaign_pool_low',
        'payouts_paused', 'reconcile_alert',
        -- New: a payment request was settled, and the payout wallet is low on gas.
        -- The first is the pay-link product's retention loop; the second is the
        -- alert whose absence is `KNOWN_ISSUES.md` #1's silent failure mode — a
        -- sweep that cannot send because it has no gas looks exactly like a sweep
        -- with nothing to do.
        'pay_link_paid', 'low_gas'
      ]
    )
  );
