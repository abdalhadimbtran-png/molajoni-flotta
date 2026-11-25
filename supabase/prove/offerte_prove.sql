-- Prove ciclo offerte (0099) e report (0100). Blocco DO annullato: atteso ERROR «PROVE OFFERTE OK».
-- Sul database vero crea un utente centralino di prova (tutto annullato alla fine).
do $$
declare
  c uuid := gen_random_uuid(); ref text; pid bigint; o public.pratiche_offerta; r jsonb; n int; fatto text := '';
  procedure_err text;
begin
  -- 0. utente centralino di prova (solo se esistono le tabelle vere)
  if to_regclass('public.responsabili') is not null then
    execute 'insert into auth.users (instance_id, id, aud, role, email) values (''00000000-0000-0000-0000-000000000000'', $1, ''authenticated'', ''authenticated'', ''zz_off@prova.invalid'')' using c;
    execute 'insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values ($1, ''ZZ Centralino'', ''zz_off@prova.invalid'', ''responsabile'', ''flotta'', true, true, false)' using c;
    perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  end if;
  select nome into ref from public.referenti where attivo order by id limit 1;
  if ref is null then raise exception 'nessun referente attivo'; end if;

  -- 1. backfill: ogni pratica offerta ha la sua riga
  select count(*) into n from public.pratiche p where p.tipo like 'offerta%' and not exists (select 1 from public.pratiche_offerta x where x.pratica_id = p.id);
  if n > 0 then raise exception 'backfill: % offerte senza riga', n; end if;
  fatto := fatto || 'backfill ';

  -- 2. scadenze: Jennifer 60 min; colleghi 2 giorni lavorativi (weekend e festivi saltati, stessa ora)
  if public.offerta_scadenza('2026-11-25 10:00 Europe/Rome', 'jennifer') <> '2026-11-25 11:00 Europe/Rome'::timestamptz then raise exception 'scad jennifer'; end if;
  if public.offerta_scadenza('2026-11-25 10:00 Europe/Rome', 'collega') <> '2026-11-27 10:00 Europe/Rome'::timestamptz then raise exception 'scad mer→ven'; end if;
  if public.offerta_scadenza('2026-11-27 16:30 Europe/Rome', 'collega') <> '2026-12-01 16:30 Europe/Rome'::timestamptz then raise exception 'scad ven→mar (weekend)'; end if;
  if public.offerta_scadenza('2026-11-28 09:00 Europe/Rome', 'collega') <> '2026-12-01 09:00 Europe/Rome'::timestamptz then raise exception 'scad sab→mar'; end if;
  insert into public.festivita (data, nome, attiva) values ('2026-11-30', 'ZZ festa di prova', true);
  if public.offerta_scadenza('2026-11-27 16:30 Europe/Rome', 'collega') <> '2026-12-02 16:30 Europe/Rome'::timestamptz then raise exception 'scad con festivo'; end if;
  fatto := fatto || 'scadenze ';

  -- 3. offerta passata al collega: riga automatica, resta da inviare anche se la pratica del centralino è chiusa
  insert into public.pratiche (numero, canale, tipo, cliente_nome, descrizione, commerciale_nome, esito, stato_corrente, created_at)
  values ('ZZ-OFF-1', 'telefono', 'offerta_grande', 'ZZ Cliente', 'estintori', ref, 'aperta', 'ricevuta', now() - interval '3 days') returning id into pid;
  update public.pratiche set esito = 'chiusa_ok', closed_at = now() where id = pid;
  select * into o from public.pratiche_offerta where pratica_id = pid;
  if o.gestione <> 'collega' or o.gestita_da <> ref or o.esito <> 'da_inviare' or o.inviata_il is not null then raise exception 'collega: %', row_to_json(o); end if;
  fatto := fatto || 'riga ';

  -- 4. motivi obbligatori
  begin perform public.offerta_aggiorna(pid, '{"esito":"accettata"}'); raise exception 'X';
  exception when others then if sqlerrm not like '%inviata%' then raise exception 'accettata senza invio: %', sqlerrm; end if; end;
  begin perform public.offerta_aggiorna(pid, '{"esito":"annullata"}'); raise exception 'X';
  exception when others then if sqlerrm not like '%motivo%' then raise exception 'annullata senza motivo: %', sqlerrm; end if; end;
  begin perform public.offerta_aggiorna(pid, jsonb_build_object('arrivata_il', now() + interval '1 day')); raise exception 'X';
  exception when others then if sqlerrm not like '%futuro%' then raise exception 'arrivo futuro: %', sqlerrm; end if; end;
  begin perform public.offerta_aggiorna(pid, '{"gestita_da":"Nessuno ZZ"}'); raise exception 'X';
  exception when others then if sqlerrm not like '%referente%' then raise exception 'gestita_da: %', sqlerrm; end if; end;
  fatto := fatto || 'obbligatori ';

  -- 5. collega oltre la scadenza: nessun motivo di ritardo richiesto a Jennifer → in attesa; poi non accettata (Altro senza nota no, Prezzo sì)
  r := public.offerta_aggiorna(pid, jsonb_build_object('inviata_il', now() - interval '1 hour', 'numero_offerta_adhoc', 'OF-123'));
  if r->>'esito' <> 'in_attesa' or r->>'numero_offerta_adhoc' <> 'OF-123' then raise exception 'inviata: %', r; end if;
  begin perform public.offerta_aggiorna(pid, '{"esito":"non_accettata","motivo":"Altro"}'); raise exception 'X';
  exception when others then if sqlerrm not like '%nota%' then raise exception 'Altro senza nota: %', sqlerrm; end if; end;
  r := public.offerta_aggiorna(pid, '{"esito":"non_accettata","motivo":"Prezzo","motivo_nota":"troppo cara"}');
  if r->>'esito' <> 'non_accettata' or r->>'motivo' <> 'Prezzo' then raise exception 'non accettata: %', r; end if;
  select count(*) into n from public.pratiche_eventi where pratica_id = pid and tipo = 'offerta';
  if n <> 2 then raise exception 'eventi offerta: %', n; end if;
  fatto := fatto || 'esiti ';

  -- 6. note di aggiornamento
  begin perform public.offerta_nota(pid, '  '); raise exception 'X';
  exception when others then if sqlerrm not like '%aggiornamento%' then raise exception 'nota vuota: %', sqlerrm; end if; end;
  update public.pratiche_offerta set aggiornata_il = now() - interval '2 days' where pratica_id = pid;
  perform public.offerta_nota(pid, 'Sentito Luca: la manda domani');
  select * into o from public.pratiche_offerta where pratica_id = pid;
  if o.aggiornata_il < now() - interval '1 minute' then raise exception 'nota non aggiorna la data'; end if;
  fatto := fatto || 'note ';

  -- 7. offerta di Jennifer: chiusura pratica (email 2) = inviata, poi accettata
  insert into public.pratiche (numero, canale, tipo, cliente_nome, descrizione, esito, stato_corrente, created_at)
  values ('ZZ-OFF-2', 'email', 'offerta_piccola', 'ZZ Cliente 2', 'manichette', 'aperta', 'offerta', now() - interval '30 minutes') returning id into pid;
  update public.pratiche set esito = 'chiusa_ok', closed_at = now() where id = pid;
  select * into o from public.pratiche_offerta where pratica_id = pid;
  if o.gestione <> 'jennifer' or o.gestita_da <> 'Jennifer' or o.esito <> 'in_attesa' or o.inviata_il is null or o.inviata_il > o.scadenza then raise exception 'jennifer: %', row_to_json(o); end if;
  -- offerta di Jennifer inviata dopo i 60 minuti: motivo del ritardo obbligatorio
  begin perform public.offerta_aggiorna(pid, jsonb_build_object('inviata_il', now() - interval '1 minute', 'arrivata_il', now() - interval '3 hours')); raise exception 'X';
  exception when others then if sqlerrm not like '%ritardo%' then raise exception 'ritardo Jennifer senza motivo: %', sqlerrm; end if; end;
  r := public.offerta_aggiorna(pid, '{"esito":"accettata","importo":"350"}');
  if r->>'esito' <> 'accettata' or (select importo_stimato from public.pratiche where id = pid) <> 350 then raise exception 'accettata: %', r; end if;
  fatto := fatto || 'jennifer ';

  -- 8. pratica annullata al centralino → offerta annullata con motivo
  insert into public.pratiche (numero, canale, tipo, cliente_nome, esito, stato_corrente, created_at)
  values ('ZZ-OFF-3', 'telefono', 'offerta_piccola', 'ZZ Cliente 3', 'aperta', 'ricevuta', now()) returning id into pid;
  update public.pratiche set esito = 'annullata', closed_at = now() where id = pid;
  select * into o from public.pratiche_offerta where pratica_id = pid;
  if o.esito <> 'annullata' or o.motivo is null then raise exception 'annullata: %', row_to_json(o); end if;
  fatto := fatto || 'annullata ';

  -- 9. report: KPI offerte in testa
  if to_regproc('privato.report_sez_centralino') is not null and to_regproc('privato.offerte_periodo') is not null then
    r := privato.report_sez_centralino(now() - interval '7 days', now() + interval '1 minute');
    if r->'kpi'->0->>'label' <> 'Offerte arrivate' or (r->'kpi'->0->>'valore')::int < 3 then raise exception 'report: %', r->'kpi'; end if;
    if not exists (select 1 from jsonb_array_elements(r->'tabelle') t where t->>'titolo' = 'Offerte non accettate' and jsonb_array_length(t->'righe') >= 1) then raise exception 'report non accettate'; end if;
    fatto := fatto || 'report ';
  end if;

  -- 10. solo centralino
  if to_regclass('public.responsabili') is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  else perform set_config('test.ct', '0', true); end if;
  begin perform public.offerta_nota(pid, 'x'); raise exception 'X';
  exception when others then if sqlerrm not like '%centralino%' then raise exception 'permessi: %', sqlerrm; end if; end;
  fatto := fatto || 'permessi';

  raise exception 'PROVE OFFERTE OK (%)', fatto;
end $$;
