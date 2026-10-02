-- Seed the reserved username list (spec §8, §12).
--
-- These are enforced inside `begfi.claim_username`, so the list is authoritative
-- here rather than in the client. Impersonation is the main abuse risk in this
-- product (spec §12): a profile at /robinhood or /support is a way to make a
-- stranger's send look official.
--
-- Names already covered by a route in the app are included as well, so a claimed
-- username can never be shadowed by, or shadow, a page.

insert into begfi.reserved_usernames (username, note) values
  -- The product itself, and its routes.
  ('begfi',     'the product'),
  ('beg',       'the token'),
  ('admin',     'route'),
  ('administrator', 'route'),
  ('api',       'route'),
  ('dashboard', 'route'),
  ('launch',    'route'),
  ('login',     'route'),
  ('logout',    'route'),
  ('settings',  'route'),
  ('signup',    'route'),
  ('terms',     'route'),
  ('privacy',   'route'),
  ('legal',     'route'),
  ('about',     'route'),
  ('help',      'route'),
  ('support',   'route'),
  ('security',  'route'),
  ('staff',     'route'),
  ('mod',       'route'),
  ('moderator', 'route'),
  ('official',  'impersonation'),
  ('verified',  'impersonation'),
  ('root',      'impersonation'),
  ('token',     'route'),
  -- Robinhood, because the product runs on their chain and must never imply
  -- their endorsement (spec §2).
  ('robinhood', 'impersonation'),
  ('hood',      'impersonation'),
  ('rhc',       'impersonation'),
  ('robinhoodchain', 'impersonation')
on conflict (username) do update set note = excluded.note;

-- Launch blocklist (spec §9.5): names and tickers that would impersonate
-- Robinhood, a listed stock, or a major token.
insert into begfi.launch_blocklist (term, note) values
  ('robinhood', 'impersonation'),
  ('hood',      'impersonation'),
  ('rhc',       'impersonation'),
  ('begfi',     'the product'),
  ('apple',     'listed stock'),
  ('aapl',      'ticker'),
  ('tesla',     'listed stock'),
  ('tsla',      'ticker'),
  ('nvidia',    'listed stock'),
  ('nvda',      'ticker'),
  ('microsoft', 'listed stock'),
  ('msft',      'ticker'),
  ('amazon',    'listed stock'),
  ('amzn',      'ticker'),
  ('alphabet',  'listed stock'),
  ('googl',     'ticker'),
  ('meta',      'listed stock'),
  ('usdc',      'major token'),
  ('usdt',      'major token'),
  ('weth',      'major token'),
  ('eth',       'major token'),
  ('bitcoin',   'major token'),
  ('btc',       'major token')
on conflict (term) do update set note = excluded.note;
