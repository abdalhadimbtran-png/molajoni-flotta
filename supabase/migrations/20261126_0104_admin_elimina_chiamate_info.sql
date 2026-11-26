-- 0103 — Eliminazione definitiva di contatti informativi (centralino_chiamate_info, i «+1» della pagina Oggi)
-- da parte dell'ADMIN. Solo is_admin(). Max 200 id. Nessun trigger sulla tabella (verificato 26/11/2026):
-- nessun bypass privato.azzera necessario. Una riga audit_log per elemento con istantanea + motivo.
create or replace function public.admin_elimina_chiamate_info(p_ids bigint[], p_motivo text default 'Prova')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ids bigint[];
  v_n int;
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'Prova');
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata all''amministratore' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) x where x is not null;
  if v_ids is null then return jsonb_build_object('eliminate', 0); end if;
  if cardinality(v_ids) > 200 then
    raise exception 'Massimo 200 elementi per volta' using errcode = '22023';
  end if;

  perform 1 from public.centralino_chiamate_info where id = any(v_ids) for update;

  insert into public.audit_log (tabella, record_id, azione, prima, dopo, utente)
  select 'centralino_chiamate_info', c.id::text, 'ELIMINA',
         jsonb_build_object('at', c.at, 'canale', c.canale, 'nota', c.nota, 'autore_nome', c.autore_nome, 'categoria', c.categoria),
         jsonb_build_object('motivo', v_motivo),
         auth.uid()
  from public.centralino_chiamate_info c where c.id = any(v_ids);

  delete from public.centralino_chiamate_info where id = any(v_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('eliminate', v_n);
end $$;

revoke all on function public.admin_elimina_chiamate_info(bigint[], text) from public, anon;
grant execute on function public.admin_elimina_chiamate_info(bigint[], text) to authenticated;
