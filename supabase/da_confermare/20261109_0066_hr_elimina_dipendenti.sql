-- Eliminazione sicura dei dipendenti (HR + admin).
-- Senza storico: cancellazione definitiva (sessioni, notifiche, push eliminate; sigle scollegate).
-- Con storico: archiviazione (attivo=false, fine rapporto oggi se vuota, PIN annullato, sessioni revocate).

create table if not exists public.hr_eliminazioni_log (
  id bigint generated always as identity primary key,
  creato_il timestamptz not null default now(),
  utente uuid default auth.uid(),
  azione text not null check (azione in ('elimina', 'ripristina')),
  ids bigint[] not null,
  motivo text,
  esito jsonb not null
);
alter table public.hr_eliminazioni_log enable row level security;
drop policy if exists hr_eliminazioni_log_sel on public.hr_eliminazioni_log;
create policy hr_eliminazioni_log_sel on public.hr_eliminazioni_log for select to authenticated using (public.is_hr());
revoke all on public.hr_eliminazioni_log from anon;

-- Tabelle che NON contano come storico (si puliscono in caso di cancellazione).
create or replace function public.hr_tabelle_pulizia() returns text[] language sql immutable as $$
  select array['sessioni_tecnico','notifiche','push_iscrizioni','tecnici_sigle']::text[];
$$;

-- Conteggio dello storico collegato: scorre tutte le FK verso dipendenti (anche future).
create or replace function public.hr_storico_dipendente(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; n bigint; out jsonb := '{}'::jsonb;
begin
  for r in
    select c.conrelid::regclass::text as t, cl.relname as nome, a.attname as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.dipendenti'::regclass
      and cl.relname <> all (public.hr_tabelle_pulizia())
  loop
    execute format('select count(*) from %s where %I = $1', r.t, r.col) into n using p_id;
    if n > 0 then out := out || jsonb_build_object(r.nome, coalesce((out->>r.nome)::bigint, 0) + n); end if;
  end loop;
  return out;
end $$;
revoke all on function public.hr_storico_dipendente(bigint) from public, anon, authenticated;

create or replace function public.hr_testo_storico(s jsonb) returns text language sql immutable as $$
  select string_agg(format('%s %s', value, replace(key, '_', ' ')), ', ' order by value::bigint desc)
  from jsonb_each_text(s);
$$;

create or replace function public.hr_anteprima_eliminazione(p_ids bigint[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d record; s jsonb; out jsonb := '[]'::jsonb;
begin
  if not public.is_hr() then raise exception 'Solo HR o amministratore' using errcode = '42501'; end if;
  for d in select id, nome, cognome, codice from public.dipendenti where id = any (p_ids) order by cognome, nome loop
    s := public.hr_storico_dipendente(d.id);
    out := out || jsonb_build_array(jsonb_build_object('id', d.id, 'nome', d.nome || ' ' || d.cognome, 'codice', d.codice,
      'esito', case when s = '{}'::jsonb then 'eliminato' else 'archiviato' end,
      'storico', s, 'motivo', case when s = '{}'::jsonb then 'nessuno storico collegato' else 'ha ' || public.hr_testo_storico(s) end));
  end loop;
  return out;
end $$;

create or replace function public.hr_elimina_dipendenti(p_ids bigint[], p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; e jsonb; out jsonb := '[]'::jsonb; v bigint;
begin
  if not public.is_hr() then raise exception 'Solo HR o amministratore' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica il motivo'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Nessun dipendente selezionato'; end if;
  perform 1 from public.dipendenti where id = any (p_ids) for update;
  a := public.hr_anteprima_eliminazione(p_ids);
  for e in select * from jsonb_array_elements(a) loop
    v := (e->>'id')::bigint;
    if e->>'esito' = 'eliminato' then
      delete from public.sessioni_tecnico where tecnico_id = v;
      delete from public.notifiche where tecnico_id = v;
      delete from public.push_iscrizioni where tecnico_id = v;
      update public.tecnici_sigle set dipendente_id = null where dipendente_id = v;
      delete from public.dipendenti where id = v;
    else
      update public.dipendenti set attivo = false, pin_hash = null,
        data_cessazione = coalesce(data_cessazione, current_date) where id = v;
      update public.sessioni_tecnico set revocata = true where tecnico_id = v and not revocata;
    end if;
    out := out || jsonb_build_array(e - 'storico');
  end loop;
  insert into public.hr_eliminazioni_log (azione, ids, motivo, esito) values ('elimina', p_ids, trim(p_motivo), out);
  return out;
end $$;

create or replace function public.hr_ripristina_dipendente(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_hr() then raise exception 'Solo HR o amministratore' using errcode = '42501'; end if;
  update public.dipendenti set attivo = true, data_cessazione = null where id = p_id and not attivo;
  if not found then raise exception 'Dipendente non trovato o già attivo'; end if;
  insert into public.hr_eliminazioni_log (azione, ids, motivo, esito)
  values ('ripristina', array[p_id], null, jsonb_build_array(jsonb_build_object('id', p_id, 'esito', 'ripristinato')));
end $$;

revoke all on function public.hr_anteprima_eliminazione(bigint[]) from public, anon;
revoke all on function public.hr_elimina_dipendenti(bigint[], text) from public, anon;
revoke all on function public.hr_ripristina_dipendente(bigint) from public, anon;
grant execute on function public.hr_anteprima_eliminazione(bigint[]) to authenticated;
grant execute on function public.hr_elimina_dipendenti(bigint[], text) to authenticated;
grant execute on function public.hr_ripristina_dipendente(bigint) to authenticated;

-- TEST (rollback): eseguire come blocco unico; nessuna modifica resta.
-- begin;
--   insert into public.dipendenti(codice,nome,cognome,categoria) values ('ZZTEST1','Prova','Senza','UFFICIO'),('ZZTEST2','Prova','Con','TEC');
--   insert into public.interventi(tecnico_id) select id from public.dipendenti where codice='ZZTEST2'; -- adattare colonne obbligatorie
--   select set_config('request.jwt.claims', json_build_object('sub',(select user_id from public.responsabili where ruolo='admin' and attivo limit 1))::text, true);
--   set local role authenticated;
--   select public.hr_elimina_dipendenti((select array_agg(id) from public.dipendenti where codice like 'ZZTEST%'), 'Dato di prova');
--   -- atteso: ZZTEST1 eliminato, ZZTEST2 archiviato ("ha 1 interventi")
--   reset role; set local role anon; select public.hr_elimina_dipendenti(array[1]::bigint[],'x'); -- atteso: permission denied
-- rollback;
