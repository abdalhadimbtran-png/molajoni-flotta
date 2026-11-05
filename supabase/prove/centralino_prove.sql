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
  -- intervento senza data/fascia: bloccato (procedura 1.3)
  begin
    perform public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Guasto","cliente_nome":"X"}');
    raise exception 'intervento senza appuntamento: doveva fallire';
  exception when others then if sqlerrm not like 'Procedura: dai subito%' then raise; end if; end;
  r := public.centralino_crea(jsonb_build_object('canale','telefono','tipo','manutenzione','sottotipo','Allarme sonoro attivo','cliente_nome','ZZ Condominio Prova',
         'telefono','0600000000','tacitazione_tentata',true,'appuntamento_data',(now() at time zone 'Europe/Rome')::date,'appuntamento_fascia','pomeriggio'));
  pid := (r->>'id')::bigint;
  select priorita = 'urgente' and sla_stadio = 'eseguito' and numero ~ '^CT-\d{4}-\d{6}$' into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Allarme: priorità/SLA/numero errati'; end if;
  -- > 1.000 €: serve uno dei tre commerciali; nessuno disponibile → richiamo 2 ore
  begin
    perform public.centralino_crea('{"canale":"whatsapp","tipo":"offerta","importo_stimato":1500,"cliente_nome":"X","commerciale_nome":"Mario Rossi"}');
    raise exception '>1000 a commerciale non in elenco: doveva fallire';
  exception when others then if sqlerrm not like 'Offerta oltre 1.000%' then raise; end if; end;
  r := public.centralino_crea('{"canale":"whatsapp","tipo":"offerta","importo_stimato":1500,"cliente_nome":"ZZ Ditta Prova","commerciale_nome":"A. Querini","nessuno_disponibile":true}');
  pid2 := (r->>'id')::bigint;
  if r->>'tipo' <> 'offerta_grande' then raise exception 'Soglia 1000: %', r; end if;
  if not exists (select 1 from public.chiamate_trasferite where pratica_id = pid2 and modalita = 'richiamo' and destinatario_nome = 'A. Querini'
                 and richiamo_scadenza is not null) then raise exception '>1000 senza commerciale disponibile: richiamo non creato'; end if;
  if (select assegnato_nome from public.pratiche where id = pid2) <> 'A. Querini' then raise exception '>1000 non assegnata al commerciale'; end if;
  perform public.centralino_crea('{"canale":"tablet_tmq","tipo":"offerta","importo_stimato":300,"cliente_nome":"ZZ Bar Prova"}');
  perform public.centralino_crea('{"canale":"email","tipo":"modifica","sottotipo":"Anagrafica","cliente_nome":"ZZ Studio Prova"}');
  perform public.centralino_crea('{"canale":"collega","tipo":"abbigliamento","cliente_nome":"ZZ Tecnico Prova"}');
  perform public.centralino_chiamata_info('telefono', 'orari ufficio');
  -- appuntamento al primo contatto → stadio raggiunto
  r := public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Guasto","cliente_nome":"ZZ Uffici Prova","appuntamento_data":"2026-11-10","appuntamento_fascia":"mattina"}');
  if (select stato_corrente from public.pratiche where id = (r->>'id')::bigint) <> 'appuntamento' then raise exception 'Appuntamento al primo contatto non registrato'; end if;
  begin
    perform public.centralino_crea('{"tipo":"manutenzione","sottotipo":"Guasto","cliente_nome":"X","appuntamento_data":"2026-11-10"}');
    raise exception 'manca fascia: doveva fallire';
  exception when others then if sqlerrm not like 'Indica mattina%' then raise; end if; end;

  if (select stato_corrente from public.pratiche where id = pid) <> 'appuntamento' then raise exception 'Allarme: appuntamento non registrato'; end if;
  -- ordine rigido: niente salti
  begin perform public.centralino_avanza(pid, 'eseguito'); raise exception 'salto di passo permesso';
  exception when others then if sqlerrm not like 'Si procede un passo alla volta%' then raise; end if; end;
  -- requisiti: Taylor + Documento di intervento
  begin perform public.centralino_avanza(pid, 'comunicato', '{"alert_taylor":true}'); raise exception 'Taylor senza documento permesso';
  exception when others then if sqlerrm not like '%Documento di Intervento%' then raise; end if; end;
  -- chiusura anticipata vietata, annullo solo con motivo
  begin perform public.centralino_chiudi(pid, 'chiusa_ok', null); raise exception 'chiusura anticipata permessa';
  exception when others then if sqlerrm not like 'Una pratica si chiude%' then raise; end if; end;
  -- appuntamento già fissato: si sposta solo con motivo e conferme
  begin perform public.centralino_aggiorna(pid, '{"appuntamento_data":"2026-12-01","appuntamento_fascia":"mattina"}'); raise exception 'spostamento libero permesso';
  exception when others then if sqlerrm not like '%Sposta appuntamento%' then raise; end if; end;
  perform public.centralino_avanza(pid, 'comunicato', '{"alert_taylor":true,"documento_intervento":"DI-1","tecnico_nome":"ZZ Tecnico"}');
  perform public.centralino_nota(pid, 'nota', 'Cliente richiamato');
  perform public.centralino_aggiorna(pid, '{"contatto_nome":"Sig. Prova","assegnato_nome":"ZZ Tecnico"}');
  perform public.centralino_avanza(pid, 'eseguito');
  perform public.centralino_avanza(pid, 'chiusa');
  select esito = 'chiusa_ok' and alert_taylor and closed_at is not null into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Chiusura automatica all''ultimo stadio mancata'; end if;
  select count(*) into n from public.pratiche_eventi where pratica_id = pid;
  if n < 8 then raise exception 'Storia incompleta: % eventi', n; end if;
  -- esito rifiutata → chiusa_ko
  begin perform public.centralino_avanza(pid2, 'esito', '{"esito_offerta":"rifiutata"}'); raise exception 'esito senza passi precedenti permesso';
  exception when others then if sqlerrm not like 'Si procede un passo alla volta%' then raise; end if; end;
  begin perform public.centralino_avanza(pid2, 'presa'); raise exception 'presa in carico senza email permessa';
  exception when others then if sqlerrm not like '%Email al cliente%' then raise; end if; end;
  perform public.centralino_invia_email(pid2, 'presa_offerta_grande', 'cliente@prova.invalid', '{}', 'Presa', '<p>x</p>', 'x', 'copia', 'presa');
  perform public.centralino_avanza(pid2, 'contattato');
  perform public.centralino_invia_email(pid2, 'invio_offerta', 'cliente@prova.invalid', '{}', 'Offerta', '<p>x</p>', 'x', 'copia', 'offerta');
  perform public.centralino_avanza(pid2, 'esito', '{"esito_offerta":"rifiutata"}');
  if (select esito from public.pratiche where id = pid2) <> 'chiusa_ko' then raise exception 'Rifiutata non chiusa ko'; end if;
  -- email solo registrata (copia)
  perform public.centralino_invia_email(pid, 'conferma_intervento', 'cliente@prova.invalid', array['a@prova.invalid','non-valida'], 'Oggetto', '<p>x</p>', 'x', 'copia', null);
  if (select dati->'cc' from public.pratiche_eventi where pratica_id = pid and tipo = 'email_inviata') <> '["a@prova.invalid"]'::jsonb then raise exception 'CC non filtrati'; end if;
  -- appunti privati
  insert into public.appunti (chiave, testo) values ('p:' || pid, 'appunto riservato');
  if (select count(*) from public.appunti) <> 1 then raise exception 'L''autore non vede i suoi appunti'; end if;
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
  select count(*) into n from public.appunti; if n > 0 then raise exception 'Direzione legge gli appunti privati'; end if;
  begin insert into public.appunti (autore, chiave, testo) values (c, 'bozza', 'x'); raise exception 'Direzione scrive appunti altrui';
  exception when insufficient_privilege then null; end;
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
