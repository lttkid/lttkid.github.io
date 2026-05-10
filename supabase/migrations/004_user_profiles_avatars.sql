create table if not exists public.user_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  avatar_color text not null default '#2563EB',
  updated_at timestamptz not null default now(),
  constraint user_profiles_avatar_color_hex check (avatar_color ~ '^#[0-9A-Fa-f]{6}$')
);

alter table if exists public.user_profiles
  add column if not exists display_name text not null default '',
  add column if not exists avatar_url text,
  add column if not exists avatar_color text not null default '#2563EB',
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

drop policy if exists "user profiles owner access" on public.user_profiles;
create policy "user profiles owner access" on public.user_profiles
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars',
  'user-avatars',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read own user avatars" on storage.objects;
create policy "read own user avatars" on storage.objects
for select using (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "insert own user avatars" on storage.objects;
create policy "insert own user avatars" on storage.objects
for insert with check (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "update own user avatars" on storage.objects;
create policy "update own user avatars" on storage.objects
for update using (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "delete own user avatars" on storage.objects;
create policy "delete own user avatars" on storage.objects
for delete using (
  bucket_id = 'user-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
