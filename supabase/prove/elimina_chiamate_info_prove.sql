-- Prove 0103 (eseguire in blocco annullato).
begin;
-- 1) non admin → 42501
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
do $$ begin
  perform public.admin_elimina_chiamate_info(array[1]::bigint[], 'x');
  raise exception 'ERRORE: non admin ha potuto eliminare';
exception when insufficient_privilege then raise notice 'OK: non admin rifiutato';
end $$;
reset role;
-- 2) admin: sostituire con l'uuid di un admin reale
-- select set_config('request.jwt.claims', '{"sub":"<uuid-admin>","role":"authenticated"}', true);
-- insert into public.centralino_chiamate_info (canale, nota, autore_nome) values ('telefono','PROVA 0103','test') returning id;
-- select public.admin_elimina_chiamate_info(array[<id>]::bigint[], 'Prova');            -- {"eliminate":1}
-- select * from public.audit_log where tabella='centralino_chiamate_info' order by id desc limit 1; -- istantanea + motivo
-- select public.admin_elimina_chiamate_info('{}'::bigint[], null);                     -- {"eliminate":0}
-- select public.admin_elimina_chiamate_info(array(select generate_series(1,201))::bigint[]); -- 22023
-- 3) anon senza execute
select has_function_privilege('anon', 'public.admin_elimina_chiamate_info(bigint[], text)', 'execute') as anon_puo; -- false
rollback;
