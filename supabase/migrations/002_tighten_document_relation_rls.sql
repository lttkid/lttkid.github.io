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
