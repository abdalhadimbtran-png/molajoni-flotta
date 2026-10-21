-- =====================================================================
-- Mezza giornata: MATTINA o POMERIGGIO (specifiche UX § 2.3 e revisione P1-4)
--
-- Prima non si sapeva quale metà: il piano non poteva dire se il tecnico c'è per l'intervento
-- delle 14:00 e due "mattine" lo stesso giorno passavano. Ora:
--  * richieste_assenza.meta = 'mattina' | 'pomeriggio' (obbligatoria con mezza_giornata);
--  * config ora_meta_giornata (default 13:00) separa mattina e pomeriggio;
--  * sovrapposizioni: stessa metà, oppure permesso a ore che cade nella metà già chiesta;
--  * nel piano: "Assente la mattina" / "Assente il pomeriggio" e avviso per gli interventi
--    che cadono in quella metà.
-- Le funzioni API che ricevono la richiesta hanno un parametro in più (p_meta): le versioni
-- precedenti sono rinominate *_v1_da_eliminare e rispondono "Aggiorna l'app" (nessuna eliminazione).
-- =====================================================================

alter table public.richieste_assenza add column meta text;
alter table public.richieste_assenza add constraint richieste_meta_check
  check (meta is null or (mezza_giornata and meta in ('mattina', 'pomeriggio')));
alter table public.assenze_da_richieste add column meta text;
insert into public.config_azienda (chiave, valore, descrizione, da_confermare) values
  ('ora_meta_giornata', '13:00', 'Ora che separa la mattina dal pomeriggio per le mezze giornate (formato HH:MM).', true)
