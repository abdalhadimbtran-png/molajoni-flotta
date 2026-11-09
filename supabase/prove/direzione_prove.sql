-- Prove area Direzione: blocco DO annullato alla fine (nessun dato resta).
-- Atteso: eccezione «PROVE DIREZIONE OK».
do $$
declare u uuid := gen_random_uuid(); a uuid := gen_random_uuid(); pid bigint; n int; ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (u, 'prova.direzione@example.invalid', 'authenticated', 'authenticated'),
                                                       (a, 'prova.centralino@example.invalid', 'authenticated', 'authenticated');
  insert into public.responsabili (user_id, nome, direzione) values (u, 'Prova Direzione', true);
  insert into public.responsabili (user_id, nome, centralino) values (a, 'Prova Centralino', true);
  insert into public.pratiche (canale, tipo, cliente_nome, telefono) values ('telefono', 'informazione', 'PROVA DIREZIONE', '+39 06 000') returning id into pid;
  insert into public.appunti (autore, chiave, testo) values (a, 'p:' || pid, 'segreto');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  if not public.is_direzione() then raise exception 'is_direzione falso'; end if;
  if public.is_centralino() then raise exception 'direzione non deve scrivere (is_centralino)'; end if;

  -- legge
  select count(*) into n from public.pratiche where id = pid; if n <> 1 then raise exception 'direzione non legge le pratiche'; end if;
  -- mai gli appunti
  select count(*) into n from public.appunti; if n <> 0 then raise exception 'direzione vede appunti'; end if;
  -- nessuna scrittura diretta
  update public.pratiche set cliente_nome = 'X' where id = pid; get diagnostics n = row_count; if n <> 0 then raise exception 'direzione modifica pratiche'; end if;
  delete from public.pratiche where id = pid; get diagnostics n = row_count; if n <> 0 then raise exception 'direzione cancella pratiche'; end if;
  ok := false; begin insert into public.pratiche (canale, tipo, cliente_nome) values ('telefono', 'informazione', 'X'); exception when others then ok := true; end;
  if not ok then raise exception 'direzione inserisce pratiche'; end if;
  ok := false; begin insert into public.pratiche_eventi (pratica_id, tipo) values (pid, 'nota'); exception when others then ok := true; end;
  if not ok then raise exception 'direzione scrive la storia'; end if;
  update public.chiamate_trasferite set richiamato_at = now(); get diagnostics n = row_count; if n <> 0 then raise exception 'direzione modifica trasferimenti'; end if;
  -- (gli appunti propri sono ammessi solo per chi è autore; la direzione non ha l'interfaccia: verifichiamo solo che non legga quelli altrui)
  -- RPC di scrittura del centralino rifiutate
  ok := false; begin perform public.centralino_nota(pid, 'nota', 'x', '{}'::jsonb); exception when others then ok := true; end;
  if not ok then raise exception 'direzione usa centralino_nota'; end if;
  ok := false; begin perform public.centralino_chiudi(pid, 'annullata', 'x'); exception when others then ok := true; end;
  if not ok then raise exception 'direzione annulla pratiche'; end if;
  -- preferenza digest (solo se la migrazione direzione_digest è applicata): solo via RPC, la tabella non è scrivibile
  if to_regclass('public.direzione_preferenze') is not null then
    perform public.direzione_digest_imposta(true);
    ok := false; begin insert into public.direzione_preferenze (user_id) values (a); exception when others then ok := true; end;
    if not ok then raise exception 'direzione_preferenze scrivibile direttamente'; end if;
  end if;

  -- anon: niente
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.pratiche; if n <> 0 then raise exception 'anon legge pratiche'; end if;

  raise exception 'PROVE DIREZIONE OK';
end $$;
