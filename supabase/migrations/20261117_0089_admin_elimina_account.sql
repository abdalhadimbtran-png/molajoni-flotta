-- Eliminazione definitiva di un account dell'ufficio (azione «elimina» della funzione flotta).
-- Lo storico resta: i riferimenti (FK verso auth.users, tutti nullable) vengono messi a NULL;
-- si cancellano solo le cose personali (appunti, preferenze, iscrizioni push, notifiche).
-- La cancellazione dell'utente auth avviene dopo, nella funzione (auth.admin.deleteUser).
create or replace function public.admin_elimina_account(p_user uuid, p_autore uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r responsabili%rowtype; n_admin int;
begin
  if p_user is null or p_autore is null then raise exception 'Richiesta non valida'; end if;
  if p_user = p_autore then raise exception 'Non puoi eliminare il tuo stesso account'; end if;
  perform 1 from responsabili where user_id = p_autore and ruolo = 'admin' and attivo;
  if not found then raise exception 'Accesso riservato all''amministratore'; end if;
  -- blocco le righe admin per evitare due eliminazioni in parallelo
  perform 1 from responsabili where ruolo = 'admin' for update;
  select * into r from responsabili where user_id = p_user for update;
  if not found then raise exception 'Account non trovato'; end if;
  if r.ruolo = 'admin' and r.attivo then
    select count(*) into n_admin from responsabili where ruolo = 'admin' and attivo;
    if n_admin <= 1 then raise exception 'Non puoi eliminare l''ultimo amministratore attivo'; end if;
  end if;

  -- storico: riferimenti a NULL
  update movimenti set responsabile_id = null where responsabile_id = p_user;
  update segnalazioni set chiusa_da = null where chiusa_da = p_user;
  update assenze_manuali set annullata_da = null where annullata_da = p_user;
  update piani set confermato_da = null where confermato_da = p_user;
  update documenti set caricato_da = null where caricato_da = p_user;
  update rettifiche_saldo set autore = null where autore = p_user;
  update richieste_assenza set annullata_da_utente = null where annullata_da_utente = p_user;
  update richieste_assenza set creata_da_utente = null where creata_da_utente = p_user;
  update richieste_assenza set deciso_da = null where deciso_da = p_user;
  update referenti set user_id = null where user_id = p_user;

  -- cose personali
  delete from appunti where autore = p_user;
  delete from direzione_preferenze where user_id = p_user;
  delete from push_iscrizioni where user_id = p_user;
  delete from notifiche where user_id = p_user;

  delete from responsabili where user_id = p_user;

  insert into audit_log (tabella, record_id, azione, prima, dopo, utente)
  values ('account', p_user::text, 'ELIMINA',
    jsonb_build_object('nome', r.nome, 'email', r.email, 'ruolo', r.ruolo, 'dipendente_id', r.dipendente_id),
    jsonb_build_object('eliminato_il', now(), 'eliminato_da', p_autore), p_autore);
  return jsonb_build_object('nome', r.nome, 'email', r.email);
end $$;

revoke all on function public.admin_elimina_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_elimina_account(uuid, uuid) to service_role;
