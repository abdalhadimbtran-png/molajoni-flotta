-- =====================================================================
-- Portale unico · Fasi 2-4 — FERIE E PERMESSI · 3/5: accesso per tutti e funzioni API
--
--  A. Decisioni del cliente (20/10/2026):
--     1. solo HR e admin creano/modificano i dipendenti (anche i TEC): la policy del
--        responsabile flotta su `dipendenti` diventa di SOLA LETTURA per i TEC;
--     2. un account HR può essere collegato al proprio record dipendente
--        (responsabili.dipendente_id): l'auto-decisione è permessa ma registrata
--        (richieste_assenza.auto_decisione) e segnalata agli admin;
--     3. tutti i tipi di assenza esistono; HR decide quali sono attivi (tipi_assenza.attivo).
--  B. Accesso codice + PIN per TUTTE le categorie: dipendente_login (la risposta contiene la
--     categoria). Le funzioni tecnico_* restano solo TEC (usano la vista `tecnici`).
--  C. Funzioni del dipendente (token): dipendente_*.
--  D. Funzioni HR (is_hr): hr_*.
-- Tutte SECURITY DEFINER con search_path vuoto; i controlli interni sono nello schema privato.
-- =====================================================================

-- A. Decisioni del cliente ------------------------------------------------------------------
alter policy dip_resp_tecnici on public.dipendenti
  using ((select public.is_responsabile()) and categoria = 'TEC')
  with check (false);
comment on policy dip_resp_tecnici on public.dipendenti is 'Responsabile flotta: sola lettura dei TEC (dal 20/10/2026 crea/modifica solo HR o admin).';

alter table public.responsabili
  add column dipendente_id bigint unique references public.dipendenti(id);
comment on column public.responsabili.dipendente_id is 'Record dipendente della persona che usa questo account (es. Roberta HR): serve a riconoscere le auto-decisioni.';

alter table public.richieste_assenza
  add column auto_decisione boolean not null default false;
comment on column public.richieste_assenza.auto_decisione is 'true se la richiesta è stata decisa, inserita o annullata dall''account HR collegato allo stesso dipendente.';

-- utilità interne ------------------------------------------------------------------------------
create or replace function privato.dipendente_da_token(p_token text) returns bigint
language plpgsql stable set search_path = '' as $$
declare did bigint;
begin
  select s.tecnico_id into did
    from public.sessioni_tecnico s join public.dipendenti d on d.id = s.tecnico_id
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.scade_il > now() and not s.revocata and d.attivo;
  if did is null then raise exception 'SESSIONE_NON_VALIDA'; end if;
  return did;
end $$;

create or replace function privato.controlla_pin(p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then raise exception 'Il PIN deve avere 6 cifre'; end if;
  if (select count(distinct c) from regexp_split_to_table(p_pin, '') c) <= 2
     or position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then
    raise exception 'PIN troppo facile da indovinare: evita cifre ripetute o in sequenza';
  end if;
end $$;

-- account HR collegato al dipendente? (auto-decisione)
create or replace function privato.e_auto(p_dip bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid() and r.dipendente_id = p_dip);
$$;

create or replace function privato.nome_account(p_user uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select r.nome from public.responsabili r where r.user_id = p_user), case when p_user is not null then 'Account HR' end);
$$;

-- Rappresentazione JSON di una richiesta (p_hr = campi in più per l'ufficio personale)
create or replace function privato.richiesta_json(r public.richieste_assenza, p_hr boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'numero', r.numero, 'tipo', r.tipo, 'tipo_descrizione', t.descrizione, 'unita', r.unita,
    'primo_giorno', r.primo_giorno, 'ultimo_giorno', r.ultimo_giorno, 'rientro', r.ultimo_giorno + 1,
    'ora_inizio', to_char(r.ora_inizio, 'HH24:MI'), 'ora_fine', to_char(r.ora_fine, 'HH24:MI'),
    'mezza_giornata', r.mezza_giornata, 'quantita', r.quantita, 'giorni_lavorativi', r.giorni_lavorativi,
    'note', r.note, 'stato', r.stato, 'saldo_insufficiente', r.saldo_insufficiente, 'avvisi', r.avvisi,
    'motivo_decisione', r.motivo_decisione, 'deciso_il', r.deciso_il,
    'motivo_annullamento', r.motivo_annullamento, 'annullata_da', r.annullata_da, 'annullata_il', r.annullata_il,
    'creata_da', r.creata_da, 'creato_il', r.creato_il, 'annullabile', r.stato = 'in_attesa',
    'per_anno', (select coalesce(jsonb_agg(jsonb_build_object('anno', a, 'quantita', q) order by a), '[]')
                   from (select extract(year from g.giorno)::int a, sum(g.quantita) q
                           from public.richieste_assenza_giorni g where g.richiesta_id = r.id group by 1) y))
  || case when p_hr then jsonb_build_object(
       'dipendente_id', r.dipendente_id,
       'dipendente', (select jsonb_build_object('id', d.id, 'nome', d.nome || ' ' || d.cognome, 'codice', d.codice,
                              'categoria', d.categoria, 'reparto', d.reparto) from public.dipendenti d where d.id = r.dipendente_id),
       'deciso_da', privato.nome_account(r.deciso_da), 'creata_da_utente', privato.nome_account(r.creata_da_utente),
       'annullata_da_utente', privato.nome_account(r.annullata_da_utente),
       'auto_decisione', r.auto_decisione,
       'annullabile', r.stato in ('in_attesa', 'approvata'))
     else '{}'::jsonb end
  from public.tipi_assenza t where t.codice = r.tipo;
$$;

-- Saldi di un dipendente per tutti i tipi attivi con saldo
create or replace function privato.saldi_dipendente(p_dip bigint, p_anno int, p_alla date) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(privato.saldo(p_dip, p_anno, t.codice, p_alla) order by t.ordine), '[]')
    from public.tipi_assenza t where t.con_saldo and t.attivo;
