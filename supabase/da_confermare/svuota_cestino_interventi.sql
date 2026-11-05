-- Da applicare con conferma (contiene DELETE): cancellazione definitiva del cestino interventi, solo amministratore.
-- Svuota cestino (solo amministratore): cancella davvero gli eliminati (tutti o più vecchi di p_giorni).
create or replace function public.svuota_cestino(p_giorni int default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; m int;
begin
  if not public.is_admin() then raise exception 'Solo l''amministratore può svuotare il cestino'; end if;
  update public.urgenze u set importato_id = null
   where u.importato_id in (select id from public.interventi_importati where eliminato_at is not null and eliminato_at <= now() - make_interval(days => greatest(p_giorni, 0)));
  delete from public.interventi_importati where eliminato_at is not null and eliminato_at <= now() - make_interval(days => greatest(p_giorni, 0));
  get diagnostics n = row_count;
  delete from public.importazioni m where m.eliminato_at is not null
     and not exists (select 1 from public.interventi_importati i where i.importazione_id = m.id);
  get diagnostics m = row_count;
  insert into public.interventi_cestino_log (azione, n, dettagli) values ('svuota_cestino', n, jsonb_build_object('importazioni', m, 'giorni', p_giorni));
  return jsonb_build_object('interventi', n, 'importazioni', m);
end $$;

revoke execute on function public.svuota_cestino(int) from public, anon;
grant execute on function public.svuota_cestino(int) to authenticated;
