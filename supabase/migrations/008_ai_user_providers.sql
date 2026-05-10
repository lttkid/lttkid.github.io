create table if not exists public.ai_user_providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  provider text not null default 'openai-compatible',
  base_url text not null,
  base_url_host text not null,
  model text not null,
  api_key_ciphertext text not null,
  api_key_iv text not null,
  api_key_hint text,
  supports_vision boolean not null default false,
  supports_html_generation boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_user_providers_label_length check (char_length(trim(label)) between 1 and 80),
  constraint ai_user_providers_provider_length check (char_length(trim(provider)) between 1 and 80),
  constraint ai_user_providers_model_length check (char_length(trim(model)) between 1 and 160),
  constraint ai_user_providers_base_url_length check (char_length(trim(base_url)) between 8 and 400)
);

create index if not exists ai_user_providers_owner_idx on public.ai_user_providers (owner_id, updated_at desc);

drop trigger if exists set_ai_user_providers_updated_at on public.ai_user_providers;
create trigger set_ai_user_providers_updated_at
before update on public.ai_user_providers
for each row execute function public.set_updated_at();

alter table public.ai_user_providers enable row level security;

drop policy if exists "ai user providers owner access" on public.ai_user_providers;
create policy "ai user providers owner access" on public.ai_user_providers
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