$$;

-- Impatto di una richiesta giorno per giorno (per la decisione HR)
create or replace function privato.impatto(p_id bigint) returns jsonb
language sql stable set search_path = '' as $$
  with r as (select x.*, d.categoria, d.reparto from public.richieste_assenza x join public.dipendenti d on d.id = x.dipendente_id where x.id = p_id),
  tec as (select t.id from public.dipendenti t where t.categoria = 'TEC' and t.attivo)
  select jsonb_build_object(
    'tec', (select categoria = 'TEC' from r),
    'interventi_totali', (select count(*) from public.interventi i, r where i.tecnico_id = r.dipendente_id
                            and i.data in (select g.giorno from public.richieste_assenza_giorni g where g.richiesta_id = p_id)),
    'giorni', coalesce((select jsonb_agg(jsonb_build_object(
        'giorno', g.giorno, 'quantita', g.quantita, 'frazione', g.frazione,
        'tec_attivi', (select count(*) from tec),
        'tec_assenti', (select count(distinct a.tecnico_id) from public.assenze a join tec on tec.id = a.tecnico_id, r
                         where g.giorno between a.dal and a.al and a.tecnico_id <> r.dipendente_id),
        'tec_in_attesa', (select count(distinct a.dipendente_id) from public.assenze_da_richieste a join tec on tec.id = a.dipendente_id, r
                           where a.attiva and a.tipo_riga = 'possibile' and g.giorno between a.dal and a.al and a.dipendente_id <> r.dipendente_id
                             and a.richiesta_id <> p_id),
        'tec_disponibili', (select count(*) from tec, r where tec.id <> r.dipendente_id
                              and not exists (select 1 from public.assenze a where a.tecnico_id = tec.id and g.giorno between a.dal and a.al)),
        'interventi', coalesce((select jsonb_agg(jsonb_build_object('ora', to_char(i.ora, 'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita)
                                                 order by i.ora nulls last, i.id)
                                  from public.interventi i, r where i.tecnico_id = r.dipendente_id and i.data = g.giorno), '[]'),
        'colleghi_assenti', coalesce((select jsonb_agg(distinct c.nome || ' ' || c.cognome)
                                        from public.dipendenti c, r
                                       where c.attivo and c.id <> r.dipendente_id and c.categoria = r.categoria
                                         and (r.reparto is null or c.reparto is not distinct from r.reparto)
                                         and (exists (select 1 from public.assenze a where a.tecnico_id = c.id and g.giorno between a.dal and a.al)
                                              or exists (select 1 from public.assenze_da_richieste a where a.dipendente_id = c.id and a.attiva
                                                           and g.giorno between a.dal and a.al))), '[]'))
      order by g.giorno)
      from public.richieste_assenza_giorni g where g.richiesta_id = p_id), '[]'));
$$;

-- B. Accesso per tutti i dipendenti ----------------------------------------------------------
-- Stesse regole di tecnico_login: 5 errori = blocco 15 minuti, sessione 30 giorni,
-- tempo di risposta uguale per codice inesistente. La risposta contiene la categoria.
create or replace function public.dipendente_login(p_codice text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.dipendenti; raw text;
begin
  select * into d from public.dipendenti where codice = upper(trim(left(coalesce(p_codice, ''), 20))) and attivo for update;
  if not found or d.pin_hash is null then
    perform extensions.crypt(left(coalesce(p_pin, ''), 20), extensions.gen_salt('bf'));
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  if d.bloccato_fino is not null and d.bloccato_fino > now() then
    return jsonb_build_object('ok', false, 'errore', 'Troppi tentativi errati. Riprova dopo le '
      || to_char(d.bloccato_fino at time zone 'Europe/Rome', 'HH24:MI') || ' o chiedi all''ufficio personale.');
  end if;
  if d.pin_hash <> extensions.crypt(left(coalesce(p_pin, ''), 20), d.pin_hash) then
    update public.dipendenti set tentativi_falliti = tentativi_falliti + 1,
      bloccato_fino = case when tentativi_falliti + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = d.id;
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  update public.dipendenti set tentativi_falliti = 0, bloccato_fino = null where id = d.id;
  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sessioni_tecnico (token_hash, tecnico_id, scade_il)
  values (encode(extensions.digest(raw, 'sha256'), 'hex'), d.id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', raw, 'nome', d.nome || ' ' || d.cognome, 'codice', d.codice,
                            'categoria', d.categoria, 'tec', d.categoria = 'TEC');
end $$;

create or replace function public.dipendente_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  update public.sessioni_tecnico set revocata = true
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- C. Funzioni del dipendente ------------------------------------------------------------------
create or replace function public.dipendente_home(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); d public.dipendenti; a int := extract(year from public.oggi())::int;
begin
  select * into d from public.dipendenti where id = did;
  return jsonb_build_object(
    'profilo', jsonb_build_object('nome', d.nome, 'cognome', d.cognome, 'codice', d.codice, 'categoria', d.categoria,
                 'reparto', d.reparto, 'ruolo', d.ruolo, 'contratto', d.contratto, 'ore_giornaliere', d.ore_giornaliere,
                 'giorni_riposo', d.giorni_riposo, 'data_assunzione', d.data_assunzione, 'email', d.email, 'telefono', d.telefono),
    'tec', d.categoria = 'TEC',
    'anno', a,
    'saldi', privato.saldi_dipendente(did, a, null),
    'richieste', coalesce((select jsonb_agg(privato.richiesta_json(r, false) order by r.primo_giorno desc, r.id desc)
                             from (select * from public.richieste_assenza x where x.dipendente_id = did
                                    order by x.primo_giorno desc, x.id desc limit 10) r), '[]'),
    'in_attesa', (select count(*) from public.richieste_assenza x where x.dipendente_id = did and x.stato = 'in_attesa'),
    'tipi', coalesce((select jsonb_agg(jsonb_build_object('codice', t.codice, 'descrizione', t.descrizione, 'unita', t.unita,
                                 'mezza_giornata', t.mezza_giornata, 'con_saldo', t.con_saldo) order by t.ordine)
                        from public.tipi_assenza t where t.attivo and t.richiedibile), '[]'),
    'festivita', coalesce((select jsonb_agg(jsonb_build_object('data', f.data, 'nome', f.nome) order by f.data)
                             from public.festivita f where f.attiva and f.data between public.oggi() and public.oggi() + 120), '[]'),
    'non_lette', (select count(*) from public.notifiche n where n.tecnico_id = did and n.letta_il is null));
end $$;

create or replace function public.dipendente_saldi(p_token text, p_anno int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); a int := coalesce(p_anno, extract(year from public.oggi())::int);
begin
  if a < 2000 or a > 2100 then raise exception 'Anno non valido'; end if;
  return jsonb_build_object('anno', a, 'saldi', privato.saldi_dipendente(did, a, null));
end $$;

create or replace function public.dipendente_richieste(p_token text, p_anno int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(privato.richiesta_json(r, false) order by r.primo_giorno desc, r.id desc)
                     from public.richieste_assenza r
                    where r.dipendente_id = did
                      and (p_anno is null or (r.primo_giorno <= make_date(p_anno, 12, 31) and r.ultimo_giorno >= make_date(p_anno, 1, 1)))), '[]');
end $$;

-- Anteprima: conteggio, saldo dopo e avvisi SENZA salvare
create or replace function public.dipendente_anteprima(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return privato.calcola_richiesta(did, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, true);
end $$;

create or replace function public.dipendente_invia_richiesta(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); c jsonb; r public.richieste_assenza;
begin
  perform 1 from public.dipendenti where id = did for update;   -- una richiesta alla volta per dipendente
  if (select count(*) from public.richieste_assenza x where x.dipendente_id = did and x.creata_da = 'dipendente'
        and x.creato_il > now() - interval '1 day') >= 20 then
    raise exception 'Hai inviato troppe richieste oggi. Contatta l''ufficio personale.';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  c := privato.calcola_richiesta(did, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, true);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  r := privato.salva_richiesta(c, p_note, 'dipendente', null, false);
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', r.stato,
    'messaggio', 'Richiesta ' || r.numero || ' inviata all''ufficio personale: ' || privato.fmt_q(r.quantita, r.unita) || '.',
    'avvisi', c->'avvisi', 'saldo_insufficiente', (c->>'saldo_insufficiente')::boolean, 'calcolo', c);
end $$;

create or replace function public.dipendente_annulla_richiesta(p_token text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); r public.richieste_assenza;
begin
  select * into r from public.richieste_assenza where id = p_id and dipendente_id = did for update;
  if not found then raise exception 'Richiesta non trovata.'; end if;
  if r.stato <> 'in_attesa' then
    raise exception 'Puoi annullare solo una richiesta ancora in attesa. Per questa richiesta (%) contatta l''ufficio personale.',
      case r.stato when 'approvata' then 'già approvata' when 'rifiutata' then 'non approvata' else 'già annullata' end;
  end if;
  update public.richieste_assenza set stato = 'annullata', annullata_da = 'dipendente', annullata_il = now(),
         motivo_annullamento = 'Annullata dal dipendente' where id = r.id;
  return jsonb_build_object('ok', true, 'numero', r.numero, 'messaggio', 'Richiesta ' || r.numero || ' annullata.');
end $$;

-- Notifiche e push per tutte le categorie (i TEC possono continuare a usare tecnico_notifiche)
create or replace function public.dipendente_notifiche(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'tipo', n.tipo, 'dati', n.dati, 'creato_il', n.creato_il,
                                    'letta', n.letta_il is not null)
                    order by (n.tipo = 'avviso' and n.dati->>'livello' = 'urgente' and n.letta_il is null) desc, n.creato_il desc)
                     from public.notifiche n
                    where n.tecnico_id = did and (n.letta_il is null or n.creato_il > now() - interval '30 days')), '[]');
