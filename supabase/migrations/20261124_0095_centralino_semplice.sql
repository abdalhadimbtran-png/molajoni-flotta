-- 0095 Centralino semplificato (24/11/2026, decisione di Hadi dopo una settimana d'uso).
-- Offerta gestita da Jennifer: 2 email al cliente (presa in carico 60 min, invio offerta) → chiusa.
-- Offerta al Tecnico Commerciale: 1 email interna di riepilogo (o telefonata) → chiusa. Nessun richiamo 2 ore.
-- Intervento, Sopralluogo, Modifiche, Informazione: nessuna email, nessun passo. «Salva e chiudi» o «Salva da seguire» → «Chiudi».
-- Solo UPDATE e CREATE OR REPLACE: nessuna tabella/colonna tolta, lo storico resta leggibile.

-- 1. Flussi
update public.pratiche_flussi set
  stadi = '[{"key":"ricevuta","nome":"Ricevuta"},{"key":"chiusa","nome":"Chiusa"}]'::jsonb,
  sla_sottotipi = '{}'::jsonb
 where tipo in ('manutenzione', 'sopralluogo', 'modifica', 'informazione');

update public.pratiche_flussi set stadi = '[
  {"key":"ricevuta","nome":"Ricevuta"},
  {"key":"conferma","nome":"Presa in carico (preventivo entro 60 minuti)","sla":{"da":"creazione","tipo":"minuti","valore":10},"template":"presa_offerta_piccola","requisiti":["email"]},
  {"key":"offerta","nome":"Offerta inviata","sla":{"da":"creazione","tipo":"minuti","valore":60},"template":"invio_offerta","requisiti":["email_inviata"]}
]'::jsonb where tipo = 'offerta_piccola';

update public.pratiche_flussi set stadi = '[
  {"key":"ricevuta","nome":"Ricevuta — Tecnico Commerciale scelto","requisiti":["commerciale"]},
  {"key":"riepilogo","nome":"Email al Tecnico Commerciale","sla":{"da":"creazione","tipo":"minuti","valore":15},"template":"riepilogo_commerciale","requisiti":["email"]}
]'::jsonb where tipo = 'offerta_grande';

-- 2. Modelli: restano solo i 3 delle offerte (+ preventivo_tmq del canale Tablet TMQ, ancora in uso)
update public.email_template set attivo = false
 where codice not in ('presa_offerta_piccola', 'invio_offerta', 'riepilogo_commerciale', 'preventivo_tmq') and attivo;

update public.email_template set
  oggetto = '[Centralino] Preventivo da gestire{rif_pratica} – {cliente}',
  titolo = 'Preventivo da gestire',
  corpo_html = '<p>Ciao {commerciale},</p><p>ti passo questa richiesta di preventivo: contatta tu il cliente. Da qui la pratica è tua.</p>',
  dati = '[["Numero pratica","{numero_pratica}"],["Cliente","{cliente}"],["Codice cliente","{codice_cliente}"],["Contatto","{contatto}"],["Telefono","{telefono}"],["Email","{email_cliente}"],["Indirizzo","{indirizzo}"],["Sede","{sede}"],["Cosa chiede","{descrizione}"]]'::jsonb
 where codice = 'riepilogo_commerciale';

-- 3. Requisito «email_inviata»: l'offerta si invia solo per email (niente telefonata)
create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb default '{}'::jsonb)
 returns text[] language plpgsql stable set search_path to ''
