-- Revisione di sicurezza (16/10/2026) — applicata in 4 migrazioni: sicurezza_fix_trigger_segnalazione, sicurezza_limiti_tecnico, sicurezza_push_documenti, sicurezza_login
-- 1. BUG: segnalazioni "fermo"/"incidente" dal tecnico fallivano ("nome" ambiguo nel trigger)
-- 2. km: limite massimo assoluto anche con conferma
-- 3. segnalazioni: testo max 2000 caratteri, max 10 segnalazioni l'ora per tecnico
-- 4. push: solo endpoint dei servizi push ufficiali (no indirizzi arbitrari), max 5 dispositivi per tecnico
-- 5. documenti: il tecnico apre un documento solo se ha il QR di quel veicolo
-- 6. PIN: rifiutati PIN deboli (cifre ripetute o in sequenza)
-- 7. login: tempo di risposta uguale per codice esistente e inesistente

-- 1 ---------------------------------------------------------------------------
create or replace function public.tg_segnalazione_notifica() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.veicoli; v_nome text;
begin
  if TG_OP = 'INSERT' and (new.gravita = 'fermo' or new.categoria = 'incidente') then
    select * into v from public.veicoli where id = new.veicolo_id;
    select t.nome || ' ' || t.cognome into v_nome from public.tecnici t where t.id = new.tecnico_id;
    insert into public.notifiche (user_id, tipo, dati, link)
    select r.user_id, 'segnalazione_fermo',
      jsonb_build_object('targa', v.targa, 'categoria', new.categoria, 'gravita', new.gravita,
                         'descrizione', left(new.descrizione, 160), 'tecnico', v_nome),
      '/segnalazioni'
    from public.responsabili r;
  elsif TG_OP = 'UPDATE' and new.stato = 'chiusa' and old.stato <> 'chiusa' and new.tecnico_id is not null then
    select * into v from public.veicoli where id = new.veicolo_id;
    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values (new.tecnico_id, 'segnalazione_risolta',
      jsonb_build_object('targa', v.targa, 'categoria', new.categoria, 'nota', new.nota_chiusura), '/t');
  end if;
  return new;
end $$;

