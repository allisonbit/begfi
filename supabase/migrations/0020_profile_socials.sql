-- Linked socials: X, Telegram, and a website on the public profile, plus the
-- X verification tick.
--
-- THE FIELDS. x_handle already exists (it stays the canonical X identity and
-- the object of the tick). telegram_handle and website_url are new, optional,
-- and validated at the write route the same way x_handle is.
--
-- THE TICK. x_verified_at is a timestamp, not a boolean, so the profile can
-- say WHEN it was verified and the handle checks should not outlive it. The
-- verification is simple by design (the spec calls for that): the profile's
-- owner posts an identifying code on their X account, the server checks
-- either a post URL containing the code or a bio containing it — no OAuth,
-- no third-party API key requirement beyond what the site already uses.
-- x_verify_code holds the currently issued challenge; empty means none.

alter table begfi.profiles
  add column if not exists telegram_handle text
    check (char_length(telegram_handle) between 1 and 40),
  add column if not exists website_url text
    check (char_length(website_url) between 1 and 120),
  add column if not exists x_verified_at timestamptz,
  add column if not exists x_verify_code text
    check (char_length(x_verify_code) between 1 and 20);

comment on column begfi.profiles.x_verified_at is
  'When X verification last succeeded. The tick shows only while x_handle matches the handle that was verified.';