as $function$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text; email_fatta boolean; ass jsonb; esi text;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti', f.assegnazione into req, ass from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  email_fatta := exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                           and (e.tipo = 'email_inviata'
                                or (e.tipo = 'nota' and e.dati->>'canale' = 'telefono' and coalesce((e.dati->>'comunicazione')::boolean, false))));
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null then m := m || text 'Data dell''appuntamento'; end if;
    if r = 'urgenza' and coalesce(nullif(d->>'urgenza', ''), p.urgenza) is null then m := m || text 'Valutazione urgenza'; end if;
    if r = 'coordinatore' then
      if coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), p.coordinatore_nome) is null then m := m || text 'Coordinatore'; end if;
      if not (email_fatta or p.coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false)) then m := m || text 'Email o telefonata al coordinatore'; end if;
    end if;
    if r = 'tecnico' and coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), p.tecnico_nome) is null then m := m || text 'Tecnico'; end if;
    if r = 'verificato' and not coalesce((d->>'verificato')::boolean, false) then m := m || text 'Preventivo verificato'; end if;
    if r in ('buono', 'avviso') and not (p.alert_taylor or p.whatsapp_tecnico or p.avviso_app_at is not null
                             or coalesce((d->>'alert_taylor')::boolean, false) or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || text 'Avviso al tecnico (Taylor, WhatsApp o app)'; end if;
    if r = 'taylor' and not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || text 'Alert inviato su Taylor'; end if;
    if r = 'commerciale' then
      val := coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome);
      if val is null then m := m || text 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from jsonb_array_elements(privato.ct_commerciali()) x;
        if not (val = any (coalesce(com, '{}'))) then m := m || text 'Commerciale tra i Tecnici Commerciali per le offerte'; end if;
      end if;
    end if;
    if r = 'email' and not email_fatta then m := m || text 'Email (Invia email o «Avvisato per telefono»)'; end if;
    if r = 'email_inviata' then
      if nullif(btrim(coalesce(p.email, '')), '') is null then m := m || text 'Email del cliente: l''offerta si invia solo per email (aggiungila nei dati della pratica)';
      elsif not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata'
                           and e.id > coalesce((select max(x.id) from public.pratiche_eventi x where x.pratica_id = p_id and x.tipo in ('creata', 'stato')), 0)) then
        m := m || text 'Email con l''offerta'; end if;
    end if;
    if r = 'informato' and not (email_fatta or coalesce((d->>'informato_voce')::boolean, false) or nullif(btrim(coalesce(d->>'email_non_disponibile', '')), '') is not null) then
      m := m || text 'Email al cliente o «informato a voce»'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome, ass->>'nome') is null then m := m || text 'A chi è stata girata'; end if;
    if r = 'esito_info' then
      esi := d->>'esito_info';
      if esi is null or esi not in ('voce', 'email', 'girata') then m := m || text 'Esito (a voce, via email o girata)';
      elsif esi = 'email' then
        if nullif(btrim(coalesce(p.email, '')), '') is null then m := m || text 'Email del cliente (oppure «Risposto a voce»)';
        elsif not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                            and e.tipo = 'email_inviata' and e.dati->>'template' = 'risposta_informazione') then
          m := m || text 'Email di risposta al cliente'; end if;
      elsif esi = 'girata' then
        if nullif(btrim(coalesce(d->>'assegnato_nome', '')), '') is null then m := m || text 'Responsabile a cui è stata girata'; end if;
        if not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                         and ((e.tipo = 'email_inviata' and e.dati->>'template' = 'girata_referente')
                              or (e.tipo = 'nota' and e.dati->>'canale' = 'telefono' and e.dati->>'chi' = 'referente'))) then
          m := m || text 'Email o telefonata al responsabile'; end if;
      end if;
    end if;
  end loop;
  return m;
end $function$;

