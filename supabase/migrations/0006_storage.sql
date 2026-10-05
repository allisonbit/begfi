-- Image uploads: avatars for anyone with an account, logos for anyone launching.
--
-- TWO BUCKETS, both PUBLIC TO READ and owner-only to write.
--
-- Public read is the point: an avatar appears on a public profile and a token
-- logo appears on a public token page, and a signed-URL scheme would mean those
-- pages break the moment a URL expires — on someone else's shared post, where the
-- breakage is invisible to us.
--
-- Write access is scoped by PATH, not by a column. Every object's name begins
-- with the uploader's user id, and the policy compares that first path segment
-- against `auth.uid()`. Storage has no row to attach an owner to, so the path is
-- the only thing available — and a check on it is what stops one account
-- overwriting another's image.
--
-- Sizes and types are enforced by the BUCKET, not by the client. A browser-side
-- `accept="image/*"` is a hint; `file_size_limit` and `allowed_mime_types` are
-- what actually stop someone posting a 50MB file or an HTML document with an
-- image extension. 2MB is generous for a logo or a headshot and small enough that
-- a mobile upload does not routinely fail.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'token-logos',
  'token-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- avatars
-- ---------------------------------------------------------------------------

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

-- The first path segment must be the uploader's own id. `(storage.foldername(name))[1]`
-- is the folder, so a path of `<uuid>/me.png` is writable only by that uuid.
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Delete is allowed for the same reason: someone should be able to remove their
-- own picture, and every other account's remains out of reach.
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- token-logos
-- ---------------------------------------------------------------------------

drop policy if exists token_logos_read on storage.objects;
create policy token_logos_read on storage.objects
  for select using (bucket_id = 'token-logos');

drop policy if exists token_logos_insert on storage.objects;
create policy token_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'token-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists token_logos_update on storage.objects;
create policy token_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'token-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists token_logos_delete on storage.objects;
create policy token_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'token-logos' and (storage.foldername(name))[1] = auth.uid()::text);
