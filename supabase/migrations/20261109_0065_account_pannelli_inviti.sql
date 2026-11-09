-- Account e ruoli: pannelli multipli per account, inviti con link sicuro, cambio password obbligatorio.
-- Non distruttiva: nuove colonne con valori ricavati dai dati esistenti; `area` resta (compatibilità) e si aggiorna da `hr`.

alter table public.responsabili add column if not exists flotta boolean not null default false;
alter table public.responsabili add column if not exists hr boolean not null default false;
alter table public.responsabili add column if not exists cambio_password boolean not null default false;
alter table public.responsabili add column if not exists invitato_il timestamptz;
alter table public.responsabili add column if not exists password_impostata_il timestamptz;

-- prima esecuzione: stessi permessi di prima
do $$ begin
  if not exists (select 1 from public.responsabili where flotta or hr) then
    update public.responsabili set
      hr = (area = 'hr'),
      flotta = (coalesce(area, 'flotta') = 'flotta' and not coalesce(formazione, false) and not coalesce(centralino, false) and not coalesce(direzione, false));
  end if;
end $$;

create or replace function public.is_responsabile() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.flotta)));
$$;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.hr)));
$$;

/** Pannelli di un account in un colpo solo (caselle). Admin = tutto. Registrato nel registro movimenti. */
create or replace function public.admin_imposta_pannelli(p_user uuid, p_admin boolean, p_flotta boolean, p_hr boolean,
  p_formazione boolean, p_centralino boolean, p_direzione boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare prima public.responsabili; dopo public.responsabili;
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if not (coalesce(p_admin, false) or coalesce(p_flotta, false) or coalesce(p_hr, false) or coalesce(p_formazione, false)
          or coalesce(p_centralino, false) or coalesce(p_direzione, false)) then
    raise exception 'Scegli almeno un pannello';
  end if;
  select * into prima from public.responsabili where user_id = p_user for update;
  if prima.user_id is null then raise exception 'Account non trovato'; end if;
  update public.responsabili set
    ruolo = case when p_admin then 'admin' else 'responsabile' end,
    flotta = coalesce(p_flotta, false), hr = coalesce(p_hr, false),
    area = case when coalesce(p_hr, false) then 'hr' else 'flotta' end,
    formazione = coalesce(p_formazione, false), centralino = coalesce(p_centralino, false), direzione = coalesce(p_direzione, false)
  where user_id = p_user returning * into dopo;
  insert into public.audit_log (tabella, record_id, azione, prima, dopo, utente)
  values ('account', p_user::text, 'PANNELLI',
    jsonb_build_object('ruolo', prima.ruolo, 'flotta', prima.flotta, 'hr', prima.hr, 'formazione', prima.formazione, 'centralino', prima.centralino, 'direzione', prima.direzione),
    jsonb_build_object('ruolo', dopo.ruolo, 'flotta', dopo.flotta, 'hr', dopo.hr, 'formazione', dopo.formazione, 'centralino', dopo.centralino, 'direzione', dopo.direzione),
    auth.uid());
end $$;
revoke all on function public.admin_imposta_pannelli(uuid, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_imposta_pannelli(uuid, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- ruolo unico (vecchia interfaccia): ora imposta anche flotta/hr
create or replace function public.admin_imposta_responsabile(p_user uuid, p_ruolo text, p_attivo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if p_ruolo not in ('admin', 'responsabile', 'hr', 'formazione', 'centralino', 'direzione') then raise exception 'Ruolo non valido'; end if;
  update public.responsabili
     set ruolo = case when p_ruolo = 'admin' then 'admin' else 'responsabile' end,
         flotta = p_ruolo = 'responsabile', hr = p_ruolo = 'hr',
         area = case when p_ruolo = 'hr' then 'hr' else 'flotta' end,
         formazione = (p_ruolo = 'formazione'),
         centralino = case when p_ruolo = 'centralino' then true when p_ruolo = 'hr' then centralino and hr else false end,
         direzione = (p_ruolo = 'direzione'),
         attivo = p_attivo
   where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
  insert into public.audit_log (tabella, record_id, azione, dopo, utente)
  values ('account', p_user::text, 'RUOLO', jsonb_build_object('ruolo', p_ruolo, 'attivo', p_attivo), auth.uid());
end $$;

create or replace function public.admin_imposta_centralino(p_user uuid, p_attivo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_admin();
  update public.responsabili set centralino = p_attivo where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
  insert into public.audit_log (tabella, record_id, azione, dopo, utente)
  values ('account', p_user::text, 'CENTRALINO', jsonb_build_object('centralino', p_attivo), auth.uid());
end $$;

/** L'utente ha scelto la sua password (dal link d'invito o dopo la password temporanea). */
create or replace function public.segna_password_impostata() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sessione non valida'; end if;
  update public.responsabili set cambio_password = false, password_impostata_il = now() where user_id = auth.uid();
  insert into public.audit_log (tabella, record_id, azione, dopo, utente)
  values ('account', auth.uid()::text, 'PASSWORD_IMPOSTATA', '{}'::jsonb, auth.uid());
end $$;
revoke all on function public.segna_password_impostata() from public, anon;
grant execute on function public.segna_password_impostata() to authenticated;

/** Avvia la coda email dalla funzione server (solo chiave di servizio). */
create or replace function public.email_avvia_coda() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role') then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
  perform privato.email_avvia();
end $$;
revoke all on function public.email_avvia_coda() from public, anon, authenticated;
grant execute on function public.email_avvia_coda() to service_role;
