-- Prova (sempre annullata) di admin_elimina_account: da eseguire DOPO aver applicato
-- supabase/da_confermare/20261117_0089_admin_elimina_account.sql. Nessun dato reale toccato.
begin;
do $$
declare a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); u uuid := gen_random_uuid(); ok boolean;
begin
  insert into auth.users (id, email, aud, role) values (a1, 'prova-a1@test.invalid', 'authenticated', 'authenticated'),
    (a2, 'prova-a2@test.invalid', 'authenticated', 'authenticated'), (u, 'prova-u@test.invalid', 'authenticated', 'authenticated');
  -- tutti gli admin reali disattivati nella transazione: a1 è l'unico admin attivo
  update responsabili set attivo = false where ruolo = 'admin';
  insert into responsabili (user_id, nome, email, ruolo, attivo) values
    (a1, 'Prova Admin', 'prova-a1@test.invalid', 'admin', true),
    (a2, 'Prova Admin2', 'prova-a2@test.invalid', 'admin', false),
    (u, 'Prova Utente', 'prova-u@test.invalid', 'responsabile', true);
  insert into push_iscrizioni (user_id, endpoint, p256dh, auth) values (u, 'https://x.invalid/e', 'k', 'a');
  insert into notifiche (user_id, tipo, dati) values (u, 'avviso', '{}');

  begin perform admin_elimina_account(a1, a1); raise exception 'FALLITA: se stesso';
  exception when others then if sqlerrm not like '%tuo stesso%' then raise; end if; end;
  begin perform admin_elimina_account(u, a2); raise exception 'FALLITA: autore non attivo';
  exception when others then if sqlerrm not like '%riservato%' then raise; end if; end;
  begin perform admin_elimina_account(u, u); raise exception 'FALLITA: non admin';
  exception when others then if sqlerrm not like '%tuo stesso%' then raise; end if; end;
  -- a1 elimina l'admin disattivato a2 (consentito), poi l'utente u
  perform admin_elimina_account(a2, a1);
  perform admin_elimina_account(u, a1);
  select not exists (select 1 from responsabili where user_id = u)
     and not exists (select 1 from push_iscrizioni where user_id = u)
     and not exists (select 1 from notifiche where user_id = u)
     and exists (select 1 from audit_log where record_id = u::text and azione = 'ELIMINA' and prima->>'email' = 'prova-u@test.invalid')
    into ok;
  if not ok then raise exception 'FALLITA: pulizia'; end if;
  -- l'utente auth ora si cancella senza errori di FK
  delete from auth.users where id = u;
  raise notice 'elimina_account: tutte le prove superate';
end $$;
rollback;
