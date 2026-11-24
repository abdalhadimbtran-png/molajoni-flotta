-- Prove Centralino semplificato (0095). Blocco DO annullato: atteso ERROR «PROVE SEMPLICE OK».
do $$
declare
  c uuid := gen_random_uuid(); r jsonb; pid bigint; com text; com_email text; t text; n int;
  fatto text := '';
begin
  select x->>'nome', x->>'email' into com, com_email from jsonb_array_elements(privato.ct_commerciali()) x where coalesce(x->>'email', '') <> '' limit 1;
  if com is null then raise exception 'nessun Tecnico Commerciale con email nei Referenti'; end if;
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'zz_sem@prova.invalid');
  insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values (c, 'ZZ Centralino', 'zz_sem@prova.invalid', 'responsabile', 'flotta', true, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. Offerta gestita da Jennifer: email 1 (presa in carico) → email 2 (offerta) → chiusa
  r := public.centralino_crea('{"canale":"telefono","tipo":"offerta","gestione":"centralino","cliente_nome":"ZZ Off J","email":"zz_c@prova.invalid","descrizione":"10 estintori"}');
  pid := (r->>'id')::bigint;
  perform public.centralino_invia_email(pid, 'presa_offerta_piccola', 'zz_c@prova.invalid', '{}', 'PREVENTIVO – ZZ – CT', '<p>x</p>', 'x', 'outlook', null);
  perform public.centralino_avanza(pid, 'conferma', '{}');
  begin perform public.centralino_avanza(pid, 'offerta', '{}'); raise exception 'offerta senza email: doveva fallire';
  exception when others then if sqlerrm not like '%Email con l''offerta%' then raise; end if; end;
  perform public.centralino_invia_email(pid, 'invio_offerta', 'zz_c@prova.invalid', '{}', 'PREVENTIVO – ZZ – CT', '<p>x</p>', 'x', 'outlook', null);
  r := public.centralino_avanza(pid, 'offerta', '{}');
  if not (r->>'chiusa')::boolean or (select esito from public.pratiche where id = pid) <> 'chiusa_ok' then raise exception 'offerta J: non chiusa'; end if;
  fatto := fatto || 'offerta-J ';

  -- 2. Offerta Jennifer senza email cliente: email 1 per telefono ok, email 2 → messaggio chiaro
  r := public.centralino_crea('{"canale":"telefono","tipo":"offerta","gestione":"centralino","cliente_nome":"ZZ Off J senza email"}');
  pid := (r->>'id')::bigint;
  perform public.centralino_avvisato_telefono(pid, null, 'cliente', 'ZZ', 'presa_offerta_piccola', 'conferma');
  if (select stato_corrente from public.pratiche where id = pid) <> 'conferma' then raise exception 'telefono email 1: non avanzata'; end if;
  begin perform public.centralino_avvisato_telefono(pid, null, 'cliente', 'ZZ', 'invio_offerta', 'offerta'); raise exception 'offerta per telefono: doveva fallire';
  exception when others then if sqlerrm not like '%Email del cliente: l''offerta si invia solo per email%' then raise; end if; end;
  fatto := fatto || 'senza-email ';

  -- 3. Offerta al Tecnico Commerciale: 1 email interna → chiusa, nessun richiamo
  r := public.centralino_crea(jsonb_build_object('canale', 'telefono', 'tipo', 'offerta', 'gestione', 'commerciale', 'cliente_nome', 'ZZ Off C', 'commerciale_nome', com, 'descrizione', 'impianto'));
  pid := (r->>'id')::bigint;
  if exists (select 1 from public.chiamate_trasferite where pratica_id = pid) then raise exception 'commerciale: richiamo creato'; end if;
  perform public.centralino_invia_email(pid, 'riepilogo_commerciale', com_email, '{}', '[Centralino] Preventivo da gestire – CT – ZZ', '<p>x</p>', 'x', 'outlook', null);
  r := public.centralino_avanza(pid, 'riepilogo', '{}');
  if not (r->>'chiusa')::boolean then raise exception 'commerciale: non chiusa'; end if;
  -- variante «Avvisato per telefono»
  r := public.centralino_crea(jsonb_build_object('canale', 'telefono', 'tipo', 'offerta', 'gestione', 'commerciale', 'cliente_nome', 'ZZ Off C2', 'commerciale_nome', com));
  pid := (r->>'id')::bigint;
  perform public.centralino_avvisato_telefono(pid, null, 'commerciale', com, 'riepilogo_commerciale', 'riepilogo');
  if (select esito from public.pratiche where id = pid) <> 'chiusa_ok' then raise exception 'commerciale telefono: non chiusa'; end if;
  if exists (select 1 from public.chiamate_trasferite where pratica_id = pid) then raise exception 'commerciale 2: richiamo creato'; end if;
  fatto := fatto || 'offerta-C ';

  -- 4. Altri tipi: salva e chiudi · salva da seguire → chiudi
  foreach t in array array['manutenzione', 'sopralluogo', 'modifica', 'informazione'] loop
    r := public.centralino_crea(jsonb_build_object('canale', 'telefono', 'tipo', t, 'cliente_nome', 'ZZ ' || t, 'chiudi', true, 'assegnato_nome', 'Alberto'));
    pid := (r->>'id')::bigint;
    if (select esito from public.pratiche where id = pid) <> 'chiusa_ok' then raise exception '% chiudi: non chiusa', t; end if;
    if (select assegnato_nome from public.pratiche where id = pid) <> 'Alberto' then raise exception '% passata a: mancante', t; end if;
    if (select (urgenza is not null) <> (t = 'manutenzione') from public.pratiche where id = pid) then raise exception '% urgenza errata', t; end if;
    r := public.centralino_crea(jsonb_build_object('canale', 'telefono', 'tipo', t, 'cliente_nome', 'ZZ ' || t || ' segui'));
    pid := (r->>'id')::bigint;
    if (select esito <> 'aperta' or sla_scadenza is not null from public.pratiche where id = pid) then raise exception '% segui: stato/SLA errati', t; end if;
    perform public.centralino_chiudi_semplice(pid, null);
    if (select esito from public.pratiche where id = pid) <> 'chiusa_ok' then raise exception '% chiudi semplice: non chiusa', t; end if;
    fatto := fatto || t || ' ';
  end loop;
  select count(*) into n from public.pratiche_eventi where tipo = 'email_inviata' and pratica_id in (select id from public.pratiche where cliente_nome like 'ZZ manut%' or cliente_nome like 'ZZ sop%' or cliente_nome like 'ZZ mod%' or cliente_nome like 'ZZ info%');
  if n > 0 then raise exception 'email per tipi senza email'; end if;

  -- 5. Le offerte non si chiudono con «Chiudi» né con «Salva e chiudi»
  begin perform public.centralino_crea('{"canale":"telefono","tipo":"offerta","gestione":"centralino","cliente_nome":"ZZ X","chiudi":true}'); raise exception 'offerta chiudi: doveva fallire';
  exception when others then if sqlerrm not like '%si chiudono con l''email%' then raise; end if; end;

  raise exception 'PROVE SEMPLICE OK: %', fatto;
end $$;
