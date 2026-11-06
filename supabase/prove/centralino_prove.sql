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
  -- procedura rev2: nessun appuntamento al primo contatto, urgenza obbligatoria
  begin
    perform public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Guasto","cliente_nome":"X"}');
    raise exception 'intervento senza urgenza: doveva fallire';
  exception when others then if sqlerrm not like 'Valuta l''urgenza%' then raise; end if; end;
  begin
    perform public.centralino_crea('{"canale":"telefono","tipo":"sopralluogo","cliente_nome":"X"}');
    raise exception 'sopralluogo senza urgenza: doveva fallire';
  exception when others then if sqlerrm not like 'Valuta l''urgenza%' then raise; end if; end;
  -- allarme sonoro: urgente anche senza scelta esplicita
  r := public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Allarme sonoro attivo","cliente_nome":"ZZ Condominio Prova","telefono":"0600000000","tacitazione_tentata":true}');
  pid := (r->>'id')::bigint;
  select urgenza = 'urgente' and stato_corrente = 'ricevuta' and sla_stadio = 'coordinatore' and appuntamento_data is null and numero ~ '^CT-\d{4}-\d{6}$' into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Allarme: urgenza/stadio/SLA errati'; end if;
  r := public.centralino_crea('{"canale":"telefono","tipo":"manutenzione","sottotipo":"Guasto","urgenza":"ordinario","cliente_nome":"ZZ Uffici Prova"}');
  if (select urgenza from public.pratiche where id = (r->>'id')::bigint) <> 'ordinario' then raise exception 'Urgenza ordinaria non salvata'; end if;
  -- soglia: 999,99 resta al centralino, 1.000 va al Tecnico Commerciale
  r := public.centralino_crea('{"canale":"tablet_tmq","tipo":"offerta","importo_stimato":999.99,"cliente_nome":"ZZ Bar Prova"}');
  if r->>'tipo' <> 'offerta_piccola' then raise exception 'Soglia 999,99: %', r; end if;
  begin
    perform public.centralino_crea('{"canale":"whatsapp","tipo":"offerta","importo_stimato":1000,"cliente_nome":"X"}');
    raise exception 'offerta da 1.000 senza commerciale: doveva fallire';
  exception when others then if sqlerrm not like 'Offerta da 1.000%' then raise; end if; end;
  r := public.centralino_crea('{"canale":"whatsapp","tipo":"offerta","importo_stimato":1000,"cliente_nome":"ZZ Ditta Prova","commerciale_nome":"A. Querini"}');
  pid2 := (r->>'id')::bigint;
  if r->>'tipo' <> 'offerta_grande' then raise exception 'Soglia 1000: %', r; end if;
  if not exists (select 1 from public.chiamate_trasferite where pratica_id = pid2 and modalita = 'richiamo' and destinatario_nome = 'A. Querini'
                 and richiamo_scadenza is not null) then raise exception 'Offerta da 1.000: richiamo 2 ore non creato'; end if;
  perform public.centralino_crea('{"canale":"email","tipo":"modifica","sottotipo":"Anagrafica","cliente_nome":"ZZ Studio Prova"}');
  perform public.centralino_chiamata_info('telefono', 'orari ufficio');

  -- intervento: coordinatore → tecnico → cliente → buono (ordine rigido, requisiti)
  begin perform public.centralino_avanza(pid, 'tecnico', '{"tecnico_nome":"ZZ Tecnico","tecnico_quando":"entro 1 ora"}'); raise exception 'salto di passo permesso';
  exception when others then if sqlerrm not like 'Si procede un passo alla volta%' then raise; end if; end;
  begin perform public.centralino_avanza(pid, 'coordinatore', '{"coordinatore_nome":"Alberto"}'); raise exception 'coordinatore senza telefonata/email permesso';
  exception when others then if sqlerrm not like 'Per «%» manca%' then raise; end if; end;
  begin perform public.centralino_chiudi(pid, 'chiusa_ok', null); raise exception 'chiusura anticipata permessa';
  exception when others then if sqlerrm not like 'Una pratica si chiude%' then raise; end if; end;
  perform public.centralino_invia_email(pid, 'intervento_coordinatore', 'alberto@prova.invalid', '{}', 'Intervento', '<p>x</p>', 'x', 'copia', null);
  perform public.centralino_avanza(pid, 'coordinatore', '{"coordinatore_nome":"Alberto","coordinatore_telefonato":true}');
  begin perform public.centralino_avanza(pid, 'tecnico', '{"tecnico_nome":"ZZ Tecnico"}'); raise exception 'tecnico senza «quando» permesso';
  exception when others then if sqlerrm not like 'Per «%» manca%' then raise; end if; end;
  begin perform public.centralino_avviso_tecnico(pid); raise exception 'avviso app senza tecnico permesso';
  exception when others then if sqlerrm not like 'Prima scegli il tecnico%' then raise; end if; end;
  perform public.centralino_avanza(pid, 'tecnico', '{"tecnico_nome":"ZZ Tecnico","tecnico_quando":"entro 1 ora"}');
  if (select assegnato_nome from public.pratiche where id = pid) <> 'ZZ Tecnico' then raise exception 'Tecnico non assegnato'; end if;
  begin perform public.centralino_avanza(pid, 'cliente'); raise exception 'cliente informato senza email permesso';
  exception when others then if sqlerrm not like 'Per «%» manca%' then raise; end if; end;
  perform public.centralino_invia_email(pid, 'intervento_cliente', 'cliente@prova.invalid', '{}', 'Intervento', '<p>x</p>', 'x', 'copia', 'cliente');
  begin perform public.centralino_avanza(pid, 'avviso', '{"documento_intervento":"DI-1","alert_taylor":true}'); raise exception 'buono senza WhatsApp permesso';
  exception when others then if sqlerrm not like 'Per «%» manca%' then raise; end if; end;
  perform public.centralino_avanza(pid, 'avviso', '{"documento_intervento":"DI-1","alert_taylor":true,"whatsapp_tecnico":true}');
  select esito = 'chiusa_ok' and alert_taylor and whatsapp_tecnico and coordinatore_telefonato and closed_at is not null into ok from public.pratiche where id = pid;
  if not ok then raise exception 'Chiusura automatica all''ultimo passo mancata'; end if;
  select count(*) into n from public.pratiche_eventi where pratica_id = pid;
  if n < 6 then raise exception 'Storia incompleta: % eventi', n; end if;
  -- offerta da 1.000: email al cliente, riepilogo al commerciale, poi chiusa (nessun esito)
  begin perform public.centralino_avanza(pid2, 'email_cliente'); raise exception 'email cliente non inviata: passo permesso';
  exception when others then if sqlerrm not like 'Per «%» manca%' then raise; end if; end;
  perform public.centralino_invia_email(pid2, 'presa_offerta_grande', 'cliente@prova.invalid', '{}', 'Presa', '<p>x</p>', 'x', 'copia', 'email_cliente');
  perform public.centralino_invia_email(pid2, 'riepilogo_commerciale', 'querini@prova.invalid', '{}', 'Riepilogo', '<p>x</p>', 'x', 'copia', 'riepilogo');
  if (select esito from public.pratiche where id = pid2) <> 'chiusa_ok' then raise exception 'Offerta da 1.000 non chiusa dopo il riepilogo'; end if;
  if exists (select 1 from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.attivo and (s->>'key' = 'esito' or s->'requisiti' ? 'esito')) then raise exception 'Passo «esito» ancora presente'; end if;
  -- email solo registrata (copia)
  pid2 := (select id from public.pratiche where cliente_nome = 'ZZ Uffici Prova');
  perform public.centralino_invia_email(pid2, 'conferma_intervento', 'cliente@prova.invalid', array['a@prova.invalid','non-valida'], 'Oggetto', '<p>x</p>', 'x', 'copia', null);
  if (select dati->'cc' from public.pratiche_eventi where pratica_id = pid2 and tipo = 'email_inviata' and dati->>'template' = 'conferma_intervento') <> '["a@prova.invalid"]'::jsonb then raise exception 'CC non filtrati'; end if;
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

