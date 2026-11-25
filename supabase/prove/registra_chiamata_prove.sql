-- Prove «Registra chiamata» (0098). Blocco DO annullato: atteso ERROR «PROVE REGISTRA OK».
do $$
declare
  c uuid := gen_random_uuid(); x uuid := gen_random_uuid(); r jsonb; pid bigint; ref text; q timestamptz := now() - interval '3 hours'; p public.pratiche; fatto text := '';
begin
  select nome into ref from public.referenti where attivo limit 1;
  if ref is null then raise exception 'nessun referente attivo'; end if;
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'zz_reg@prova.invalid'),
    ('00000000-0000-0000-0000-000000000000', x, 'authenticated', 'authenticated', 'zz_noreg@prova.invalid');
  insert into public.responsabili (user_id, nome, email, ruolo, area, attivo, centralino, direzione) values
    (c, 'ZZ Centralino', 'zz_reg@prova.invalid', 'responsabile', 'flotta', true, true, false),
    (x, 'ZZ Direzione', 'zz_noreg@prova.invalid', 'responsabile', 'flotta', true, false, true);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. gestita da me, cliente con codice → chiusa, orari = ora scelta, stato attivo, nessuno SLA
  r := public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'canale', 'whatsapp', 'tipo', 'informazione', 'esito', 'gestita',
        'cliente_codice', 'ZZ001', 'cliente_nome', 'ZZ Cliente', 'descrizione', 'orari ufficio'));
  select * into p from public.pratiche where id = (r->>'id')::bigint;
  if p.esito <> 'chiusa_ok' or p.created_at <> q or p.closed_at <> q or not p.registrata_dopo or p.inserito_il is null
     or p.sla_rispettato is not null or p.stato_cliente <> 'attivo' or p.assegnato_nome is not null or p.canale <> 'whatsapp' then raise exception 'gestita: %', row_to_json(p); end if;
  fatto := fatto || 'gestita ';
  -- 2. passata a referente; offerta → offerta_grande
  r := public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'tipo', 'offerta', 'esito', 'passata', 'passata_a', ref, 'cliente_nome', 'ZZ Cliente 2', 'descrizione', 'preventivo'));
  select * into p from public.pratiche where id = (r->>'id')::bigint;
  if p.tipo <> 'offerta_grande' or p.assegnato_nome <> ref or p.esito <> 'chiusa_ok' then raise exception 'passata: %', row_to_json(p); end if;
  begin perform public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'tipo', 'informazione', 'esito', 'passata', 'cliente_nome', 'ZZ', 'descrizione', 'x'));
    raise exception 'passata senza referente: doveva fallire';
  exception when others then if sqlerrm not like '%a chi è stata passata%' then raise; end if; end;
  fatto := fatto || 'passata ';
  -- 3. cliente sconosciuto: solo nome libero + telefono
  r := public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'tipo', 'manutenzione', 'esito', 'gestita', 'telefono', '3331234567', 'descrizione', 'guasto'));
  select * into p from public.pratiche where id = (r->>'id')::bigint;
  if p.cliente_nome <> '3331234567' or p.cliente_codice is not null then raise exception 'sconosciuto: %', row_to_json(p); end if;
  begin perform public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'tipo', 'informazione', 'esito', 'gestita', 'cliente_nome', 'ZZ', 'descrizione', ' '));
    raise exception 'senza cosa voleva: doveva fallire';
  exception when others then if sqlerrm not like '%cosa voleva%' then raise; end if; end;
  fatto := fatto || 'sconosciuto ';
  -- 4. futuro e più di 7 giorni rifiutati
  begin perform public.centralino_registra_chiamata(jsonb_build_object('quando', now() + interval '1 hour', 'tipo', 'informazione', 'esito', 'gestita', 'cliente_nome', 'ZZ', 'descrizione', 'x'));
    raise exception 'futuro: doveva fallire';
  exception when others then if sqlerrm not like '%futuro%' then raise; end if; end;
  begin perform public.centralino_registra_chiamata(jsonb_build_object('quando', now() - interval '8 days', 'tipo', 'informazione', 'esito', 'gestita', 'cliente_nome', 'ZZ', 'descrizione', 'x'));
    raise exception '8 giorni: doveva fallire';
  exception when others then if sqlerrm not like '%7 giorni%' then raise; end if; end;
  fatto := fatto || 'futuro ';
  -- 5. non centralino rifiutato
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin perform public.centralino_registra_chiamata(jsonb_build_object('quando', q, 'tipo', 'informazione', 'esito', 'gestita', 'cliente_nome', 'ZZ', 'descrizione', 'x'));
    raise exception 'non centralino: doveva fallire';
  exception when others then if sqlerrm not like '%riservato al centralino%' then raise; end if; end;
  fatto := fatto || 'non-centralino ';
  -- 6. anon senza permesso
  if has_function_privilege('anon', 'public.centralino_registra_chiamata(jsonb)', 'execute') then raise exception 'anon può eseguire'; end if;
  raise exception 'PROVE REGISTRA OK: %', fatto;
end $$;
