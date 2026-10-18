-- Tre livelli: amministratore (tutto) · responsabile flotta · tecnico
-- + email dei tecnici, PIN generato dal sistema per la scheda di installazione, analisi per l'amministratore

-- Ruoli dei responsabili ----------------------------------------------------------
alter table public.responsabili
  add column if not exists ruolo text not null default 'responsabile' check (ruolo in ('admin','responsabile')),
  add column if not exists attivo boolean not null default true,
  add column if not exists email text;
update public.responsabili r set email = u.email from auth.users u where u.id = r.user_id and r.email is null;
update public.responsabili set ruolo = 'admin' where user_id = 'eb979d9d-c2dc-407c-9904-85c7a2c5fd71';

create or replace function public.is_responsabile() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid() and r.attivo);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid() and r.attivo and r.ruolo = 'admin');
$$;

create or replace function public.richiedi_admin() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Accesso riservato all''amministratore' using errcode = '42501';
  end if;
end $$;

-- L'amministratore vede tutti i responsabili (il responsabile solo sé stesso)
create policy resp_admin_sel on public.responsabili for select to authenticated using ((select public.is_admin()));

-- Cambio ruolo / attivazione (non su sé stesso). La creazione account avviene nella funzione server.
create or replace function public.admin_imposta_responsabile(p_user uuid, p_ruolo text, p_attivo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if p_ruolo not in ('admin','responsabile') then raise exception 'Ruolo non valido'; end if;
  update public.responsabili set ruolo = p_ruolo, attivo = p_attivo where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
end $$;

-- Email dei tecnici (per inviare la scheda di installazione) ------------------------
alter table public.tecnici add column if not exists email text
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant select (email), insert (email), update (email) on public.tecnici to authenticated;

-- PIN generato dal sistema: restituito una sola volta, mai salvato in chiaro ----------
create or replace function public.genera_pin(p_tecnico bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare pin text; n int := 0;
begin
  perform public.richiedi_responsabile();
  if not exists (select 1 from public.tecnici where id = p_tecnico and attivo) then raise exception 'Tecnico non trovato o non attivo'; end if;
  loop
    n := n + 1;
    pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when (select count(distinct c) from regexp_split_to_table(pin, '') c) >= 3
          and position(pin in '01234567890') = 0 and position(pin in '09876543210') = 0;
    if n > 50 then raise exception 'Generazione PIN non riuscita, riprova'; end if;
  end loop;
  update public.tecnici set pin_hash = extensions.crypt(pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_tecnico;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_tecnico;
  return pin;
end $$;

-- Sicurezza: chiudere tutte le sessioni di un tecnico -----------------------------------
create or replace function public.admin_revoca_sessioni(p_tecnico bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.richiedi_admin();
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_tecnico and not revocata and scade_il > now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Analisi per l'amministratore -----------------------------------------------------------
create or replace function public.analisi_admin(p_mesi int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  mesi int := greatest(1, least(coalesce(p_mesi, 6), 24));
  fine date := (date_trunc('month', (now() at time zone 'Europe/Rome')) + interval '1 month')::date;
  da date := (date_trunc('month', (now() at time zone 'Europe/Rome')) - make_interval(months => mesi - 1))::date;
begin
  perform public.richiedi_admin();
  return jsonb_build_object(
    'da', da, 'a', fine - 1,
    'mesi', (select jsonb_agg(r order by r->>'mese') from (
      select jsonb_build_object(
        'mese', to_char(m, 'YYYY-MM'),
        'km', coalesce((select sum(greatest(mv.km - coalesce(mv.km_precedenti, mv.km), 0)) from public.movimenti mv
                        where mv.tipo <> 'rettifica' and (mv.creato_il at time zone 'Europe/Rome')::date >= m and (mv.creato_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date), 0),
        'segnalazioni', (select count(*) from public.segnalazioni s where (s.creato_il at time zone 'Europe/Rome')::date >= m and (s.creato_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'fermi', (select count(*) from public.segnalazioni s where s.gravita = 'fermo' and (s.creato_il at time zone 'Europe/Rome')::date >= m and (s.creato_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'chiuse', (select count(*) from public.segnalazioni s where (s.chiusa_il at time zone 'Europe/Rome')::date >= m and (s.chiusa_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'ore_chiusura', (select round((avg(extract(epoch from s.chiusa_il - s.creato_il)) / 3600)::numeric, 1) from public.segnalazioni s
                         where (s.chiusa_il at time zone 'Europe/Rome')::date >= m and (s.chiusa_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'carburante_eur', coalesce((select sum(f.importo) from public.rifornimenti f where f.data >= m and f.data < (m + interval '1 month')::date), 0),
        'litri', coalesce((select sum(f.litri) from public.rifornimenti f where f.data >= m and f.data < (m + interval '1 month')::date), 0),
        'multe', (select count(*) from public.multe x where (x.data_ora_infrazione at time zone 'Europe/Rome')::date >= m and (x.data_ora_infrazione at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'multe_eur', coalesce((select sum(x.importo) from public.multe x where (x.data_ora_infrazione at time zone 'Europe/Rome')::date >= m and (x.data_ora_infrazione at time zone 'Europe/Rome')::date < (m + interval '1 month')::date), 0),
        'piani_confermati', (select count(*) from public.piani p where p.data >= m and p.data < (m + interval '1 month')::date),
        'avvisi', (select count(*) from public.notifiche n where n.tipo = 'avviso' and (n.creato_il at time zone 'Europe/Rome')::date >= m and (n.creato_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date),
        'avvisi_letti', (select count(*) from public.notifiche n where n.tipo = 'avviso' and n.letta_il is not null and (n.creato_il at time zone 'Europe/Rome')::date >= m and (n.creato_il at time zone 'Europe/Rome')::date < (m + interval '1 month')::date)
      ) r
      from generate_series(da, fine - 1, interval '1 month') g(m0), lateral (select g.m0::date as m) mm) t),
    'veicoli', coalesce((select jsonb_agg(r order by (r->>'km')::numeric desc) from (
      select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello,
        'km', coalesce(sum(greatest(mv.km - coalesce(mv.km_precedenti, mv.km), 0)) filter (where mv.tipo <> 'rettifica'), 0),
        'giorni_uso', count(distinct (mv.creato_il at time zone 'Europe/Rome')::date),
        'segnalazioni', (select count(*) from public.segnalazioni s where s.veicolo_id = v.id and (s.creato_il at time zone 'Europe/Rome')::date >= da),
        'fermi', (select count(*) from public.segnalazioni s where s.veicolo_id = v.id and s.gravita = 'fermo' and (s.creato_il at time zone 'Europe/Rome')::date >= da),
        'carburante_eur', coalesce((select sum(f.importo) from public.rifornimenti f where f.veicolo_id = v.id and f.data >= da), 0),
        'multe', (select count(*) from public.multe x where x.veicolo_id = v.id and (x.data_ora_infrazione at time zone 'Europe/Rome')::date >= da)) r
      from public.veicoli v left join public.movimenti mv on mv.veicolo_id = v.id and (mv.creato_il at time zone 'Europe/Rome')::date >= da
      where not v.dismesso group by v.id) t), '[]'),
    'tecnici', coalesce((select jsonb_agg(r order by r->>'nome') from (
      select jsonb_build_object('id', tc.id, 'nome', tc.nome || ' ' || tc.cognome, 'codice', tc.codice,
        'km', coalesce((select sum(greatest(mv.km - coalesce(mv.km_precedenti, mv.km), 0)) from public.movimenti mv where mv.tecnico_id = tc.id and mv.tipo <> 'rettifica' and (mv.creato_il at time zone 'Europe/Rome')::date >= da), 0),
        'prese', (select count(*) from public.movimenti mv where mv.tecnico_id = tc.id and mv.tipo = 'presa' and (mv.creato_il at time zone 'Europe/Rome')::date >= da),
        'segnalazioni', (select count(*) from public.segnalazioni s where s.tecnico_id = tc.id and (s.creato_il at time zone 'Europe/Rome')::date >= da),
        'avvisi', (select count(*) from public.notifiche n where n.tecnico_id = tc.id and n.tipo = 'avviso' and (n.creato_il at time zone 'Europe/Rome')::date >= da),
        'avvisi_letti', (select count(*) from public.notifiche n where n.tecnico_id = tc.id and n.tipo = 'avviso' and n.letta_il is not null and (n.creato_il at time zone 'Europe/Rome')::date >= da),
        'minuti_lettura', (select round((percentile_cont(0.5) within group (order by extract(epoch from n.letta_il - n.creato_il)) / 60)::numeric, 0)
                           from public.notifiche n where n.tecnico_id = tc.id and n.letta_il is not null and n.tipo in ('avviso','piano') and (n.creato_il at time zone 'Europe/Rome')::date >= da),
        'multe', (select count(*) from public.multe x where x.tecnico_id = tc.id and (x.data_ora_infrazione at time zone 'Europe/Rome')::date >= da),
        'ultimo_accesso', (select max(se.creato_il) from public.sessioni_tecnico se where se.tecnico_id = tc.id),
        'sessioni_attive', (select count(*) from public.sessioni_tecnico se where se.tecnico_id = tc.id and not se.revocata and se.scade_il > now()),
        'dispositivi', (select count(*) from public.push_iscrizioni p where p.tecnico_id = tc.id),
        'bloccato', tc.bloccato_fino is not null and tc.bloccato_fino > now(),
        'ha_pin', tc.pin_hash is not null) r
      from public.tecnici tc where tc.attivo) t), '[]'),
    'categorie', coalesce((select jsonb_object_agg(categoria, n) from (
      select s.categoria, count(*) n from public.segnalazioni s where (s.creato_il at time zone 'Europe/Rome')::date >= da group by 1) t), '{}'),
    'sistema', jsonb_build_object(
      'veicoli', (select count(*) from public.veicoli where not dismesso),
      'tecnici', (select count(*) from public.tecnici where attivo),
      'senza_pin', (select count(*) from public.tecnici where attivo and pin_hash is null),
      'bloccati', (select count(*) from public.tecnici where attivo and bloccato_fino > now()),
      'sessioni_attive', (select count(*) from public.sessioni_tecnico where not revocata and scade_il > now()),
      'dispositivi_push', (select count(*) from public.push_iscrizioni),
      'responsabili', (select count(*) from public.responsabili where attivo),
      'segnalazioni_aperte', (select count(*) from public.segnalazioni where stato <> 'chiusa'),
      'modifiche_30gg', (select count(*) from public.audit_log where creato_il > now() - interval '30 days'))
  );
end $$;

-- Solo italiano per tecnici: le notifiche push ai tecnici sono in italiano
update public.push_iscrizioni set lingua = 'it' where tecnico_id is not null;

-- Permessi ---------------------------------------------------------------------------------
revoke execute on function public.is_admin(), public.richiedi_admin(), public.admin_imposta_responsabile(uuid, text, boolean),
  public.genera_pin(bigint), public.admin_revoca_sessioni(bigint), public.analisi_admin(int) from public, anon;
grant execute on function public.is_admin(), public.richiedi_admin(), public.admin_imposta_responsabile(uuid, text, boolean),
  public.genera_pin(bigint), public.admin_revoca_sessioni(bigint), public.analisi_admin(int) to authenticated;
grant execute on function public.is_admin() to service_role;
