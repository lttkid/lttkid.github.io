create table if not exists public.ai_feature_bindings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  feature_id text not null,
  profile_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_feature_bindings_feature_check check (
    feature_id in ('summarize', 'explain', 'generate_html', 'image_question', 'persona_chat')
  ),
  constraint ai_feature_bindings_owner_feature_unique unique (owner_id, feature_id)
);

create index if not exists ai_feature_bindings_owner_idx on public.ai_feature_bindings (owner_id);

drop trigger if exists set_ai_feature_bindings_updated_at on public.ai_feature_bindings;
create trigger set_ai_feature_bindings_updated_at
before update on public.ai_feature_bindings
for each row execute function public.set_updated_at();

alter table public.ai_feature_bindings enable row level security;

drop policy if exists "ai feature bindings owner access" on public.ai_feature_bindings;
create policy "ai feature bindings owner access" on public.ai_feature_bindings
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
