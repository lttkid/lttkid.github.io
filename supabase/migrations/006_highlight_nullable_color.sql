alter table public.highlights
  alter column color drop default,
  alter column color drop not null;

update public.highlights
set note = null
where btrim(coalesce(note, '')) = '';
