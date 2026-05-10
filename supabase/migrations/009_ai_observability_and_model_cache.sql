alter table public.ai_requests
  add column if not exists feature_id text,
  add column if not exists profile_id text,
  add column if not exists provider_id text,
  add column if not exists profile_source text,
  add column if not exists used_model text,
  add column if not exists error_code text,
  add column if not exists latency_ms integer;

create index if not exists ai_requests_owner_feature_created_idx
  on public.ai_requests (owner_id, feature_id, created_at desc);

alter table public.ai_feature_bindings
  add column if not exists validation_status text not null default 'unknown',
  add column if not exists validated_at timestamptz,
  add column if not exists validated_model text,
  add column if not exists validation_error text;

create table if not exists public.ai_model_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  provider text not null,
  base_url_host text not null,
  models jsonb not null default '[]'::jsonb,
  error_message text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  constraint ai_model_cache_owner_key_unique unique (owner_id, cache_key)
);

create index if not exists ai_model_cache_owner_expires_idx
  on public.ai_model_cache (owner_id, expires_at desc);

alter table public.ai_model_cache enable row level security;

drop policy if exists "ai model cache owner access" on public.ai_model_cache;
create policy "ai model cache owner access" on public.ai_model_cache
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
