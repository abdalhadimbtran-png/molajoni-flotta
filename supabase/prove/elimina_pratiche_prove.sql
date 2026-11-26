-- Prova (sempre annullata) di admin_elimina_pratiche: da eseguire DOPO aver applicato
-- supabase/da_confermare/20261126_0101_admin_elimina_pratiche.sql. Nessun dato reale toccato.
begin;
do $$
declare a uuid := gen_random_uuid(); u uuid := gen_random_uuid(); p1 bigint; p2 bigint; r jsonb; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (a, 'prova-a@test.invalid', 'authenticated', 'authenticated'),
    (u, 'prova-u@test.invalid', 'authenticated', 'authenticated');
  insert into responsabili (user_id, nome, email, ruolo, attivo) values
    (a, 'Prova Admin', 'prova-a@test.invalid', 'admin', true),
    (u, 'Prova Resp', 'prova-u@test.invalid', 'responsabile', true);
  insert into pratiche (numero, canale, tipo, cliente_nome, descrizione) values ('PROVA-1', 'telefono', 'informazione', 'Cliente Prova', 'x') returning id into p1;
  insert into pratiche (numero, canale, tipo, cliente_nome, descrizione) values ('PROVA-2', 'telefono', 'informazione', 'Cliente Prova', 'x') returning id into p2;
  insert into pratiche_eventi (pratica_id, tipo) values (p1, 'nota'), (p1, 'nota');
  insert into pratiche_allegati (pratica_id, path, nome_file) values (p1, 'prova/' || p1 || '/a.pdf', 'a.pdf');
  insert into appunti (chiave, testo, autore) values ('p:' || p1, 'appunto', a);
  insert into email_in_uscita (destinatario, oggetto, pratica_id) values ('x@test.invalid', 'o', p1);

  -- non admin: rifiutato
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin perform admin_elimina_pratiche(array[p1], 'Prova'); raise exception 'FALLITA: non admin';
  exception when others then if sqlerrm not like '%riservata%' then raise; end if; end;
  -- admin: oltre 200 rifiutato
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin perform admin_elimina_pratiche((select array_agg(g::bigint) from generate_series(1, 201) g), 'Prova'); raise exception 'FALLITA: limite';
  exception when others then if sqlerrm not like '%200%' then raise; end if; end;

  r := admin_elimina_pratiche(array[p1, p2, p1], null);
  select (r->>'eliminate')::int = 2 and jsonb_array_length(r->'paths') = 1
     and not exists (select 1 from pratiche where id in (p1, p2))
     and not exists (select 1 from pratiche_eventi where pratica_id = p1)
     and not exists (select 1 from appunti where chiave = 'p:' || p1)
     and exists (select 1 from email_in_uscita where oggetto = 'o' and destinatario = 'x@test.invalid' and pratica_id is null)
     and (select count(*) from audit_log where tabella = 'pratiche' and azione = 'ELIMINA' and record_id in (p1::text, p2::text)) = 2
     and (select prima->>'eventi' from audit_log where record_id = p1::text and azione = 'ELIMINA' and tabella = 'pratiche') = '2'
     and (select dopo->>'motivo' from audit_log where record_id = p1::text and azione = 'ELIMINA' and tabella = 'pratiche') = 'Prova'
    into ok;
  if not ok then raise exception 'FALLITA: pulizia %', r; end if;
  -- la storia resta bloccata fuori dall'eliminazione
  if current_setting('privato.azzera', true) = 'on' then raise exception 'FALLITA: bypass rimasto attivo'; end if;
  raise notice 'elimina_pratiche: tutte le prove superate (%)', r;
end $$;
rollback;