end $$;

create or replace function public.dipendente_notifica_letta(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  update public.notifiche set letta_il = coalesce(letta_il, now()) where id = p_id and tecnico_id = did;
end $$;

create or replace function public.dipendente_salva_push(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_lingua text) returns void
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  perform public._push_valida(p_endpoint, p_p256dh, p_auth);
  if (select count(*) from public.push_iscrizioni where tecnico_id = did and endpoint <> p_endpoint) >= 5 then
    raise exception 'Notifiche già attive su 5 dispositivi. Chiedi all''ufficio personale.';
  end if;
  insert into public.push_iscrizioni (tecnico_id, endpoint, p256dh, auth, lingua)
  values (did, p_endpoint, p_p256dh, p_auth, case when p_lingua = 'ar' then 'ar' else 'it' end)
  on conflict (endpoint) do update set tecnico_id = excluded.tecnico_id, user_id = null, p256dh = excluded.p256dh,
    auth = excluded.auth, lingua = excluded.lingua, ultimo_errore = null;
end $$;

-- D. Funzioni HR ---------------------------------------------------------------------------------
-- Elenco richieste. p_stato: 'in_attesa' (default) | 'approvata' | 'rifiutata' | 'annullata' | null = tutte.
-- Per le richieste in attesa: saldo prima/dopo l'approvazione e impatto giorno per giorno.
create or replace function public.hr_richieste(p_stato text default 'in_attesa', p_da date default null, p_a date default null,
  p_categoria text default null, p_dipendente bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  if p_stato is not null and p_stato not in ('in_attesa', 'approvata', 'rifiutata', 'annullata') then raise exception 'Stato non valido'; end if;
  return coalesce((
    select jsonb_agg(privato.richiesta_json(r, true)
             || case when r.stato = 'in_attesa' then jsonb_build_object(
                  'impatto', privato.impatto(r.id),
                  'saldi', (select coalesce(jsonb_agg(jsonb_build_object('anno', y.a, 'quantita', y.q,
                                       'saldo', (s.s->>'saldo')::numeric,
                                       'saldo_dopo_approvazione', (s.s->>'saldo')::numeric - y.q,
                                       'in_attesa_altre', (s.s->>'in_attesa')::numeric - y.q,
                                       'alla_data', s.s->'alla_data') order by y.a), '[]')
                              from (select extract(year from g.giorno)::int a, sum(g.quantita) q, max(g.giorno) ultimo
                                      from public.richieste_assenza_giorni g where g.richiesta_id = r.id group by 1) y,
                                   lateral (select privato.saldo(r.dipendente_id, y.a, r.tipo,
                                                     (date_trunc('month', y.ultimo) + interval '1 month - 1 day')::date) s) s
                             where s.s is not null))
                else '{}'::jsonb end
             order by case when r.stato = 'in_attesa' then 0 else 1 end, case when r.stato = 'in_attesa' then r.creato_il end, r.creato_il desc)
      from (select x.* from public.richieste_assenza x join public.dipendenti d on d.id = x.dipendente_id
             where (p_stato is null or x.stato = p_stato)
               and (p_da is null or x.ultimo_giorno >= p_da) and (p_a is null or x.primo_giorno <= p_a)
               and (p_categoria is null or d.categoria = p_categoria)
               and (p_dipendente is null or x.dipendente_id = p_dipendente)
             order by x.creato_il desc limit 500) r), '[]');
end $$;

create or replace function public.hr_impatto_richiesta(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  if not exists (select 1 from public.richieste_assenza where id = p_id) then raise exception 'Richiesta non trovata.'; end if;
  return privato.impatto(p_id);
end $$;

-- p_decisione: 'approva' | 'rifiuta' (il motivo è obbligatorio per il rifiuto)
create or replace function public.hr_decidi_richiesta(p_id bigint, p_decisione text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.richieste_assenza; auto boolean; nuovo text; mot text := nullif(trim(coalesce(p_motivo, '')), ''); avv jsonb := '[]';
begin
  perform public.richiedi_hr();
  if p_decisione not in ('approva', 'rifiuta') then raise exception 'Decisione non valida: usa approva o rifiuta.'; end if;
  select * into r from public.richieste_assenza where id = p_id for update;
  if not found then raise exception 'Richiesta non trovata.'; end if;
  if r.stato <> 'in_attesa' then
    raise exception 'La richiesta % non è più in attesa (stato: %).', r.numero, replace(r.stato, '_', ' ');
  end if;
  if p_decisione = 'rifiuta' and mot is null then raise exception 'Per non approvare la richiesta scrivi il motivo.'; end if;
  if length(coalesce(mot, '')) > 500 then raise exception 'Motivo troppo lungo: massimo 500 caratteri.'; end if;
  if p_decisione = 'approva' and not exists (select 1 from public.dipendenti d where d.id = r.dipendente_id and d.attivo) then
    raise exception 'Il dipendente non è più attivo.';
  end if;
  auto := privato.e_auto(r.dipendente_id);
  nuovo := case when p_decisione = 'approva' then 'approvata' else 'rifiutata' end;
  update public.richieste_assenza set stato = nuovo, motivo_decisione = mot, deciso_da = auth.uid(), deciso_il = now(),
         auto_decisione = auto_decisione or auto
   where id = r.id;
  if nuovo = 'approvata' then
    select coalesce(jsonb_agg('Saldo ' || (s.s->>'anno') || ' dopo l''approvazione: ' || privato.fmt_q((s.s->>'saldo')::numeric, r.unita)), '[]')
      into avv
      from (select privato.saldo(r.dipendente_id, y.a, r.tipo, (date_trunc('month', y.u) + interval '1 month - 1 day')::date) s
              from (select extract(year from g.giorno)::int a, max(g.giorno) u from public.richieste_assenza_giorni g
                     where g.richiesta_id = r.id group by 1) y) s
     where s.s is not null and (s.s->>'saldo')::numeric < 0;
  end if;
  if auto then
    -- auto-decisione: avviso agli altri amministratori
    insert into public.notifiche (user_id, tipo, dati, link)
    select x.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', 'importante',
             'titolo', 'Auto-decisione HR', 'testo', privato.nome_account(auth.uid()) || ' ha ' || case when nuovo = 'approvata' then 'approvato' else 'rifiutato' end
                       || ' una propria richiesta (' || r.numero || ').', 'richiesta_id', r.id, 'numero', r.numero, 'evento', 'auto_decisione'), '/hr/richieste'
      from public.responsabili x where x.attivo and x.ruolo = 'admin' and x.user_id <> auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', nuovo, 'auto_decisione', auto, 'avvisi', avv);
end $$;

create or replace function public.hr_anteprima(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  return privato.calcola_richiesta(p_dipendente, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, false);
end $$;

-- Inserimento per conto del dipendente (es. malattia comunicata al telefono): approvata subito
-- se p_approva (default), altrimenti resta in attesa.
create or replace function public.hr_inserisci_richiesta(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null,
  p_approva boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb; r public.richieste_assenza; auto boolean;
begin
  perform public.richiedi_hr();
  perform 1 from public.dipendenti where id = p_dipendente for update;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  c := privato.calcola_richiesta(p_dipendente, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, false);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  r := privato.salva_richiesta(c, p_note, 'hr', auth.uid(), coalesce(p_approva, true));
  auto := privato.e_auto(p_dipendente);
  if auto then update public.richieste_assenza set auto_decisione = true where id = r.id; end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', r.stato, 'auto_decisione', auto,
    'messaggio', 'Richiesta ' || r.numero || ' registrata (' || replace(r.stato, '_', ' ') || '): ' || privato.fmt_q(r.quantita, r.unita) || '.',
    'avvisi', c->'avvisi', 'saldo_insufficiente', (c->>'saldo_insufficiente')::boolean, 'calcolo', c);
end $$;

-- Annullamento da HR (in attesa o già approvata) con motivo obbligatorio
create or replace function public.hr_annulla_richiesta(p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.richieste_assenza; mot text := nullif(trim(coalesce(p_motivo, '')), ''); auto boolean;
begin
  perform public.richiedi_hr();
  if mot is null or length(mot) < 3 then raise exception 'Scrivi il motivo dell''annullamento.'; end if;
  if length(mot) > 500 then raise exception 'Motivo troppo lungo: massimo 500 caratteri.'; end if;
  select * into r from public.richieste_assenza where id = p_id for update;
  if not found then raise exception 'Richiesta non trovata.'; end if;
  if r.stato not in ('in_attesa', 'approvata') then
    raise exception 'La richiesta % è già %: non si può annullare.', r.numero, case r.stato when 'rifiutata' then 'non approvata' else 'annullata' end;
  end if;
  auto := privato.e_auto(r.dipendente_id);
  update public.richieste_assenza set stato = 'annullata', annullata_da = 'hr', annullata_da_utente = auth.uid(), annullata_il = now(),
         motivo_annullamento = mot, auto_decisione = auto_decisione or auto
   where id = r.id;
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', 'annullata', 'auto_decisione', auto);
end $$;

-- Saldi di tutti (o filtrati). p_alla: data per il maturato (default oggi).
create or replace function public.hr_saldi(p_anno int default null, p_categoria text default null, p_dipendente bigint default null,
  p_alla date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a int := coalesce(p_anno, extract(year from coalesce(p_alla, public.oggi()))::int);
begin
  perform public.richiedi_hr();
  if a < 2000 or a > 2100 then raise exception 'Anno non valido'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'dipendente_id', d.id, 'nome', d.nome || ' ' || d.cognome, 'codice', d.codice, 'categoria', d.categoria, 'reparto', d.reparto,
      'contratto', d.contratto, 'ore_giornaliere', d.ore_giornaliere, 'attivo', d.attivo,
      'saldi', privato.saldi_dipendente(d.id, a, p_alla)) order by d.cognome, d.nome)
    from public.dipendenti d
   where (d.attivo or d.data_cessazione >= make_date(a, 1, 1))
     and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)), '[]');
end $$;

create or replace function public.hr_rettifica_saldo(p_dipendente bigint, p_anno int, p_tipo text, p_quantita numeric, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare nid bigint;
begin
  perform public.richiedi_hr();
  if not exists (select 1 from public.dipendenti where id = p_dipendente) then raise exception 'Dipendente non trovato.'; end if;
  if not exists (select 1 from public.tipi_assenza where codice = p_tipo and con_saldo) then raise exception 'Questo tipo di assenza non ha un saldo.'; end if;
  if p_quantita is null or p_quantita = 0 or abs(p_quantita) > 1000 then raise exception 'Quantità non valida.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Scrivi il motivo della rettifica (almeno 5 caratteri).'; end if;
  insert into public.rettifiche_saldo (dipendente_id, anno, tipo, quantita, motivo, autore)
  values (p_dipendente, p_anno, p_tipo, round(p_quantita, 2), trim(p_motivo), auth.uid()) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'saldo', privato.saldo(p_dipendente, p_anno, p_tipo, null));
end $$;

-- Calendario assenze per periodo (richieste in attesa/approvate + assenze manuali)
create or replace function public.hr_calendario(p_da date, p_a date, p_categoria text default null, p_dipendente bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  if p_da is null or p_a is null or p_a < p_da then raise exception 'Periodo non valido'; end if;
  if p_a - p_da > 400 then raise exception 'Periodo troppo lungo: massimo 400 giorni'; end if;
  return jsonb_build_object('da', p_da, 'a', p_a,
    'festivita', coalesce((select jsonb_agg(jsonb_build_object('data', f.data, 'nome', f.nome, 'origine', f.origine) order by f.data)
                             from public.festivita f where f.attiva and f.data between p_da and p_a), '[]'),
    'assenze', coalesce((select jsonb_agg(x order by x->>'dal', x->>'nome') from (
        select jsonb_build_object('origine', 'richiesta', 'richiesta_id', r.id, 'numero', r.numero, 'dipendente_id', d.id,
                 'nome', d.nome || ' ' || d.cognome, 'categoria', d.categoria, 'reparto', d.reparto,
                 'tipo', r.tipo, 'etichetta', t.descrizione, 'stato', r.stato, 'dal', r.primo_giorno, 'al', r.ultimo_giorno,
                 'ora_inizio', to_char(r.ora_inizio, 'HH24:MI'), 'ora_fine', to_char(r.ora_fine, 'HH24:MI'),
                 'mezza_giornata', r.mezza_giornata, 'quantita', r.quantita, 'unita', r.unita) x
          from public.richieste_assenza r join public.dipendenti d on d.id = r.dipendente_id join public.tipi_assenza t on t.codice = r.tipo
         where r.stato in ('in_attesa', 'approvata') and r.primo_giorno <= p_a and r.ultimo_giorno >= p_da
           and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)
        union all
        select jsonb_build_object('origine', 'manuale', 'assenza_id', m.id, 'dipendente_id', d.id,
                 'nome', d.nome || ' ' || d.cognome, 'categoria', d.categoria, 'reparto', d.reparto,
                 'tipo', null, 'etichetta', m.motivo, 'stato', 'approvata', 'dal', m.dal, 'al', m.al,
                 'ora_inizio', null, 'ora_fine', null, 'mezza_giornata', false, 'quantita', null, 'unita', null)
          from public.assenze_manuali m join public.dipendenti d on d.id = m.tecnico_id
         where not m.annullata and m.dal <= p_a and m.al >= p_da
           and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)) z), '[]'));