-- 4. Nuovo contatto: urgenza solo per Intervento; «chiudi» = salva e chiudi; nessun richiamo 2 ore
create or replace function public.centralino_crea(p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  f public.pratiche_flussi; v_anno int := extract(year from now() at time zone 'Europe/Rome')::int; k int; num text; nid bigint;
  v_tipo text := p->>'tipo'; v_sotto text := nullif(btrim(coalesce(p->>'sottotipo', '')), ''); urg boolean; imp numeric; v_urg text := nullif(p->>'urgenza', '');
  com jsonb; v_com text; v_com_email text; v_chiudi boolean := coalesce((p->>'chiudi')::boolean, false);
  v_nome text := nullif(btrim(coalesce(p->>'cliente_nome', '')), ''); v_tel text := nullif(btrim(coalesce(p->>'telefono', '')), '');
  v_pass text := nullif(btrim(coalesce(p->>'assegnato_nome', '')), '');
begin
  perform privato.richiedi_centralino();
  imp := nullif(p->>'importo_stimato', '')::numeric;
  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') then
    case coalesce(nullif(p->>'gestione', ''), case when v_tipo = 'offerta_grande' then 'commerciale' when v_tipo = 'offerta_piccola' then 'centralino' end)
      when 'centralino' then v_tipo := 'offerta_piccola';
      when 'commerciale' then v_tipo := 'offerta_grande';
      else raise exception 'Scegli chi gestisce l''offerta';
    end case;
  end if;
  select * into f from public.pratiche_flussi where tipo = v_tipo and attivo;
  if f.tipo is null then raise exception 'Tipo di richiesta non valido'; end if;
  if v_nome is null and v_tel is null then raise exception 'Indica il cliente o il telefono'; end if;
  if v_sotto is not null and cardinality(f.sottotipi) > 0 and not (v_sotto = any (f.sottotipi)) then v_sotto := null; end if;
  if v_tipo = 'manutenzione' then
    if v_sotto = 'Allarme sonoro attivo' and v_urg is null then v_urg := 'urgente'; end if;
    if v_urg is null then v_urg := 'ordinario'; end if;
    if v_urg not in ('urgente', 'ordinario') then raise exception 'Urgenza: Urgente o Ordinario'; end if;
  else v_urg := null;
  end if;
  if v_tipo = 'offerta_grande' then
    v_com := nullif(btrim(coalesce(p->>'commerciale_nome', '')), '');
    select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
    if com is null then raise exception 'Scegli il Tecnico Commerciale (vedi Referenti)'; end if;
    v_com_email := com->>'email';
  end if;
  if v_chiudi and v_tipo like 'offerta%' then raise exception 'Le offerte si chiudono con l''email'; end if;
  urg := v_urg = 'urgente';

  insert into privato.pratiche_contatori (anno, ultimo) values (v_anno, 1)
  on conflict (anno) do update set ultimo = privato.pratiche_contatori.ultimo + 1 returning ultimo into k;
  num := 'CT-' || v_anno || '-' || lpad(k::text, 6, '0');

  insert into public.pratiche (numero, canale, tipo, sottotipo, priorita, urgenza, cliente_codice, cliente_nome, sede, contatto_nome, telefono, email,
    indirizzo, cap, comune, descrizione, assegnato_ruolo, assegnato_nome, assegnato_dipendente_id, commerciale_nome, commerciale_email, tecnico_nome,
    importo_stimato, appuntamento_data, appuntamento_fascia, tacitazione_tentata, stato_cliente)
  values (num, coalesce(p->>'canale', 'telefono'), v_tipo, v_sotto, case when urg then 'urgente' else 'normale' end, v_urg,
    nullif(btrim(coalesce(p->>'cliente_codice', '')), ''), coalesce(v_nome, v_tel), nullif(btrim(coalesce(p->>'sede', '')), ''),
    nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), v_tel, nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
    nullif(btrim(coalesce(p->>'indirizzo', '')), ''), nullif(btrim(coalesce(p->>'cap', '')), ''), nullif(btrim(coalesce(p->>'comune', '')), ''),
    nullif(btrim(coalesce(p->>'descrizione', '')), ''),
    case when v_tipo = 'offerta_grande' then 'tecnico_commerciale' when v_pass is not null then 'responsabile' end,
    case when v_tipo = 'offerta_grande' then v_com else v_pass end,
    null, v_com, nullif(lower(v_com_email), ''), null,
    imp, null, null, coalesce((p->>'tacitazione_tentata')::boolean, false),
    nullif(p->>'stato_cliente', ''))
  returning id into nid;

  perform privato.ct_evento(nid, 'creata', null, 'ricevuta', p->>'descrizione',
    jsonb_build_object('canale', coalesce(p->>'canale', 'telefono'), 'tipo', v_tipo, 'sottotipo', v_sotto, 'urgenza', v_urg, 'passata_a', v_pass, 'da_seguire', not v_chiudi));
  perform privato.ct_prossimo_sla(nid, 1);
  if v_chiudi then perform privato.ct_chiudi(nid, 'chiusa_ok', 'Salvata e chiusa'); end if;
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo, 'chiusa', v_chiudi);
end $function$;

