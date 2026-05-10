alter table public.ai_user_providers
add column if not exists enabled boolean not null default true;
