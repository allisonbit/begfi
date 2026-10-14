-- Messages with each beg: an optional note a sender attaches to a $BEGFI send.
--
-- WHAT THIS IS. A transfer on the chain carries no story; this column carries
-- it. The message is bound to a CONFIRMED transfer (tx, log index) — not to a
-- row that might exist — so a message can never appear for money that never
-- arrived.
--
-- THE LIMITS. 140 characters, as the spec says. Stored ALLOWING anything but
-- rendered escaped (React), so html/anchor injection is inert by construction.
-- Profanity and spam sites are filtered at write time by the API (a matched
-- word is refused; a link is allowed but the recipient can hide it).
--
-- THE HIDE. `hidden_by_recipient` is the recipient's switch: a row stays in
-- their own views (their dashboard sees everything, including hidden), but
-- the public feed and profile supporter list drop hidden rows. Two lists,
-- one column, no ambiguity.
--
-- THE RACE. (tx_hash, log_index) is already UNIQUE from the transfers table's
-- identity; this column rides on the same row. The indexer upserts
-- (on conflict) so a retried block never duplicates and never overwrites a
-- message that came first.

alter table begfi.transfers
  add column if not exists message text check (char_length(message) <= 140),
  add column if not exists hidden_by_recipient boolean not null default false;

comment on column begfi.transfers.message is
  'Optional 140-char note the sender attached; set by the send API, rendered as text only.';
comment on column begfi.transfers.hidden_by_recipient is
  'Recipient opt-out: true removes the row from public feeds and supporter lists, not from their own dashboard view.';