-- Prove aggiuntive (trasferimenti, email al referente e al cliente, rubrica contatti, anagrafica clienti).
-- Esito atteso: ERROR «PROVE TRASFERIMENTI OK».
do $$
declare
  c uuid := gen_random_uuid(); d uuid := gen_random_uuid(); r jsonb; tid bigint; pid bigint; n int; cid bigint;
begin
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'zz_ct2_c@prova.invalid'),
    ('00000000-0000-0000-0000-000000000000', d, 'authenticated', 'authenticated', 'zz_ct2_d@prova.invalid');
  insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values
    (c, 'ZZ Centralino 2', 'zz_ct2_c@prova.invalid', 'responsabile', 'flotta', true, true, false),
    (d, 'ZZ Direzione 2', 'zz_ct2_d@prova.invalid', 'responsabile', 'flotta', true, false, true);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- «responsabile non disponibile»: richiamo con scadenza promessa
  r := public.centralino_trasferisci(jsonb_build_object('cliente_nome', 'ZZ Cliente', 'telefono', '06 1234567', 'destinatario_nome', 'L. Esposito',
         'modalita', 'richiamo', 'tipo_argomento', 'Offerta > 1.000 €', 'scadenza', now() + interval '2 hours', 'entro_testo', 'entro 2 ore'));
  tid := (r->>'id')::bigint;
  if (select richiamo_scadenza is null or esito <> 'richiamera' from public.chiamate_trasferite where id = tid) then raise exception 'Richiamo non registrato'; end if;
  -- email al referente: senza indirizzo bloccata con messaggio chiaro
  begin perform public.centralino_trasf_email_referente(tid, '', 'Ogg', '<p>x</p>', 'x', 'resend'); raise exception 'email referente senza indirizzo permessa';
  exception when others then if sqlerrm not like 'Aggiungi l''email di L. Esposito%' then raise; end if; end;
  perform public.centralino_trasf_email_referente(tid, 'esposito@prova.invalid', 'Chiamata trasferita', '<p>x</p>', 'x', 'copia');
  perform public.centralino_trasf_email(tid, 'riepilogo_richiamo', 'cliente@prova.invalid', '{}', 'Presa in carico', '<p>x</p>', 'x', 'copia');
  if (select email_referente_inviata_at is null or email_cliente_inviata_at is null from public.chiamate_trasferite where id = tid) then raise exception 'Email del trasferimento non registrate'; end if;
  -- richiamato
  perform public.centralino_richiamato(tid, 'Fissato sopralluogo');
  if (select richiamato_at is null or esito_richiamo <> 'Fissato sopralluogo' from public.chiamate_trasferite where id = tid) then raise exception 'Richiamato non registrato'; end if;

  -- rubrica: nuovo contatto da pratica, telefono +39, modifica con storia
  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Rubrica Srl","contatto_nome":"Sig.ra Neri","telefono":"06 555 1234","email":"neri@prova.invalid"}');
  pid := (r->>'id')::bigint;
  select id into cid from public.clienti_contatti where cliente_nome = 'ZZ Rubrica Srl';
  if cid is null or (select telefono from public.clienti_contatti where id = cid) <> '+39065551234' then raise exception 'Contatto non salvato/normalizzato'; end if;
  perform public.centralino_salva_contatto(jsonb_build_object('id', cid, 'telefono', '333 111 2222', 'motivo', 'Cambiato numero', 'pratica_id', pid));
  if not exists (select 1 from public.clienti_contatti_storia where contatto_id = cid and campo = 'telefono' and a = '+393331112222') then raise exception 'Storia contatto mancante'; end if;
  begin perform public.centralino_salva_contatto('{"cliente_nome":"X","email":"non-valida"}'); raise exception 'email non valida accettata';
  exception when others then if sqlerrm not like 'Email non valida%' then raise; end if; end;
  if (public.centralino_registro_giorno(null)->>'contatti_aggiornati')::int < 1 then raise exception 'Aggiornamento anagrafica non contato'; end if;

  -- anagrafica clienti: prova senza scrivere, poi import, protezione delle modifiche manuali
  r := public.centralino_importa_clienti('[{"cod_cliente":"ZZ001","nome":"ZZ Import Spa","telefono":"06 999 0000"},{"cod_cliente":"","nome":"senza codice"}]', 'prova.xlsx', true, false);
  if (r->>'nuovi')::int <> 1 or (r->>'errori')::int <> 1 or exists (select 1 from public.clienti where cod_cliente = 'ZZ001') then raise exception 'Prova import errata: %', r; end if;
  r := public.centralino_importa_clienti('[{"cod_cliente":"ZZ001","nome":"ZZ Import Spa","telefono":"06 999 0000"}]', 'vero.xlsx', false, false);
  perform public.centralino_aggiorna_cliente('ZZ001', '{"email":"manuale@prova.invalid"}', 'telefonata');
  r := public.centralino_importa_clienti('[{"cod_cliente":"ZZ001","nome":"ZZ Import Spa","email":"file@prova.invalid"}]', 'vecchio.xlsx', false, false);
  if (r->>'protetti')::int <> 1 or (select email from public.clienti where cod_cliente = 'ZZ001') <> 'manuale@prova.invalid' then raise exception 'Modifica manuale sovrascritta: %', r; end if;
  execute 'reset role';

  -- direzione legge, non scrive
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.clienti_contatti where cliente_nome = 'ZZ Rubrica Srl'; if n = 0 then raise exception 'Direzione non legge la rubrica'; end if;
  begin perform public.centralino_salva_contatto('{"cliente_nome":"X","telefono":"061234567"}'); raise exception 'Direzione scrive la rubrica';
  exception when insufficient_privilege then null; end;
  begin perform public.centralino_trasf_email_referente(tid, 'a@b.it', 'x', 'x', 'x', 'copia'); raise exception 'Direzione invia email';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  -- anon nulla
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin select count(*) into n from public.clienti_contatti; if n > 0 then raise exception 'Anon legge la rubrica'; end if;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  raise exception 'PROVE TRASFERIMENTI OK';
end $$;
