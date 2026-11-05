-- Prove del centralino: blocco DO chiuso da raise exception → tutto annullato.
-- Esito atteso: ERROR «PROVE CENTRALINO OK: …». Qualsiasi altro errore = prova fallita.
do $$
declare
  c uuid := gen_random_uuid(); d uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  r jsonb; pid bigint; pid2 bigint; n int; ok boolean; ts timestamptz; msg text; log text := '';
  rome text := 'Europe/Rome';
begin
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'zz_ct_c@prova.invalid'),
    ('00000000-0000-0000-0000-000000000000', d, 'authenticated', 'authenticated', 'zz_ct_d@prova.invalid'),
    ('00000000-0000-0000-0000-000000000000', f, 'authenticated', 'authenticated', 'zz_ct_f@prova.invalid');
  insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values
    (c, 'ZZ Centralino', 'zz_ct_c@prova.invalid', 'responsabile', 'flotta', true, true, false),
    (d, 'ZZ Direzione', 'zz_ct_d@prova.invalid', 'responsabile', 'flotta', true, false, true),
    (f, 'ZZ Flotta', 'zz_ct_f@prova.invalid', 'responsabile', 'flotta', true, false, false);

  -- 1. SLA: weekend, orario d'ufficio, festività ------------------------------------------
  -- ven 06/11/2026 17:00 + 60 min → 30 min venerdì + 30 lunedì → lun 09/11 09:00
  ts := privato.ct_sla(timestamp '2026-11-06 17:00' at time zone rome, '{"tipo":"minuti","valore":60}');
  if ts <> timestamp '2026-11-09 09:00' at time zone rome then raise exception 'SLA minuti weekend: %', ts; end if;
  -- lun 09/11 08:00 + 2 ore → dalle 08:30 → 10:30
  ts := privato.ct_sla(timestamp '2026-11-09 08:00' at time zone rome, '{"tipo":"ore","valore":2}');
  if ts <> timestamp '2026-11-09 10:30' at time zone rome then raise exception 'SLA ore prima apertura: %', ts; end if;
  -- ven → fine giorno lavorativo successivo = lun 17:30
  ts := privato.ct_sla(timestamp '2026-11-06 11:00' at time zone rome, '{"tipo":"giorni_lav","valore":1}');
  if ts <> timestamp '2026-11-09 17:30' at time zone rome then raise exception 'SLA giorno succ. weekend: %', ts; end if;
  -- lun 07/12 → mar 08/12 Immacolata festiva → mer 09/12 17:30
  ts := privato.ct_sla(timestamp '2026-12-07 10:00' at time zone rome, '{"tipo":"giorni_lav","valore":1}');
  if ts <> timestamp '2026-12-09 17:30' at time zone rome then raise exception 'SLA festività: %', ts; end if;
  -- gio 24/12 + 2 giorni lavorativi: 25 Natale, 26-27 weekend → lun 28, mar 29
  ts := privato.ct_sla(timestamp '2026-12-24 10:00' at time zone rome, '{"tipo":"giorni_lav","valore":2}');
  if ts <> timestamp '2026-12-29 17:30' at time zone rome then raise exception 'SLA Natale: %', ts; end if;
  -- sabato, stesso giorno → lunedì 17:30; venerdì 18:00 stesso giorno → lunedì
  ts := privato.ct_sla(timestamp '2026-11-07 10:00' at time zone rome, '{"tipo":"stesso_giorno"}');
  if ts <> timestamp '2026-11-09 17:30' at time zone rome then raise exception 'SLA stesso giorno sabato: %', ts; end if;
  ts := privato.ct_sla(timestamp '2026-11-06 18:00' at time zone rome, '{"tipo":"stesso_giorno"}');
  if ts <> timestamp '2026-11-09 17:30' at time zone rome then raise exception 'SLA stesso giorno dopo chiusura: %', ts; end if;
  log := log || 'sla ';

  -- 2. Centralino: crea, avanza, chiudi ---------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Allarme sonoro attivo","cliente_nome":"ZZ Condominio Prova","telefono":"0600000000","tacitazione_tentata":true}');
  pid := (r->>'id')::bigint;
  select priorita = 'urgente' and sla_stadio = 'eseguito' and numero ~ '^CT-\d{4}-\d{6}$' into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Allarme: priorità/SLA/numero errati'; end if;
  r := public.centralino_crea('{"canale":"whatsapp","tipo":"offerta","importo_stimato":1500,"cliente_nome":"ZZ Ditta Prova"}');
  pid2 := (r->>'id')::bigint;
  if r->>'tipo' <> 'offerta_grande' then raise exception 'Soglia 1000: %', r; end if;
  perform public.centralino_crea('{"canale":"tablet_tmq","tipo":"offerta","importo_stimato":300,"cliente_nome":"ZZ Bar Prova"}');
  perform public.centralino_crea('{"canale":"email","tipo":"modifica","sottotipo":"Anagrafica","cliente_nome":"ZZ Studio Prova"}');
  perform public.centralino_chiamata_info('telefono', 'orari ufficio');
  -- appuntamento al primo contatto → stadio raggiunto
  r := public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Guasto","cliente_nome":"ZZ Uffici Prova","appuntamento_data":"2026-11-10","appuntamento_fascia":"mattina"}');
  if (select stato_corrente from public.pratiche where id = (r->>'id')::bigint) <> 'appuntamento' then raise exception 'Appuntamento al primo contatto non registrato'; end if;
  begin
    perform public.centralino_crea('{"tipo":"manutenzione","cliente_nome":"X","appuntamento_data":"2026-11-10"}');
    raise exception 'manca fascia: doveva fallire';
  exception when others then if sqlerrm not like 'Indica mattina%' then raise; end if; end;

  perform public.centralino_avanza(pid, 'appuntamento', '{"appuntamento_data":"2026-11-05","appuntamento_fascia":"pomeriggio"}');
  perform public.centralino_avanza(pid, 'comunicato', '{"alert_taylor":true,"tecnico_nome":"ZZ Tecnico"}');
  perform public.centralino_nota(pid, 'nota', 'Cliente richiamato');
  perform public.centralino_aggiorna(pid, '{"contatto_nome":"Sig. Prova","assegnato_nome":"ZZ Tecnico"}');
  perform public.centralino_avanza(pid, 'eseguito');
  perform public.centralino_avanza(pid, 'chiusa');
  select esito = 'chiusa_ok' and alert_taylor and closed_at is not null into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Chiusura automatica all''ultimo stadio mancata'; end if;
  select count(*) into n from public.pratiche_eventi where pratica_id = pid;
  if n < 8 then raise exception 'Storia incompleta: % eventi', n; end if;
  -- esito rifiutata → chiusa_ko
  perform public.centralino_avanza(pid2, 'esito', '{"esito_offerta":"rifiutata"}');
  if (select esito from public.pratiche where id = pid2) <> 'chiusa_ko' then raise exception 'Rifiutata non chiusa ko'; end if;
  -- email solo registrata (copia)
  perform public.centralino_invia_email(pid, 'conferma_intervento', 'cliente@prova.invalid', array['a@prova.invalid','non-valida'], 'Oggetto', '<p>x</p>', 'x', 'copia', null);
  if (select dati->'cc' from public.pratiche_eventi where pratica_id = pid and tipo = 'email_inviata') <> '["a@prova.invalid"]'::jsonb then raise exception 'CC non filtrati'; end if;
  log := log || 'flussi ';

  -- 3. Storia solo in aggiunta (anche da RPC: nessuna policy di scrittura) ------------------
  begin
    update public.pratiche_eventi set testo = 'x' where pratica_id = pid;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'UPDATE storia permesso'; end if;
  exception when insufficient_privilege then null; end;
  begin
    insert into public.pratiche (numero, canale, tipo, cliente_nome) values ('X', 'telefono', 'manutenzione', 'X');
    raise exception 'INSERT diretto permesso';
  exception when insufficient_privilege then null; end;

  -- 4. Contatori del registro -------------------------------------------------------------
  r := public.centralino_registro_giorno(null);
  if (r->>'telefonate')::int < 3 or (r->>'whatsapp')::int < 1 or (r->>'offerte_tablet')::int < 1 or (r->>'offerte_whatsapp')::int < 1
     or (r->>'aggiornamenti_anagrafica')::int < 1 or (r->>'chiamate_info')::int < 1 or (r->>'email')::int < 1 then
    raise exception 'Contatori errati: %', r; end if;
  log := log || 'contatori ';
  execute 'reset role';

  -- anche il proprietario non può riscrivere la storia (trigger)
  begin
    update public.pratiche_eventi set testo = 'x' where pratica_id = pid;
    raise exception 'UPDATE storia permesso al proprietario';
  exception when insufficient_privilege then null; end;
  -- (lo stesso trigger è «before update or delete»: la cancellazione si prova a mano, non qui)
  log := log || 'solo_aggiunta ';

  -- 5. Direzione: legge, non scrive -------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pratiche where cliente_nome like 'ZZ %';
  if n < 5 then raise exception 'Direzione non legge: %', n; end if;
  select count(*) into n from public.pratiche_eventi where pratica_id = pid;
  if n = 0 then raise exception 'Direzione non legge la storia'; end if;
  perform public.centralino_registro_giorno(null);
  begin perform public.centralino_crea('{"tipo":"informazione","cliente_nome":"X"}'); raise exception 'Direzione ha creato';
  exception when insufficient_privilege then null; end;
  begin perform public.centralino_nota(pid, 'nota', 'x'); raise exception 'Direzione ha scritto';
  exception when insufficient_privilege then null; end;
  update public.email_template set nome = 'x';
  get diagnostics n = row_count; if n > 0 then raise exception 'Direzione modifica i modelli'; end if;
  if public.is_responsabile() then raise exception 'Direzione entra nella flotta'; end if;
  execute 'reset role';

  -- 6. Flotta: niente centralino ----------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pratiche; if n > 0 then raise exception 'Flotta legge le pratiche'; end if;
  select count(*) into n from public.email_template; if n > 0 then raise exception 'Flotta legge i modelli'; end if;
  begin perform public.centralino_registro_giorno(null); raise exception 'Flotta legge il registro';
  exception when insufficient_privilege then null; end;
  if not public.is_responsabile() then raise exception 'Flotta ha perso l''accesso'; end if;
  execute 'reset role';
  -- centralino non entra nella flotta
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.is_responsabile() then raise exception 'Centralino entra nella flotta'; end if;
  execute 'reset role';

  -- 7. Anon: nulla ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.pratiche; if n > 0 then raise exception 'Anon legge le pratiche'; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into n from public.pratiche_eventi; if n > 0 then raise exception 'Anon legge la storia'; end if;
  exception when insufficient_privilege then null; end;
  begin perform public.centralino_crea('{"tipo":"informazione","cliente_nome":"X"}'); raise exception 'Anon ha creato';
  exception when insufficient_privilege then null; end;
  begin perform public.centralino_clienti('zz'); raise exception 'Anon cerca clienti';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  log := log || 'rls ';

  -- 8. Controllo SLA scaduti: evento + campanella, una volta sola --------------------------
  update public.pratiche set sla_scadenza = now() - interval '1 minute' where id = (r->>'id')::bigint or cliente_nome = 'ZZ Bar Prova';
  n := privato.centralino_controlla_sla();
  if n < 1 then raise exception 'SLA scaduto non rilevato'; end if;
  if privato.centralino_controlla_sla() <> 0 then raise exception 'SLA scaduto notificato due volte'; end if;
  if not exists (select 1 from public.notifiche where user_id = d and dati->>'categoria' = 'centralino') then raise exception 'Direzione senza campanella'; end if;
  log := log || 'sla_scaduto ';

  raise exception 'PROVE CENTRALINO OK: %', log;
end $$;
