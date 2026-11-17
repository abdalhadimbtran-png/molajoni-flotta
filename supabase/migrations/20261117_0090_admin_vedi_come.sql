-- «Vedi come»: registra nel registro movimenti quando l'amministratore apre la vista di un altro account.
-- Solo registrazione: nessun accesso, token o sessione per l'account visto.
create or replace function public.admin_vedi_come(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r responsabili%rowtype;
begin
  if not public.is_admin() then raise exception 'Accesso riservato all''amministratore'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'Richiesta non valida'; end if;
  select * into r from responsabili where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
  insert into audit_log (tabella, record_id, azione, dopo, utente)
  values ('account', p_user::text, 'VEDI_COME', jsonb_build_object('nome', r.nome, 'email', r.email, 'avviato_il', now()), auth.uid());
end $$;

revoke all on function public.admin_vedi_come(uuid) from public, anon;
grant execute on function public.admin_vedi_come(uuid) to authenticated;
