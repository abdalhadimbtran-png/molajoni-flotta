-- Prove «Informazione» con 3 esiti (0083). Blocco DO annullato: atteso ERROR «PROVE INFORMAZIONE OK».
do $$
declare
  c uuid := gen_random_uuid(); r jsonb; pid bigint; ok boolean; m text[];
  procedure_ok text := '';
begin
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'zz_inf@prova.invalid');
  insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values (c, 'ZZ Centralino', 'zz_inf@prova.invalid', 'responsabile', 'flotta', true, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. Risposto a voce: nessun requisito oltre l'esito, chiusa_ok
  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Info Voce"}');
  pid := (r->>'id')::bigint;
  begin perform public.centralino_avanza(pid, 'evasa', '{}'); raise exception 'senza esito: doveva fallire';
  exception when others then if sqlerrm not like '%Esito (a voce%' then raise; end if; end;
  perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"voce"}');
  r := public.centralino_avanza(pid, 'chiusa', '{}');
  select esito = 'chiusa_ok' into ok from public.pratiche where id = pid;
  if not ok or not (r->>'chiusa')::boolean then raise exception 'voce: non chiusa'; end if;
  if not exists (select 1 from public.pratiche_eventi where pratica_id = pid and tipo = 'stato' and dati->>'esito_info' = 'voce') then raise exception 'voce: evento mancante'; end if;
  procedure_ok := procedure_ok || 'voce ';

  -- 2. Risposto via email: senza email cliente → bloccato; con email ma senza invio → bloccato; con invio → ok
  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Info Senza Email"}');
  pid := (r->>'id')::bigint;
  begin perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"email"}'); raise exception 'email senza indirizzo: doveva fallire';
  exception when others then if sqlerrm not like '%Email del cliente%' then raise; end if; end;
  perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"voce"}');  -- si può passare a «a voce»
  procedure_ok := procedure_ok || 'email-mancante→voce ';

  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Info Email","email":"zz_cliente@prova.invalid"}');
  pid := (r->>'id')::bigint;
  begin perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"email"}'); raise exception 'email non inviata: doveva fallire';
  exception when others then if sqlerrm not like '%Email di risposta al cliente%' then raise; end if; end;
  perform public.centralino_invia_email(pid, 'risposta_informazione', 'zz_cliente@prova.invalid', '{}', 'RISPOSTA ALLA VOSTRA RICHIESTA DI INFORMAZIONI – X – CT', '<p>x</p>', 'x', 'outlook', null);
  perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"email"}');
  perform public.centralino_avanza(pid, 'chiusa', '{}');
  if (select esito from public.pratiche where id = pid) <> 'chiusa_ok' then raise exception 'email: non chiusa'; end if;
  procedure_ok := procedure_ok || 'email ';

  -- 3. Girata: serve il responsabile e l'email/telefonata al responsabile; nessun richiamo creato
  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Info Girata","email":"zz_cli2@prova.invalid"}');
  pid := (r->>'id')::bigint;
  begin perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"girata"}'); raise exception 'girata senza nome: doveva fallire';
  exception when others then if sqlerrm not like '%Responsabile a cui%' then raise; end if; end;
  begin perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"girata","assegnato_nome":"ZZ Luca"}'); raise exception 'girata senza avviso: doveva fallire';
  exception when others then if sqlerrm not like '%Email o telefonata al responsabile%' then raise; end if; end;
  -- un'email al cliente NON vale come avviso al responsabile
  perform public.centralino_invia_email(pid, 'girata_ufficio', 'zz_cli2@prova.invalid', '{}', 'RICHIESTA INOLTRATA – X', '<p>x</p>', 'x', 'outlook', null);
  begin perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"girata","assegnato_nome":"ZZ Luca"}'); raise exception 'girata con sola email cliente: doveva fallire';
  exception when others then if sqlerrm not like '%Email o telefonata al responsabile%' then raise; end if; end;
  perform public.centralino_invia_email(pid, 'girata_referente', 'zz_luca@prova.invalid', '{}', '[Centralino] Richiesta da gestire – CT', '<p>x</p>', 'x', 'outlook', null);
  perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"girata","assegnato_nome":"ZZ Luca"}');
  perform public.centralino_avanza(pid, 'chiusa', '{}');
  select esito = 'chiusa_ok' and assegnato_nome = 'ZZ Luca' into ok from public.pratiche where id = pid;
  if not ok then raise exception 'girata: non chiusa o referente non salvato'; end if;
  if exists (select 1 from public.chiamate_trasferite where pratica_id = pid) then raise exception 'girata: richiamo creato'; end if;
  procedure_ok := procedure_ok || 'girata-email ';

  -- 3b. Girata avvisata per telefono, cliente senza email
  r := public.centralino_crea('{"canale":"telefono","tipo":"informazione","cliente_nome":"ZZ Info Girata Tel"}');
  pid := (r->>'id')::bigint;
  perform public.centralino_avvisato_telefono(pid, null, 'referente', 'ZZ Antonella', 'girata_referente', null);
  perform public.centralino_avanza(pid, 'evasa', '{"esito_info":"girata","assegnato_nome":"ZZ Antonella"}');
  perform public.centralino_avanza(pid, 'chiusa', '{}');
  if (select count(*) from public.pratiche_eventi where pratica_id = pid and tipo = 'stato' and dati->>'esito_info' = 'girata' and dati->>'assegnato_nome' = 'ZZ Antonella') <> 1 then raise exception 'girata tel: evento'; end if;
  procedure_ok := procedure_ok || 'girata-telefono ';

  raise exception 'PROVE INFORMAZIONE OK: %', procedure_ok;
end $$;
