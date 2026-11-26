-- 0101 — Eliminazione definitiva di pratiche (prove) da parte dell'ADMIN.
-- Solo is_admin(): mai centralino, mai direzione. Max 200 id per chiamata.
-- Cancella: pratiche_eventi (bypass solo-aggiunta con privato.azzera), appunti 'p:'||id,
-- pratiche_offerta (cascade), chiamate_trasferite, pratiche_allegati (path restituiti al client
-- per togliere i file dal bucket «pratiche»). clienti_contatti_storia.pratica_id e
-- email_in_uscita.pratica_id → null (la storia resta). pratiche_contatori NON toccato (numeri mai riusati).
-- Una riga audit_log per pratica con istantanea + motivo.

create or replace function public.admin_elimina_pratiche(p_ids bigint[], p_motivo text default 'Prova')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ids bigint[];
  v_paths text[];
  v_n int;
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'Prova');
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata all''amministratore' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) x where x is not null;
  if v_ids is null then return jsonb_build_object('eliminate', 0, 'numeri', '[]'::jsonb, 'paths', '[]'::jsonb); end if;
  if cardinality(v_ids) > 200 then
    raise exception 'Massimo 200 pratiche per volta' using errcode = '22023';
  end if;

  -- blocca le righe (e tiene solo gli id esistenti)
  perform 1 from public.pratiche where id = any(v_ids) for update;
  select array_agg(id order by id) into v_ids from public.pratiche where id = any(v_ids);
  if v_ids is null then return jsonb_build_object('eliminate', 0, 'numeri', '[]'::jsonb, 'paths', '[]'::jsonb); end if;

  insert into public.audit_log (tabella, record_id, azione, prima, dopo, utente)
  select 'pratiche', p.id::text, 'ELIMINA',
         jsonb_build_object('numero', p.numero, 'cliente', p.cliente_nome, 'cliente_codice', p.cliente_codice,
                            'tipo', p.tipo, 'esito', p.esito, 'created_at', p.created_at,
                            'eventi', (select count(*) from public.pratiche_eventi e where e.pratica_id = p.id)),
         jsonb_build_object('motivo', v_motivo),
         auth.uid()
  from public.pratiche p where p.id = any(v_ids);

  select coalesce(array_agg(a.path), '{}') into v_paths from public.pratiche_allegati a where a.pratica_id = any(v_ids);

  perform set_config('privato.azzera', 'on', true);
  delete from public.pratiche_eventi where pratica_id = any(v_ids);
  perform set_config('privato.azzera', 'off', true);

  delete from public.appunti where chiave = any(select 'p:' || x from unnest(v_ids) x);
  delete from public.chiamate_trasferite where pratica_id = any(v_ids);
  delete from public.pratiche_allegati where pratica_id = any(v_ids);
  update public.clienti_contatti_storia set pratica_id = null where pratica_id = any(v_ids);
  update public.email_in_uscita set pratica_id = null where pratica_id = any(v_ids);

  delete from public.pratiche where id = any(v_ids);
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'eliminate', v_n,
    'numeri', (select coalesce(jsonb_agg(a.prima->>'numero'), '[]'::jsonb) from public.audit_log a
               where a.tabella = 'pratiche' and a.azione = 'ELIMINA' and a.record_id = any(select x::text from unnest(v_ids) x)
                 and a.creato_il = now()),
    'paths', to_jsonb(v_paths));
end $$;

revoke all on function public.admin_elimina_pratiche(bigint[], text) from public, anon;
grant execute on function public.admin_elimina_pratiche(bigint[], text) to authenticated;