-- 5. «Chiudi» per le pratiche da seguire (tipi senza passi) e per quelle rimaste su passi tolti
create or replace function public.centralino_chiudi_semplice(p_id bigint, p_testo text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare p public.pratiche;
begin
  perform privato.richiedi_centralino();
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è già chiusa'; end if;
  if p.tipo in ('offerta_piccola', 'offerta_grande', 'offerta_tablet') and privato.ct_indice(p.tipo, p.stato_corrente) is not null then
    raise exception 'Le offerte si chiudono con l''email';
  end if;
  update public.pratiche set sla_stadio = null, sla_scadenza = null, sla_notificato = null where id = p_id;
  perform privato.ct_chiudi(p_id, 'chiusa_ok', coalesce(nullif(btrim(coalesce(p_testo, '')), ''), 'Chiusa'));
end $function$;
revoke all on function public.centralino_chiudi_semplice(bigint, text) from public, anon;
grant execute on function public.centralino_chiudi_semplice(bigint, text) to authenticated;

-- 6. Passaggio al commerciale dalla scheda: senza richiamo 2 ore
create or replace function public.centralino_passa_commerciale(p_id bigint, p_commerciale text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r public.pratiche; com jsonb; v_com text := nullif(btrim(coalesce(p_commerciale, '')), '');
begin
  perform privato.richiedi_centralino();
  select * into r from public.pratiche where id = p_id for update;
  if r.id is null then raise exception 'Pratica non trovata'; end if;
  if r.tipo <> 'offerta_piccola' then raise exception 'Solo le offerte gestite da Jennifer si possono passare al Tecnico Commerciale'; end if;
  if r.esito <> 'aperta' then raise exception 'La pratica non è aperta'; end if;
  select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
  if com is null then raise exception 'Scegli il Tecnico Commerciale (vedi Referenti)'; end if;
  update public.pratiche set tipo = 'offerta_grande', stato_corrente = 'ricevuta', assegnato_ruolo = 'tecnico_commerciale', assegnato_nome = v_com,
    commerciale_nome = v_com, commerciale_email = nullif(lower(com->>'email'), ''), updated_at = now()
   where id = p_id;
  perform privato.ct_evento(p_id, 'modifica', r.stato_corrente, 'ricevuta', 'Passata al Tecnico Commerciale ' || v_com,
    jsonb_build_object('da_tipo', 'offerta_piccola', 'a_tipo', 'offerta_grande', 'da_stato', r.stato_corrente, 'commerciale', v_com));
  perform privato.ct_prossimo_sla(p_id, 1);
  return jsonb_build_object('id', p_id, 'tipo', 'offerta_grande');
end $function$;

-- 7. Controllo SLA: allarmi solo per le offerte
create or replace function privato.centralino_controlla_sla()
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare p record; n int := 0; nomest text;
begin
  for p in select * from public.pratiche where esito = 'aperta' and tipo like 'offerta%' and sla_scadenza < now() and sla_notificato is distinct from sla_stadio for update skip locked loop
    select s->>'nome' into nomest from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p.sla_stadio;
    insert into public.pratiche_eventi (pratica_id, tipo, da_stato, a_stato, testo, dati, autore, autore_nome)
    values (p.id, 'sla_scaduto', p.stato_corrente, p.stato_corrente, 'Tempo scaduto per «' || coalesce(nomest, p.sla_stadio) || '»',
            jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza), null, 'Sistema');
    update public.pratiche set sla_notificato = sla_stadio, sla_rispettato = false where id = p.id;
    perform privato.ct_notifica('SLA scaduto · ' || p.numero, p.cliente_nome || ' — ' || coalesce(nomest, p.sla_stadio), '/centralino/pratica/' || p.id, 'ko');
    n := n + 1;
  end loop;
  for p in select * from public.chiamate_trasferite where richiamato_at is null and not promemoria_inviato and richiamo_scadenza > now()
            and richiamo_scadenza <= now() + interval '15 minutes' for update skip locked loop
    update public.chiamate_trasferite set promemoria_inviato = true where id = p.id;
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'warn', 'titolo', 'Tra poco: richiamare ' || coalesce(p.cliente_nome, p.telefono, 'il cliente'),
          'testo', concat_ws(' · ', p.argomento, p.telefono, 'entro ' || to_char(p.richiamo_scadenza at time zone 'Europe/Rome', 'HH24:MI'))), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  for p in select * from public.chiamate_trasferite where richiamato_at is null and richiamo_scadenza < now() and not richiamo_notificato for update skip locked loop
    update public.chiamate_trasferite set richiamo_notificato = true where id = p.id;
    if p.solo_commerciale then
      perform privato.ct_notifica_direzione('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
        p.destinatario_nome || ' non ha ancora richiamato (offerta del Tecnico Commerciale)' || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    else
      perform privato.ct_notifica('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
        p.destinatario_nome || ' non ha ancora richiamato' || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    end if;
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'ko', 'titolo', 'Richiamo scaduto: ' || coalesce(p.cliente_nome, p.telefono, 'cliente'), 'testo', p.argomento), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;
