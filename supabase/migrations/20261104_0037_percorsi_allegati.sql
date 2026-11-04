-- 0037 Allegati delle tappe dei percorsi: bucket privato 'percorsi-allegati'. Non distruttiva.
-- I percorsi salvano in stops[].allegati i path (con nome, tipo, size); la rimozione è logica (rimosso=true), il file resta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('percorsi-allegati', 'percorsi-allegati', false, 10485760, array[
    'image/jpeg','image/png','image/heic','image/heif','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "responsabile legge allegati percorsi" on storage.objects for select to authenticated
  using (bucket_id = 'percorsi-allegati' and (select public.is_responsabile()));
create policy "responsabile carica allegati percorsi" on storage.objects for insert to authenticated
  with check (bucket_id = 'percorsi-allegati' and (select public.is_responsabile()));
-- nessuna policy di update/delete: i file restano (rimozione solo logica nel percorso)