end $$;

-- Report HR. p_tipo: 'riepilogo' (per dipendente) | 'presenze' (giorno per giorno) | 'registro' (richieste)
create or replace function public.hr_report(p_tipo text, p_da date, p_a date, p_categoria text default null, p_dipendente bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare righe jsonb; anno_saldo int := extract(year from p_a)::int;
begin
  perform public.richiedi_hr();
  if p_da is null or p_a is null or p_a < p_da then raise exception 'Periodo non valido'; end if;
  if p_a - p_da > 731 then raise exception 'Periodo troppo lungo: massimo 2 anni'; end if;

  if p_tipo = 'riepilogo' then
    select coalesce(jsonb_agg(x order by x->>'dipendente'), '[]') into righe from (
      select jsonb_build_object(
          'dipendente', d.cognome || ' ' || d.nome, 'codice', d.codice, 'categoria', d.categoria, 'reparto', d.reparto,
          'contratto', d.contratto,
          'giorni_lavorativi_periodo', l.n,
          'giorni_assenza', coalesce(ass.fr, 0),
          'giorni_assenza_manuali', coalesce(man.n, 0),
          'giorni_presenza', l.n - coalesce(ass.fr, 0) - coalesce(man.n, 0),
          'richieste_in_attesa', (select count(*) from public.richieste_assenza r where r.dipendente_id = d.id and r.stato = 'in_attesa'
                                    and r.primo_giorno <= p_a and r.ultimo_giorno >= p_da))
        || coalesce((select jsonb_object_agg(lower(t.codice), coalesce((select sum(g.quantita) from public.richieste_assenza r
                         join public.richieste_assenza_giorni g on g.richiesta_id = r.id
                        where r.dipendente_id = d.id and r.tipo = t.codice and r.stato = 'approvata' and g.giorno between p_da and p_a), 0))
                       from public.tipi_assenza t), '{}'::jsonb)
        || coalesce((select jsonb_object_agg('saldo_' || lower(t.codice), (privato.saldo(d.id, anno_saldo, t.codice, p_a)->>'saldo')::numeric)
                       from public.tipi_assenza t where t.con_saldo and t.attivo), '{}'::jsonb) x
        from public.dipendenti d,
          lateral (select count(*) n from generate_series(greatest(p_da, coalesce(d.data_assunzione, p_da)), least(p_a, coalesce(d.data_cessazione, p_a)), interval '1 day') g
                    where privato.e_lavorativo(d.giorni_riposo, g::date)) l,
          lateral (select sum(g.frazione) fr from public.richieste_assenza r join public.richieste_assenza_giorni g on g.richiesta_id = r.id
                    where r.dipendente_id = d.id and r.stato = 'approvata' and g.giorno between p_da and p_a) ass,
          lateral (select count(distinct g::date) n from public.assenze_manuali m,
                          generate_series(greatest(m.dal, p_da), least(m.al, p_a), interval '1 day') g
                    where m.tecnico_id = d.id and not m.annullata and m.dal <= p_a and m.al >= p_da
                      and privato.e_lavorativo(d.giorni_riposo, g::date)
                      and not exists (select 1 from public.richieste_assenza r2 join public.richieste_assenza_giorni g2 on g2.richiesta_id = r2.id
                                       where r2.dipendente_id = d.id and r2.stato = 'approvata' and g2.giorno = g::date)) man
       where (d.attivo or d.data_cessazione >= p_da) and (d.data_assunzione is null or d.data_assunzione <= p_a)
         and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)) z;

  elsif p_tipo = 'presenze' then
    if p_a - p_da > 400 then raise exception 'Periodo troppo lungo per le presenze: massimo 400 giorni'; end if;
    select coalesce(jsonb_agg(x order by x->>'data', x->>'dipendente'), '[]') into righe from (
      select jsonb_build_object(
          'data', g.d, 'giorno', (array['lun','mar','mer','gio','ven','sab','dom'])[extract(isodow from g.d)::int], 'dipendente', d.cognome || ' ' || d.nome, 'codice', d.codice,
          'categoria', d.categoria, 'reparto', d.reparto,
          'stato', case
            when substr(d.giorni_riposo, extract(isodow from g.d)::int, 1) = '1' then 'Riposo'
            when f.nome is not null then 'Festività'
            when coalesce(a.fr, 0) >= 1 then 'Assente'
            when coalesce(a.fr, 0) > 0 then 'Parziale'
            when m.motivo is not null then 'Assente (flotta)'
            else 'Presente' end,
          'dettaglio', coalesce(a.dett, case when f.nome is not null then f.nome end, m.motivo),
          'in_attesa', p.numeri) x
        from generate_series(p_da, p_a, interval '1 day') gs(ts)
        cross join lateral (select gs.ts::date as d) g
        cross join public.dipendenti d
        left join lateral (select f.nome from public.festivita f where f.data = g.d and f.attiva) f on true
        left join lateral (select sum(x.frazione) fr,
                                  string_agg(r.tipo || ' ' || privato.fmt_q(x.quantita, r.unita)
                                             || coalesce(' ' || to_char(r.ora_inizio, 'HH24:MI') || '-' || to_char(r.ora_fine, 'HH24:MI'), ''), ', ') dett
                             from public.richieste_assenza r join public.richieste_assenza_giorni x on x.richiesta_id = r.id
                            where r.dipendente_id = d.id and r.stato = 'approvata' and x.giorno = g.d) a on true
        left join lateral (select string_agg(r.numero, ', ') numeri from public.richieste_assenza r join public.richieste_assenza_giorni x on x.richiesta_id = r.id
                            where r.dipendente_id = d.id and r.stato = 'in_attesa' and x.giorno = g.d) p on true
        left join lateral (select mm.motivo from public.assenze_manuali mm where mm.tecnico_id = d.id and not mm.annullata
                              and g.d between mm.dal and mm.al limit 1) m on true
       where (d.attivo or d.data_cessazione >= p_da)
         and (d.data_assunzione is null or g.d >= d.data_assunzione) and (d.data_cessazione is null or g.d <= d.data_cessazione)
         and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)) z;

  elsif p_tipo = 'registro' then
    select coalesce(jsonb_agg(x order by x->>'creata_il'), '[]') into righe from (
      select jsonb_build_object(
          'numero', r.numero, 'dipendente', d.cognome || ' ' || d.nome, 'codice', d.codice, 'categoria', d.categoria, 'reparto', d.reparto,
          'tipo', r.tipo, 'descrizione', t.descrizione, 'primo_giorno', r.primo_giorno, 'ultimo_giorno', r.ultimo_giorno,
          'rientro', r.ultimo_giorno + 1,
          'orario', case when r.ora_inizio is not null then to_char(r.ora_inizio, 'HH24:MI') || '-' || to_char(r.ora_fine, 'HH24:MI') end,
          'mezza_giornata', case when r.mezza_giornata then 'Sì' else '' end,
          'quantita', r.quantita, 'unita', r.unita, 'giorni_lavorativi', r.giorni_lavorativi,
          'stato', case r.stato when 'in_attesa' then 'In attesa' when 'approvata' then 'Approvata' when 'rifiutata' then 'Non approvata' else 'Annullata' end,
          'saldo_insufficiente', case when r.saldo_insufficiente then 'Sì' else '' end,
          'creata_da', case r.creata_da when 'hr' then 'Ufficio personale' else 'Dipendente' end, 'creata_il', r.creato_il,
          'deciso_da', privato.nome_account(r.deciso_da), 'deciso_il', r.deciso_il, 'motivo_decisione', r.motivo_decisione,
          'annullata_il', r.annullata_il, 'motivo_annullamento', r.motivo_annullamento,
          'auto_decisione', case when r.auto_decisione then 'Sì' else '' end, 'note', r.note) x
        from public.richieste_assenza r join public.dipendenti d on d.id = r.dipendente_id join public.tipi_assenza t on t.codice = r.tipo
       where r.primo_giorno <= p_a and r.ultimo_giorno >= p_da
         and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)) z;
  else
    raise exception 'Tipo di report non valido: usa riepilogo, presenze o registro.';
  end if;
  return jsonb_build_object('righe', righe, 'generato_il', now());