-- 2 ---------------------------------------------------------------------------
create or replace function public.tecnico_movimento(p_token text, p_qr text, p_tipo text, p_km integer,
  p_carburante text, p_note text, p_danni boolean, p_conferma_km boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli; ko text; altro text;
  nota text := left(nullif(trim(coalesce(p_note,'')),''), 500);
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso for update;
  if not found then raise exception 'Codice QR non riconosciuto.'; end if;
  if p_tipo not in ('presa','riconsegna','lettura_km') then raise exception 'Operazione non valida.'; end if;
  if p_carburante is not null and p_carburante not in ('riserva','1/4','1/2','3/4','pieno') then raise exception 'Livello carburante non valido.'; end if;
  if p_km is null or p_km < v.km_attuali then
    raise exception 'I km non possono essere inferiori all''ultima lettura (% km). Ricontrolla il cruscotto.', public.fmt_km(v.km_attuali);
  end if;
  if p_km > 1500000 or p_km - v.km_attuali > 20000 then
    raise exception 'Km non plausibili rispetto all''ultima lettura (% km). Contatta il responsabile flotta.', public.fmt_km(v.km_attuali);
  end if;
  if p_km - v.km_attuali > 1000 and not coalesce(p_conferma_km, false) then
    return jsonb_build_object('esito', 'conferma', 'messaggio',
      'Sono ' || public.fmt_km(p_km - v.km_attuali) || ' km in più dall''ultima lettura (' || public.fmt_km(v.km_attuali) || '). Se è corretto, conferma.');
  end if;

  if p_tipo = 'presa' then
    select string_agg(c.messaggio, '; ') into ko from public.controlli_veicolo(v.id) c where c.livello = 'ko';
    if ko is not null then raise exception 'Veicolo non utilizzabile: %. Contatta il responsabile flotta.', ko; end if;
    select string_agg(c.messaggio, '; ') into ko from public.controlli_tecnico(tid) c where c.livello = 'ko';
    if ko is not null then raise exception 'Non puoi prendere un veicolo: %. Contatta il responsabile flotta.', ko; end if;
    if v.tecnico_in_carico = tid then raise exception 'Il veicolo risulta già in carico a te.'; end if;
    select string_agg(x.targa, ', ') into altro from public.veicoli x where x.tecnico_in_carico = tid;
    if altro is not null then raise exception 'Hai già in carico %. Riconsegnalo prima di prendere un altro veicolo.', altro; end if;
    if v.tecnico_in_carico is not null then
      nota := concat_ws(' · ', 'Passaggio da ' || (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico), nota);
    end if;
    update public.veicoli set tecnico_in_carico = tid, in_carico_dal = now(), km_attuali = p_km where id = v.id;
  elsif p_tipo = 'riconsegna' then
    if v.tecnico_in_carico is distinct from tid then
      raise exception '%', case when v.tecnico_in_carico is null then 'Il veicolo risulta già in sede.'
        else 'Il veicolo risulta in carico a ' || (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico) || ', non a te.' end;
    end if;
    update public.veicoli set tecnico_in_carico = null, in_carico_dal = null, km_attuali = p_km where id = v.id;
  else
    if v.tecnico_in_carico is distinct from tid then raise exception 'Puoi aggiornare i km solo di un veicolo in carico a te.'; end if;
    update public.veicoli set km_attuali = p_km where id = v.id;
  end if;

  insert into public.movimenti (veicolo_id, tecnico_id, tipo, km, km_precedenti, carburante, danni_dichiarati, note, registrato_da)
  values (v.id, tid, p_tipo, p_km, v.km_attuali, p_carburante, coalesce(p_danni, false), nota, 'tecnico');

  return jsonb_build_object('esito', 'ok', 'messaggio',
    case p_tipo when 'presa' then 'Presa in carico registrata: ' || v.targa || ', ' || public.fmt_km(p_km) || ' km.'
                when 'riconsegna' then 'Riconsegna registrata: ' || v.targa || ', ' || public.fmt_km(p_km) || ' km. Grazie.'
                else 'Km aggiornati: ' || public.fmt_km(p_km) || '.' end
    || case when coalesce(p_danni,false) then ' Hai indicato danni: invia ora una segnalazione.' else '' end);
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.tecnico_segnalazione(p_token text, p_qr text, p_categoria text, p_gravita text, p_descrizione text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli; nid bigint;
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso;
  if not found then raise exception 'Codice QR non riconosciuto.'; end if;
  if length(trim(coalesce(p_descrizione,''))) < 5 then raise exception 'Descrivi il problema in poche parole.'; end if;
  if length(p_descrizione) > 2000 then raise exception 'Testo troppo lungo: massimo 2000 caratteri.'; end if;
  if (select count(*) from public.segnalazioni s where s.tecnico_id = tid and s.creato_il > now() - interval '1 hour') >= 10 then
    raise exception 'Hai inviato troppe segnalazioni in poco tempo. Chiama il responsabile flotta.';
  end if;
  insert into public.segnalazioni (veicolo_id, tecnico_id, categoria, gravita, descrizione)
  values (v.id, tid, p_categoria, p_gravita, trim(p_descrizione)) returning id into nid;
  return jsonb_build_object('esito', 'ok', 'id', nid, 'messaggio',
    case when p_gravita = 'fermo'
      then 'Segnalazione inviata. ' || v.targa || ' è fermo: non verrà assegnato finché il responsabile flotta non chiude la segnalazione.'
      else 'Segnalazione inviata al responsabile flotta.' end);
end $$;

-- 4 ---------------------------------------------------------------------------
create or replace function public._push_valida(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
  then raise exception 'Servizio di notifica non riconosciuto.'; end if;
  if coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 10 and 100 then
    raise exception 'Chiavi di notifica non valide.';
  end if;
end $$;

create or replace function public.tecnico_salva_push(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_lingua text)
returns void language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  perform public._push_valida(p_endpoint, p_p256dh, p_auth);
  if (select count(*) from public.push_iscrizioni where tecnico_id = tid and endpoint <> p_endpoint) >= 5 then
    raise exception 'Notifiche già attive su 5 dispositivi. Chiedi al responsabile flotta.';
  end if;
  insert into public.push_iscrizioni (tecnico_id, endpoint, p256dh, auth, lingua)
  values (tid, p_endpoint, p_p256dh, p_auth, case when p_lingua = 'ar' then 'ar' else 'it' end)
  on conflict (endpoint) do update set tecnico_id = excluded.tecnico_id, user_id = null, p256dh = excluded.p256dh, auth = excluded.auth, lingua = excluded.lingua, ultimo_errore = null;
end $$;

create or replace function public.responsabile_salva_push(p_endpoint text, p_p256dh text, p_auth text, p_lingua text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  perform public._push_valida(p_endpoint, p_p256dh, p_auth);
  insert into public.push_iscrizioni (user_id, endpoint, p256dh, auth, lingua)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, case when p_lingua = 'ar' then 'ar' else 'it' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, tecnico_id = null, p256dh = excluded.p256dh, auth = excluded.auth, lingua = excluded.lingua, ultimo_errore = null;
end $$;

-- 5 ---------------------------------------------------------------------------
-- la vecchia versione (senza QR) viene disattivata
create or replace function public.tecnico_percorso_documento(p_token text, p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
begin raise exception 'Aggiorna l''app per aprire i documenti.'; end $$;
revoke execute on function public.tecnico_percorso_documento(text, bigint) from public, anon, authenticated, service_role;

create or replace function public.tecnico_percorso_documento(p_token text, p_id bigint, p_qr text) returns text
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return (select d.path from public.documenti d join public.veicoli v on v.id = d.veicolo_id
          where d.id = p_id and v.qr_token = p_qr and not v.dismesso);
end $$;

-- 6 ---------------------------------------------------------------------------
create or replace function public.imposta_pin(p_tecnico bigint, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  if p_pin !~ '^[0-9]{6}$' then raise exception 'Il PIN deve avere 6 cifre'; end if;
  if (select count(distinct c) from regexp_split_to_table(p_pin, '') c) <= 2
     or position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then
    raise exception 'PIN troppo facile da indovinare: evita cifre ripetute o in sequenza';
  end if;
  update public.tecnici set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_tecnico;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_tecnico;
end $$;

-- 7 ---------------------------------------------------------------------------
create or replace function public.tecnico_login(p_codice text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tecnici; raw text;
begin
  select * into t from public.tecnici where codice = upper(trim(left(coalesce(p_codice,''), 20))) and attivo for update;
  if not found or t.pin_hash is null then
    perform extensions.crypt(left(coalesce(p_pin,''), 20), extensions.gen_salt('bf'));  -- stesso tempo di risposta
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  if t.bloccato_fino is not null and t.bloccato_fino > now() then
    return jsonb_build_object('ok', false, 'errore', 'Troppi tentativi errati. Riprova dopo le ' || to_char(t.bloccato_fino at time zone 'Europe/Rome', 'HH24:MI') || ' o chiedi al responsabile flotta.');
  end if;
  if t.pin_hash <> extensions.crypt(left(coalesce(p_pin,''), 20), t.pin_hash) then
    update public.tecnici set tentativi_falliti = tentativi_falliti + 1,
      bloccato_fino = case when tentativi_falliti + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = t.id;
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  update public.tecnici set tentativi_falliti = 0, bloccato_fino = null where id = t.id;
  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sessioni_tecnico (token_hash, tecnico_id, scade_il)
  values (encode(extensions.digest(raw, 'sha256'), 'hex'), t.id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', raw, 'nome', t.nome || ' ' || t.cognome);
end $$;

-- Permessi ---------------------------------------------------------------------
revoke execute on function public._push_valida(text, text, text), public.tecnico_percorso_documento(text, bigint, text),
  public.tecnico_movimento(text, text, text, integer, text, text, boolean, boolean), public.tecnico_segnalazione(text, text, text, text, text),
  public.tecnico_salva_push(text, text, text, text, text), public.responsabile_salva_push(text, text, text, text),
  public.imposta_pin(bigint, text), public.tecnico_login(text, text), public.tg_segnalazione_notifica() from public, anon, authenticated;
grant execute on function public.tecnico_percorso_documento(text, bigint, text) to service_role;
grant execute on function public.tecnico_movimento(text, text, text, integer, text, text, boolean, boolean), public.tecnico_segnalazione(text, text, text, text, text),
  public.tecnico_salva_push(text, text, text, text, text), public.tecnico_login(text, text) to anon, authenticated;
grant execute on function public.responsabile_salva_push(text, text, text, text), public.imposta_pin(bigint, text) to authenticated;
