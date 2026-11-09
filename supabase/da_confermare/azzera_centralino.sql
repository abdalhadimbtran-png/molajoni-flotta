-- 0063 Centralino: azzeramento dati di prova (solo admin) + registro azioni
create table if not exists public.centralino_azzeramenti (
  id bigint generated always as identity primary key,
  autore uuid default auth.uid(), autore_nome text, at timestamptz not null default now(),
  fino_a timestamptz, contatti boolean not null default false, conteggi jsonb not null
);
alter table public.centralino_azzeramenti enable row level security;
drop policy if exists azzeramenti_leggi on public.centralino_azzeramenti;
create policy azzeramenti_leggi on public.centralino_azzeramenti for select to authenticated using (public.is_admin());
revoke all on public.centralino_azzeramenti from anon;

-- storia solo in aggiunta: DELETE ammesso solo dentro admin_centralino_azzera
create or replace function privato.tg_solo_aggiunta() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' and current_setting('privato.azzera', true) = 'on' then return old; end if;
  raise exception 'La storia della pratica non si modifica e non si cancella' using errcode = '42501';
end $$;

create or replace function privato.ct_azzera_set(p_fino_a timestamptz, p_contatti boolean)
returns table(pratiche bigint[], contatti bigint[]) language sql stable security definer set search_path to '' as $$
  select (select coalesce(array_agg(id), '{}') from public.pratiche where p_fino_a is null or created_at < p_fino_a),
         (select coalesce(array_agg(id), '{}') from public.clienti_contatti where p_contatti and fonte = 'centralino' and (p_fino_a is null or created_at < p_fino_a));
$$;
revoke all on function privato.ct_azzera_set(timestamptz, boolean) from public, anon, authenticated;

create or replace function public.admin_centralino_conteggi(p_fino_a timestamptz default null, p_contatti boolean default false)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare pr bigint[]; co bigint[];
begin
  if not public.is_admin() then raise exception 'Solo amministratore' using errcode = '42501'; end if;
  select s.pratiche, s.contatti into pr, co from privato.ct_azzera_set(p_fino_a, p_contatti) s;
  return jsonb_build_object(
    'pratiche', cardinality(pr),
    'pratiche_eventi', (select count(*) from public.pratiche_eventi where pratica_id = any(pr)),
    'pratiche_allegati', (select count(*) from public.pratiche_allegati where pratica_id = any(pr)),
    'allegati_path', (select coalesce(jsonb_agg(path), '[]') from public.pratiche_allegati where pratica_id = any(pr)),
    'chiamate_trasferite', (select count(*) from public.chiamate_trasferite where pratica_id = any(pr) or (pratica_id is null and (p_fino_a is null or at < p_fino_a))),
    'appunti', (select count(*) from public.appunti where (chiave = 'bozza' and p_fino_a is null) or chiave = any(select 'p:' || x from unnest(pr) x)),
    'email_in_uscita', (select count(*) from public.email_in_uscita where pratica_id = any(pr) or (dati->>'categoria' = 'centralino' and (p_fino_a is null or creato_il < p_fino_a))),
    'notifiche', (select count(*) from public.notifiche where dati->>'categoria' = 'centralino' and (p_fino_a is null or creato_il < p_fino_a)),
    'chiamate_info', (select count(*) from public.centralino_chiamate_info where p_fino_a is null or at < p_fino_a),
    'clienti_contatti', cardinality(co),
    'clienti_contatti_storia', (select count(*) from public.clienti_contatti_storia where contatto_id = any(co) or pratica_id = any(pr)),
    'contatori_azzerati', p_fino_a is null);
end $$;

create or replace function public.admin_centralino_azzera(p_fino_a timestamptz default null, p_contatti boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare pr bigint[]; co bigint[]; c jsonb; n bigint;
begin
  if not public.is_admin() then raise exception 'Solo amministratore' using errcode = '42501'; end if;
  c := public.admin_centralino_conteggi(p_fino_a, p_contatti) - 'allegati_path';
  select s.pratiche, s.contatti into pr, co from privato.ct_azzera_set(p_fino_a, p_contatti) s;
  perform set_config('privato.azzera', 'on', true);
  delete from public.clienti_contatti_storia where contatto_id = any(co) or pratica_id = any(pr);
  delete from public.clienti_contatti where id = any(co);
  delete from public.pratiche_eventi where pratica_id = any(pr);
  delete from public.pratiche_allegati where pratica_id = any(pr);
  delete from public.chiamate_trasferite where pratica_id = any(pr) or (pratica_id is null and (p_fino_a is null or at < p_fino_a));
  delete from public.appunti where (chiave = 'bozza' and p_fino_a is null) or chiave = any(select 'p:' || x from unnest(pr) x);
  delete from public.email_in_uscita where pratica_id = any(pr) or (dati->>'categoria' = 'centralino' and (p_fino_a is null or creato_il < p_fino_a));
  delete from public.notifiche where dati->>'categoria' = 'centralino' and (p_fino_a is null or creato_il < p_fino_a);
  delete from public.centralino_chiamate_info where p_fino_a is null or at < p_fino_a;
  delete from public.pratiche where id = any(pr);
  if p_fino_a is null then delete from privato.pratiche_contatori; end if;
  perform set_config('privato.azzera', 'off', true);
  insert into public.centralino_azzeramenti(autore_nome, fino_a, contatti, conteggi)
    values ((select coalesce(raw_user_meta_data->>'nome', email) from auth.users where id = auth.uid()), p_fino_a, p_contatti, c);
  return c;
end $$;

revoke all on function public.admin_centralino_conteggi(timestamptz, boolean) from public, anon;
revoke all on function public.admin_centralino_azzera(timestamptz, boolean) from public, anon;
grant execute on function public.admin_centralino_conteggi(timestamptz, boolean) to authenticated;
grant execute on function public.admin_centralino_azzera(timestamptz, boolean) to authenticated;

-- admin può cancellare i file del bucket pratiche (prima dell'azzeramento)
drop policy if exists pratiche_file_admin_cancella on storage.objects;
create policy pratiche_file_admin_cancella on storage.objects for delete to authenticated using (bucket_id = 'pratiche' and public.is_admin());