on conflict (chiave) do nothing;
alter table public.config_azienda add constraint config_azienda_valori3_check check (
  chiave <> 'ora_meta_giornata' or valore ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create or replace function privato.ora_meta() returns time
language sql stable set search_path = '' as $$
  select coalesce((select c.valore from public.config_azienda c where c.chiave = 'ora_meta_giornata'), '13:00')::time;
$$;

-- Calcolo con la metà della giornata (si appoggia al calcolo base e aggiunge i controlli)
create or replace function privato.calcola_richiesta(
  p_dip bigint, p_tipo text, p_primo date, p_rientro date,
  p_ora_inizio time, p_ora_fine time, p_mezza boolean, p_da_dipendente boolean, p_meta text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  c jsonb; err text[]; conf text; soglia time := privato.ora_meta();
  mezza boolean := coalesce(p_mezza, false); meta text := nullif(lower(trim(coalesce(p_meta, ''))), '');
begin
  c := privato.calcola_richiesta(p_dip, p_tipo, p_primo, p_rientro, p_ora_inizio, p_ora_fine, p_mezza, p_da_dipendente);
  err := array(select jsonb_array_elements_text(c->'errori'));
  if mezza then
    if meta is null then err := err || 'Scegli se sei assente la mattina o il pomeriggio.'::text;
    elsif meta not in ('mattina', 'pomeriggio') then err := err || 'Mezza giornata: indica mattina o pomeriggio.'::text; end if;
  elsif meta is not null then
    err := err || 'Mattina o pomeriggio si sceglie solo per la mezza giornata.'::text;
  end if;
  if cardinality(err) = 0 and (mezza or p_ora_inizio is not null) then
    select string_agg(distinct r.numero || ' (' || replace(r.stato, '_', ' ') || ')', ', ') into conf
      from public.richieste_assenza r join public.richieste_assenza_giorni g on g.richiesta_id = r.id
     where r.dipendente_id = p_dip and r.stato in ('in_attesa', 'approvata') and g.giorno = p_primo
       and ((mezza and r.mezza_giornata and r.meta = meta)
            or (mezza and r.ora_inizio is not null
                and case meta when 'mattina' then r.ora_inizio < soglia else r.ora_fine > soglia end)
            or (p_ora_inizio is not null and r.mezza_giornata and r.meta is not null
                and case r.meta when 'mattina' then p_ora_inizio < soglia else p_ora_fine > soglia end));
    if conf is not null then
      err := err || ('Per questa parte della giornata c''è già una richiesta: ' || conf || '. Scegli un altro orario o annulla quella richiesta.');
    end if;
  end if;
  return c || jsonb_build_object('meta', case when mezza then meta end, 'errori', to_jsonb(err), 'ok', cardinality(err) = 0);
end $$;

-- Etichetta per il piano con la metà; finestra oraria della metà salvata nella riga del piano
create or replace function privato.tg_richiesta_sincronizza() returns trigger
language plpgsql security definer set search_path = '' as $$
declare et text; riga text; e_tec boolean; oi time := new.ora_inizio; ofi time := new.ora_fine;
begin
  riga := case when new.stato = 'in_attesa' then 'possibile'
               when new.ora_inizio is null and not new.mezza_giornata then 'assenza'
               else 'nota' end;
  et := privato.etichetta_piano(new.tipo, riga, new.ora_inizio, new.ora_fine);
  if riga = 'nota' and new.mezza_giornata and new.meta is not null then
    et := replace(et, ' (mezza giornata)', case new.meta when 'mattina' then ' la mattina' else ' il pomeriggio' end);
    oi := case new.meta when 'mattina' then time '00:00' else privato.ora_meta() end;
    ofi := case new.meta when 'mattina' then privato.ora_meta() else time '23:59:59' end;
  end if;
  e_tec := exists (select 1 from public.dipendenti d where d.id = new.dipendente_id and d.categoria = 'TEC');
  if new.stato in ('in_attesa', 'approvata') then
    insert into public.assenze_da_richieste as a (richiesta_id, dipendente_id, dal, al, tipo_riga, etichetta, attiva, ora_inizio, ora_fine, tec, meta)
    values (new.id, new.dipendente_id, new.primo_giorno, new.ultimo_giorno, riga, et, true, oi, ofi, e_tec, new.meta)
    on conflict (richiesta_id) do update
      set tipo_riga = excluded.tipo_riga, etichetta = excluded.etichetta, attiva = true, dal = excluded.dal, al = excluded.al,
          ora_inizio = excluded.ora_inizio, ora_fine = excluded.ora_fine, tec = excluded.tec, meta = excluded.meta
      where (a.tipo_riga, a.etichetta, a.attiva, a.dal, a.al, a.tec, a.meta) is distinct from
            (excluded.tipo_riga, excluded.etichetta, true, excluded.dal, excluded.al, excluded.tec, excluded.meta);
  else
    update public.assenze_da_richieste set attiva = false, tec = e_tec where richiesta_id = new.id and attiva;
  end if;
  return new;
end $$;
create or replace trigger sincronizza_richieste after insert or update of stato, meta on public.richieste_assenza
  for each row execute function privato.tg_richiesta_sincronizza();

-- Piano: l'avviso usa l'etichetta ("durante l'assenza (Assente la mattina)")
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.piano_giorno(date)'::regprocedure);
  nuovo := replace(src,
    $a$'Intervento alle ' || dentro || ' durante l''assenza ' || to_char(n.ora_inizio,'HH24:MI') || '-' || to_char(n.ora_fine,'HH24:MI')$a$,
    $a$'Intervento alle ' || dentro || ' durante l''assenza (' || n.etichetta || ')'$a$);
  if nuovo = src then raise exception 'piano_giorno: testo atteso non trovato'; end if;
  execute nuovo;
end $$;

-- meta nelle risposte (richiesta_json, calendario, registro)
do $$
declare f text; src text; nuovo text;
begin
  foreach f in array array['privato.richiesta_json(public.richieste_assenza, boolean)', 'public.hr_calendario(date, date, text, bigint)', 'public.hr_report(text, date, date, text, bigint)'] loop
    src := pg_get_functiondef(f::regprocedure);
    nuovo := replace(src, $a$'mezza_giornata', r.mezza_giornata,$a$, $a$'mezza_giornata', r.mezza_giornata, 'meta', r.meta,$a$);
    nuovo := replace(nuovo, $a$'mezza_giornata', case when r.mezza_giornata then 'Sì' else '' end,$a$,
                            $a$'mezza_giornata', case when r.mezza_giornata then coalesce(r.meta, 'Sì') else '' end,$a$);
    if nuovo = src then raise exception '%: testo atteso non trovato', f; end if;
    execute nuovo;
  end loop;
end $$;

-- API: versioni precedenti rinominate e disattivate ------------------------------------------------
alter function public.dipendente_anteprima(text, text, date, date, time, time, boolean) rename to dipendente_anteprima_v1_da_eliminare;
alter function public.dipendente_invia_richiesta(text, text, date, date, time, time, boolean, text) rename to dipendente_invia_richiesta_v1_da_eliminare;
alter function public.hr_anteprima(bigint, text, date, date, time, time, boolean) rename to hr_anteprima_v1_da_eliminare;
alter function public.hr_inserisci_richiesta(bigint, text, date, date, time, time, boolean, text, boolean) rename to hr_inserisci_richiesta_v1_da_eliminare;
create or replace function public.dipendente_anteprima_v1_da_eliminare(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'Aggiorna l''app per inviare le richieste.'; end $$;
create or replace function public.dipendente_invia_richiesta_v1_da_eliminare(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'Aggiorna l''app per inviare le richieste.'; end $$;
create or replace function public.hr_anteprima_v1_da_eliminare(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$ begin raise exception 'Aggiorna il pannello.'; end $$;
create or replace function public.hr_inserisci_richiesta_v1_da_eliminare(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null,
  p_approva boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin raise exception 'Aggiorna il pannello.'; end $$;

-- API nuove (stessi nomi, parametro p_meta in fondo) -------------------------------------------------
create or replace function public.dipendente_anteprima(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_meta text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return privato.calcola_richiesta(did, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, true, p_meta);
end $$;

create or replace function public.dipendente_invia_richiesta(p_token text, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null,
  p_meta text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); c jsonb; r public.richieste_assenza;
begin
  perform 1 from public.dipendenti where id = did for update;   -- una richiesta alla volta per dipendente
  if (select count(*) from public.richieste_assenza x where x.dipendente_id = did and x.creata_da = 'dipendente'
        and x.creato_il > now() - interval '1 day') >= 20 then
    raise exception 'Hai inviato troppe richieste oggi. Contatta l''ufficio personale.';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  c := privato.calcola_richiesta(did, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, true, p_meta);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  r := privato.salva_richiesta(c, p_note, 'dipendente', null, false);
  if c->>'meta' is not null then update public.richieste_assenza set meta = c->>'meta' where id = r.id; end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', r.stato,
    'messaggio', 'Richiesta ' || r.numero || ' inviata all''ufficio personale: ' || privato.fmt_q(r.quantita, r.unita) || '.',
    'avvisi', c->'avvisi', 'saldo_insufficiente', (c->>'saldo_insufficiente')::boolean, 'calcolo', c);
end $$;

create or replace function public.hr_anteprima(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_meta text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.richiedi_hr();
  return privato.calcola_richiesta(p_dipendente, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, false, p_meta);
end $$;

create or replace function public.hr_inserisci_richiesta(p_dipendente bigint, p_tipo text, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_note text default null,
  p_approva boolean default true, p_meta text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb; r public.richieste_assenza; auto boolean;
begin
  perform public.richiedi_hr();
  perform 1 from public.dipendenti where id = p_dipendente for update;
  if coalesce(p_approva, true) then perform privato.controlla_decisore(p_dipendente); end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  c := privato.calcola_richiesta(p_dipendente, p_tipo, p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine, p_mezza_giornata, false, p_meta);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  r := privato.salva_richiesta(c, p_note, 'hr', auth.uid(), coalesce(p_approva, true));
  if c->>'meta' is not null then update public.richieste_assenza set meta = c->>'meta' where id = r.id; end if;
  auto := privato.e_auto(p_dipendente);
  if auto then
    update public.richieste_assenza set auto_decisione = true where id = r.id;
    perform privato.avvisa_admin_auto(r, case when r.stato = 'approvata' then 'registrato e approvato' else 'registrato' end);
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'numero', r.numero, 'stato', r.stato, 'auto_decisione', auto,
    'messaggio', 'Richiesta ' || r.numero || ' registrata (' || replace(r.stato, '_', ' ') || '): ' || privato.fmt_q(r.quantita, r.unita) || '.',
    'avvisi', c->'avvisi', 'saldo_insufficiente', (c->>'saldo_insufficiente')::boolean, 'calcolo', c);
end $$;

grant execute on function public.dipendente_anteprima(text, text, date, date, time, time, boolean, text),
  public.dipendente_invia_richiesta(text, text, date, date, time, time, boolean, text, text) to anon, authenticated;
grant execute on function public.hr_anteprima(bigint, text, date, date, time, time, boolean, text),
  public.hr_inserisci_richiesta(bigint, text, date, date, time, time, boolean, text, boolean, text) to authenticated;

-- dato di prova: la mezza giornata di Stefano Galli è la mattina
update public.richieste_assenza set meta = 'mattina' where note = '[PROVA] mezza giornata' and mezza_giornata and meta is null;
