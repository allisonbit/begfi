-- Messages with each beg: the sender's optional note, one per send.
--
-- WHY A SEPARATE TABLE. The indexer can lag (a transfer row appears when the
-- cron confirms it), but the message belongs to the sender's moment, not to
-- the indexer's schedule. So the message is written at send time against its
-- transaction hash and joined to `transfers` at read time — a message can
-- only ever appear next to money the chain actually confirmed, because the
-- transaction hash is verified ON-CHAIN by the message API before the row
-- exists.
--
-- ONE MESSAGE PER SEND. `tx_hash` is the primary key: a send is one story.
-- Hidden is the recipient's switch: hidden rows leave the public feeds and
-- supporter lists, but stay in the recipient's own dashboard view.

create table if not exists begfi.transfer_messages (
  tx_hash text primary key,
  sender_wallet text not null check (sender_wallet = lower(sender_wallet)),
  recipient_wallet text not null check (recipient_wallet = lower(recipient_wallet)),
  message text not null check (char_length(message) between 1 and 140),
  hidden_by_recipient boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists transfer_messages_recipient_idx
  on begfi.transfer_messages (recipient_wallet, created_at desc);

alter table begfi.transfer_messages enable row level security;

-- Messages are public until hidden: the feeds read them with the transfer.
drop policy if exists transfer_messages_read_public on begfi.transfer_messages;
create policy transfer_messages_read_public on begfi.transfer_messages
  for select using (true);

-- No insert/update policies: only the server (service role) writes, after it
-- has verified on-chain that the transaction really is a $BEGFI send to the
-- recipient, and only the recipient's own session can flip the hide switch
-- through the API. A browser cannot self-insert.

grant select on begfi.transfer_messages to anon, authenticated;
grant all privileges on begfi.transfer_messages to service_role;
