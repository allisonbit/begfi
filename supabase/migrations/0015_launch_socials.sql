-- Launch socials, per token.
--
-- The Pons launch call already carries a socials struct (twitter, telegram,
-- discord, website, farcaster); it is part of the on-chain launch params.
-- The catalog never stored it, so the token page could not show it. This
-- column holds what the launcher submitted, one JSON object per row —
-- not five columns, because a missing network and an empty string are the
-- same absence and five nullable columns lie about that in five ways.

alter table begfi.launches
  add column if not exists socials jsonb;

-- Backfill the genesis token, from the brand's real channels. These are the
-- accounts BegFi itself runs; a later standard launch through the form
-- writes its own socials at launch time.
update begfi.launches
set socials = '{"twitter": "BegFihood", "telegram": "https://t.me/BegFihood"}'::jsonb
where token_address = '0xbeabe398103822e4e2cf3dafe3ab285f7767bced'
  and socials is null;
