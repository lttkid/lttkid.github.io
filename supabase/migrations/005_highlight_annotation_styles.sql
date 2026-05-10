alter table public.highlights
  add column if not exists text_color text,
  add column if not exists locator jsonb;