end $$;

create or replace function public.hr_genera_festivita(p_anno int) returns int
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  return privato.genera_festivita(p_anno);
end $$;

-- PIN per tutte le categorie (stesse regole: PIN robusto, nuovo PIN = sessioni revocate)
create or replace function public.hr_genera_pin(p_dipendente bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare pin text; n int := 0;
begin
  perform public.richiedi_hr();
  if not exists (select 1 from public.dipendenti where id = p_dipendente and attivo) then raise exception 'Dipendente non trovato o non attivo'; end if;
  loop
    n := n + 1;
    pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when (select count(distinct c) from regexp_split_to_table(pin, '') c) >= 3
          and position(pin in '01234567890') = 0 and position(pin in '09876543210') = 0;
    if n > 50 then raise exception 'Generazione PIN non riuscita, riprova'; end if;
  end loop;
  update public.dipendenti set pin_hash = extensions.crypt(pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_dipendente;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_dipendente;
  return pin;
end $$;

create or replace function public.hr_imposta_pin(p_dipendente bigint, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  perform privato.controlla_pin(p_pin);
  if not exists (select 1 from public.dipendenti where id = p_dipendente and attivo) then raise exception 'Dipendente non trovato o non attivo'; end if;
  update public.dipendenti set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_dipendente;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_dipendente;
end $$;

-- Sblocco dopo 5 PIN errati (HR, per tutte le categorie)
create or replace function public.hr_sblocca_accesso(p_dipendente bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  update public.dipendenti set tentativi_falliti = 0, bloccato_fino = null where id = p_dipendente;
  if not found then raise exception 'Dipendente non trovato'; end if;
end $$;

-- Collegamento account HR/admin ↔ record dipendente (solo admin)
create or replace function public.admin_collega_dipendente(p_user uuid, p_dipendente bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_admin();
  if p_dipendente is not null and not exists (select 1 from public.dipendenti where id = p_dipendente) then raise exception 'Dipendente non trovato'; end if;
  if p_dipendente is not null and exists (select 1 from public.responsabili where dipendente_id = p_dipendente and user_id <> p_user) then
    raise exception 'Questo dipendente è già collegato a un altro account';
  end if;
  update public.responsabili set dipendente_id = p_dipendente where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
end $$;

-- Permessi (le funzioni nuove sono già eseguibili da PUBLIC per default del database: i
-- controlli di sessione/ruolo sono dentro ogni funzione; qui si rende esplicito chi le usa).
grant execute on function
  public.dipendente_login(text, text), public.dipendente_logout(text), public.dipendente_home(text),
  public.dipendente_saldi(text, int), public.dipendente_richieste(text, int),
  public.dipendente_anteprima(text, text, date, date, time, time, boolean),
  public.dipendente_invia_richiesta(text, text, date, date, time, time, boolean, text),
  public.dipendente_annulla_richiesta(text, bigint), public.dipendente_notifiche(text),
  public.dipendente_notifica_letta(text, bigint), public.dipendente_salva_push(text, text, text, text, text)
  to anon, authenticated;
grant execute on function
  public.hr_richieste(text, date, date, text, bigint), public.hr_impatto_richiesta(bigint),
  public.hr_decidi_richiesta(bigint, text, text), public.hr_anteprima(bigint, text, date, date, time, time, boolean),
  public.hr_inserisci_richiesta(bigint, text, date, date, time, time, boolean, text, boolean),
  public.hr_annulla_richiesta(bigint, text), public.hr_saldi(int, text, bigint, date),
  public.hr_rettifica_saldo(bigint, int, text, numeric, text), public.hr_calendario(date, date, text, bigint),
  public.hr_report(text, date, date, text, bigint), public.hr_genera_festivita(int),
  public.hr_genera_pin(bigint), public.hr_imposta_pin(bigint, text), public.hr_sblocca_accesso(bigint),
  public.admin_collega_dipendente(uuid, bigint), public.richiedi_hr()
  to authenticated;
