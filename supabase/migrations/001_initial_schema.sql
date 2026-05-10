create extension if not exists "pgcrypto";

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

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#2563EB',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#64748B',
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  storage_path text not null,
  file_hash text,
  source_modified_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sort_order integer not null default 2147000000,
  archived boolean not null default false,
  favorite boolean not null default false,
  summary text,
  content_text text,
  word_count integer not null default 0,
  indexed_at timestamptz,
  reading_estimate_minutes integer not null default 1,
  last_read_at timestamptz,
  last_scroll numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique (owner_id, storage_path),
  constraint documents_last_scroll_range check (last_scroll >= 0 and last_scroll <= 1)
);

alter table if exists public.documents
  add column if not exists content_text text,
  add column if not exists word_count integer not null default 0,
  add column if not exists indexed_at timestamptz,
  add column if not exists sort_order integer not null default 2147000000;

with ranked_documents as (
  select
    id,
    row_number() over (partition by owner_id order by imported_at desc, title asc) * 1000 as next_sort_order
  from public.documents
)
update public.documents
set sort_order = ranked_documents.next_sort_order
from ranked_documents
where public.documents.id = ranked_documents.id
  and public.documents.sort_order in (100000, 2147000000);

create table if not exists public.document_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create table if not exists public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  last_scroll numeric not null default 0,
  constraint reading_sessions_last_scroll_range check (last_scroll >= 0 and last_scroll <= 1)
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  selected_text text not null,
  note text,
  color text,
  text_color text,
  locator jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  tone text not null default '',
  system_prompt text not null default '',
  default_model text,
  visual_config jsonb not null default '{}'::jsonb,
  companion_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table if exists public.personas
  add column if not exists visual_config jsonb not null default '{}'::jsonb,
  add column if not exists companion_enabled boolean not null default true;

create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  persona_id uuid references public.personas(id) on delete set null,
  request_type text not null,
  provider text not null,
  model text not null,
  selected_text text,
  status text not null default 'ok',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists documents_owner_imported_idx on public.documents (owner_id, imported_at desc);
create index if not exists documents_owner_modified_idx on public.documents (owner_id, source_modified_at desc);
create index if not exists documents_owner_sort_idx on public.documents (owner_id, archived, sort_order asc, imported_at desc);
create index if not exists reading_sessions_owner_started_idx on public.reading_sessions (owner_id, started_at desc);
create index if not exists ai_requests_owner_created_idx on public.ai_requests (owner_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists set_notes_updated_at on public.notes;
create trigger set_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.documents enable row level security;
alter table public.document_tags enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.highlights enable row level security;
alter table public.notes enable row level security;
alter table public.personas enable row level security;
alter table public.ai_requests enable row level security;

drop policy if exists "user profiles owner access" on public.user_profiles;
create policy "user profiles owner access" on public.user_profiles
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "categories owner access" on public.categories;
create policy "categories owner access" on public.categories
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "tags owner access" on public.tags;
create policy "tags owner access" on public.tags
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "documents owner access" on public.documents;
create policy "documents owner access" on public.documents
for all using (
  auth.uid() = owner_id
  and (
    category_id is null
    or exists (
      select 1
      from public.categories
      where categories.id = documents.category_id
        and categories.owner_id = auth.uid()
    )
  )
) with check (
  auth.uid() = owner_id
  and (
    category_id is null
    or exists (
      select 1
      from public.categories
      where categories.id = documents.category_id
        and categories.owner_id = auth.uid()
    )
  )
);

drop policy if exists "document tags owner access" on public.document_tags;
create policy "document tags owner access" on public.document_tags
for all using (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = document_tags.document_id
      and documents.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.tags
    where tags.id = document_tags.tag_id
      and tags.owner_id = auth.uid()
  )
) with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = document_tags.document_id
      and documents.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.tags
    where tags.id = document_tags.tag_id
      and tags.owner_id = auth.uid()
  )
);

drop policy if exists "reading sessions owner access" on public.reading_sessions;
create policy "reading sessions owner access" on public.reading_sessions
for all using (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = reading_sessions.document_id
      and documents.owner_id = auth.uid()
  )
) with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = reading_sessions.document_id
      and documents.owner_id = auth.uid()
  )
);

drop policy if exists "highlights owner access" on public.highlights;
create policy "highlights owner access" on public.highlights
for all using (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = highlights.document_id
      and documents.owner_id = auth.uid()
  )
) with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = highlights.document_id
      and documents.owner_id = auth.uid()
  )
);

drop policy if exists "notes owner access" on public.notes;
create policy "notes owner access" on public.notes
for all using (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = notes.document_id
      and documents.owner_id = auth.uid()
  )
) with check (
  auth.uid() = owner_id
  and exists (
    select 1
    from public.documents
    where documents.id = notes.document_id
      and documents.owner_id = auth.uid()
  )
);

drop policy if exists "personas owner access" on public.personas;
create policy "personas owner access" on public.personas
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "ai requests owner access" on public.ai_requests;
create policy "ai requests owner access" on public.ai_requests
for all using (
  auth.uid() = owner_id
  and (
    document_id is null
    or exists (
      select 1
      from public.documents
      where documents.id = ai_requests.document_id
        and documents.owner_id = auth.uid()
    )
  )
  and (
    persona_id is null
    or exists (
      select 1
      from public.personas
      where personas.id = ai_requests.persona_id
        and personas.owner_id = auth.uid()
    )
  )
) with check (
  auth.uid() = owner_id
  and (
    document_id is null
    or exists (
      select 1
      from public.documents
      where documents.id = ai_requests.document_id
        and documents.owner_id = auth.uid()
    )
  )
  and (
    persona_id is null
    or exists (
      select 1
      from public.personas
      where personas.id = ai_requests.persona_id
        and personas.owner_id = auth.uid()
    )
  )
);

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'html-docs',
  'html-docs',
  false,
  52428800,
  array['text/html', 'application/octet-stream']
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

drop policy if exists "read own html docs" on storage.objects;
create policy "read own html docs" on storage.objects
for select using (
  bucket_id = 'html-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "insert own html docs" on storage.objects;
create policy "insert own html docs" on storage.objects
for insert with check (
  bucket_id = 'html-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "update own html docs" on storage.objects;
create policy "update own html docs" on storage.objects
for update using (
  bucket_id = 'html-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'html-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "delete own html docs" on storage.objects;
create policy "delete own html docs" on storage.objects
for delete using (
  bucket_id = 'html-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
