alter table if exists public.personas
  add column if not exists visual_config jsonb not null default '{}'::jsonb,
  add column if not exists companion_enabled boolean not null default true;
