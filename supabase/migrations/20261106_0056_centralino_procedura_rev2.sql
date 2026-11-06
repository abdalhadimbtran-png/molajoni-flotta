-- 0056 Procedura rivista (titolare + direzione, 06/11/2026). Non distruttiva.
-- A) Intervento: niente appuntamento al primo contatto; urgenza → coordinatore (email + telefonata, 10 min) → tecnico individuato
--    e quando (45 min) → cliente informato (email, 60 min: «entro 1 ora la ricontattiamo») → buono + Taylor + WhatsApp (chiude).
-- B) Sopralluogo: stesso schema (coordinatore sopralluoghi, cliente informato con cc al commerciale, avviso inviato).
-- C) Offerta ≥ 1.000 €: email al cliente (10 min) → email di riepilogo al Tecnico Commerciale (15 min) → chiusa per Jennifer;
--    resta sempre il richiamo di 2 ore assegnato al commerciale (campanella ed escalation).
-- Niente più «esito» nelle pratiche: si chiudono con l'ultimo passo o si annullano con motivo.

-- 1. Colonne -----------------------------------------------------------------------------
alter table public.pratiche add column if not exists urgenza text check (urgenza is null or urgenza in ('urgente', 'ordinario'));
alter table public.pratiche add column if not exists coordinatore_nome text;
alter table public.pratiche add column if not exists coordinatore_telefonato boolean not null default false;
alter table public.pratiche add column if not exists tecnico_dipendente_id bigint references public.dipendenti(id);
alter table public.pratiche add column if not exists tecnico_quando text;
alter table public.pratiche add column if not exists tecnico_quando_at timestamptz;
alter table public.pratiche add column if not exists whatsapp_tecnico boolean not null default false;
alter table public.pratiche add column if not exists avviso_app_at timestamptz;
comment on column public.pratiche.urgenza is 'Valutazione al primo contatto: urgente = intervento oggi, ordinario = entro 2 giorni lavorativi (obiettivo informativo).';

-- coordinatori (il CHECK su referenti.responsabilita non si cambia senza DROP → colonne booleane)
alter table public.referenti add column if not exists coordina_interventi boolean not null default false;
alter table public.referenti add column if not exists coordina_sopralluoghi boolean not null default false;
comment on column public.referenti.coordina_interventi is 'Coordinamento interventi: riceve email e telefonata per ogni intervento (in ordine, il primo disponibile).';
insert into public.referenti (nome, ruolo, coordina_interventi, coordina_sopralluoghi, note, ordine)
values ('Alberto', 'Coordinatore interventi', true, true, 'Primo coordinatore: se non è disponibile, il successivo in elenco', 5)
on conflict (nome) do update set coordina_interventi = true;

-- 2. Flussi -------------------------------------------------------------------------------
update public.pratiche_flussi set stadi = '[
  {"key":"ricevuta","nome":"Ricevuta — urgenza valutata"},
  {"key":"coordinatore","nome":"Inviato al coordinatore interventi (email + telefonata)","template":"intervento_coordinatore","requisiti":["coordinatore","email"],"sla":{"tipo":"minuti","valore":10,"da":"creazione"}},
  {"key":"tecnico","nome":"Tecnico individuato","requisiti":["tecnico"],"sla":{"tipo":"minuti","valore":45,"da":"creazione"}},
  {"key":"cliente","nome":"Cliente informato (email)","template":"intervento_cliente","requisiti":["email"],"sla":{"tipo":"minuti","valore":60,"da":"creazione"}},
  {"key":"avviso","nome":"Buono creato e tecnico avvisato","requisiti":["buono"]}]',
  sla_sottotipi = '{}',
  nota_procedura = 'Non si dà l''appuntamento al primo contatto: valuta l''urgenza (urgente = oggi, ordinario = entro 2 giorni lavorativi) e di'' al cliente «Entro 1 ora la ricontattiamo per confermarle l''appuntamento». Allarme sonoro: prova la tacitazione al telefono.'
 where tipo = 'manutenzione';
update public.pratiche_flussi set stadi = '[
  {"key":"ricevuta","nome":"Ricevuta — urgenza valutata"},
  {"key":"coordinatore","nome":"Inviato al coordinatore sopralluoghi (email + telefonata)","template":"sopralluogo_coordinatore","requisiti":["coordinatore","email"],"sla":{"tipo":"minuti","valore":10,"da":"creazione"}},
  {"key":"tecnico","nome":"Tecnico / commerciale individuato","requisiti":["tecnico"],"sla":{"tipo":"minuti","valore":45,"da":"creazione"}},
  {"key":"cliente","nome":"Cliente informato (email, cc commerciale)","template":"sopralluogo_cliente","requisiti":["email"],"sla":{"tipo":"minuti","valore":60,"da":"creazione"}},
  {"key":"avviso","nome":"Avviso inviato (Taylor / WhatsApp)","requisiti":["avviso"]}]',
  nota_procedura = 'Sopralluogo urgente (oggi) o entro 2 giorni. Di'' al cliente «Entro 1 ora la ricontattiamo per confermarle l''appuntamento».'
 where tipo = 'sopralluogo';
update public.pratiche_flussi set nome = 'Offerta da 1.000 €', stadi = '[
  {"key":"ricevuta","nome":"Ricevuta — assegnata al Tecnico Commerciale disponibile","requisiti":["commerciale"]},
  {"key":"email_cliente","nome":"Email al cliente («entro 2 ore la contatterà…»)","template":"presa_offerta_grande","requisiti":["email"],"sla":{"tipo":"minuti","valore":10,"da":"creazione"}},
  {"key":"riepilogo","nome":"Email di riepilogo al Tecnico Commerciale","template":"riepilogo_commerciale","requisiti":["email"],"sla":{"tipo":"minuti","valore":15,"da":"creazione"}}]',
  nota_procedura = 'Da 1.000 € in su: la fa il Tecnico Commerciale (L. Esposito, A. Chiaradonna, A. Querini — chi è disponibile). Email al cliente entro 10 minuti, riepilogo al commerciale entro 15. Il commerciale ha 2 ore per chiamare il cliente.'
 where tipo = 'offerta_grande';
update public.pratiche_flussi set nome = 'Offerta fino a 999,99 €' where tipo = 'offerta_piccola';

-- 3. Disponibilità di coordinatori / persone per responsabilità ------------------------------------
create or replace function privato.ct_persone(p_quali text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'nome', x.nome, 'email', x.email, 'telefono', x.telefono, 'cellulare', x.cellulare, 'account', u.user_id is not null,
      'assente', coalesce(a.assente, false), 'occupato', coalesce(not d.disponibile, false),
      'disponibile', x.attivo and coalesce(d.disponibile, true) and not coalesce(a.assente, false)) order by x.ordine, x.nome), '[]'::jsonb)
    from public.referenti x
    left join lateral (select r.user_id, r.dipendente_id from public.responsabili r left join auth.users au on au.id = r.user_id
                        where x.email is not null and r.attivo and (lower(r.email) = x.email or lower(au.email) = x.email) limit 1) u on true
    left join lateral (select true as assente from public.assenze s where s.tecnico_id = u.dipendente_id and (now() at time zone 'Europe/Rome')::date between s.dal and s.al limit 1) a on true
    left join public.centralino_disponibilita d on d.nome = x.nome
   where x.attivo and case p_quali
     when 'coord_interventi' then x.coordina_interventi
     when 'coord_sopralluoghi' then x.coordina_sopralluoghi or (not exists (select 1 from public.referenti y where y.attivo and y.coordina_sopralluoghi) and 'sopralluoghi' = any (x.responsabilita))
     else p_quali = any (x.responsabilita) end;
$$;

create or replace function public.centralino_coordinatori(p_tipo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return privato.ct_persone(case when p_tipo = 'sopralluogo' then 'coord_sopralluoghi' else 'coord_interventi' end);
end $$;

-- commerciali delle offerte da 1.000 €: da referenti (stessa forma di prima)
create or replace function privato.ct_commerciali() returns jsonb
language sql stable security definer set search_path = '' as $$ select privato.ct_persone('offerte_grandi'); $$;

-- tecnici attivi con disponibilità: assenti oggi e interventi del giorno
create or replace function public.centralino_tecnici() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.cognome || ' ' || d.nome, 'telefono', d.telefono,
      'assente', exists (select 1 from public.assenze s where s.tecnico_id = d.id and oggi between s.dal and s.al),
      'interventi_oggi', (select count(*) from public.interventi i where i.tecnico_id = d.id and i.data = oggi)) order by d.cognome, d.nome)
    from public.dipendenti d where d.attivo and d.categoria = 'TEC'), '[]'::jsonb);
end $$;

-- 4. Requisiti dei passi -----------------------------------------------------------------------
create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb default '{}') returns text[]
language plpgsql stable set search_path = '' as $$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti' into req from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and (coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null
                               or coalesce(nullif(d->>'appuntamento_fascia', ''), p.appuntamento_fascia) is null) then m := m || 'Data e fascia (mattina/pomeriggio)'; end if;
    if r = 'urgenza' and coalesce(nullif(d->>'urgenza', ''), p.urgenza) is null then m := m || 'Valutazione urgenza'; end if;
    if r = 'coordinatore' then
      if coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), p.coordinatore_nome) is null then m := m || 'Coordinatore'; end if;
      if not (p.coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false)) then m := m || 'Telefonato al coordinatore'; end if;
    end if;
    if r = 'tecnico' then
      if coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), p.tecnico_nome) is null then m := m || 'Tecnico'; end if;
      if coalesce(nullif(btrim(coalesce(d->>'tecnico_quando', '')), ''), p.tecnico_quando) is null and coalesce(nullif(d->>'tecnico_quando_at', ''), p.tecnico_quando_at::text) is null then m := m || 'Quando contatta / arriva'; end if;
    end if;
    if r = 'buono' then
      if coalesce(nullif(btrim(coalesce(d->>'documento_intervento', '')), ''), p.documento_intervento) is null then m := m || 'Numero del buono / Documento di Intervento'; end if;
      if not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || 'Alert Taylor inviato'; end if;
      if not (p.whatsapp_tecnico or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || 'WhatsApp inviato al tecnico'; end if;
    end if;
    if r = 'avviso' and not (p.alert_taylor or p.whatsapp_tecnico or p.avviso_app_at is not null
                             or coalesce((d->>'alert_taylor')::boolean, false) or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || 'Avviso (alert Taylor o WhatsApp)'; end if;
    if r = 'taylor' then
      if not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || 'Alert inviato su Taylor'; end if;
      if coalesce(nullif(btrim(coalesce(d->>'documento_intervento', '')), ''), p.documento_intervento) is null then m := m || 'Numero del Documento di Intervento'; end if;
    end if;
    if r = 'commerciale' then
      val := coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome);
      if val is null then m := m || 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from jsonb_array_elements(privato.ct_commerciali()) x;
        if not (val = any (coalesce(com, '{}'))) then m := m || 'Commerciale tra i Tecnici Commerciali delle offerte da 1.000 €'; end if;
      end if;
    end if;
    if r = 'email' and not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata' and e.at >= coalesce(dal, p.created_at)) then
      m := m || 'Email (Invia email)'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome) is null then m := m || 'A chi è stata girata'; end if;
  end loop;
  return m;
end $$;

-- 5. Avanzamento (stesse regole, nuovi campi) --------------------------------------------------------
create or replace function public.centralino_avanza(p_id bigint, p_stadio text, p_dati jsonb default '{}', p_testo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche; idx int; idx_sla int; risp boolean; d jsonb := coalesce(p_dati, '{}'::jsonb); ultimo text; m text[]; prossimo text; tid bigint;
begin
  perform privato.richiedi_centralino();
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è chiusa'; end if;
  idx := privato.ct_indice(p.tipo, p_stadio);
  if idx is null then raise exception 'Stadio non valido per questo tipo di pratica'; end if;
  if idx <> privato.ct_indice(p.tipo, p.stato_corrente) + 1 then
    select f.stadi -> privato.ct_indice(p.tipo, p.stato_corrente) ->> 'nome' into prossimo from public.pratiche_flussi f where f.tipo = p.tipo;
    raise exception 'Si procede un passo alla volta: il prossimo è «%»', prossimo;
  end if;
  m := privato.ct_mancanti(p_id, p_stadio, d);
  if array_length(m, 1) > 0 then raise exception 'Per «%» manca: %', (select s->>'nome' from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio), array_to_string(m, ', '); end if;
  if p.sla_stadio is not null then
    idx_sla := privato.ct_indice(p.tipo, p.sla_stadio);
    if idx >= idx_sla then
      risp := now() <= p.sla_scadenza;
      d := d || jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza, 'sla_rispettato', risp);
    end if;
  end if;
  tid := nullif(d->>'tecnico_dipendente_id', '')::bigint;
  update public.pratiche set
    stato_corrente = p_stadio, updated_at = now(),
    appuntamento_data = coalesce(nullif(d->>'appuntamento_data', '')::date, appuntamento_data),
    appuntamento_fascia = coalesce(nullif(d->>'appuntamento_fascia', ''), appuntamento_fascia),
    alert_taylor = alert_taylor or coalesce((d->>'alert_taylor')::boolean, false),
    whatsapp_tecnico = whatsapp_tecnico or coalesce((d->>'whatsapp_tecnico')::boolean, false),
    documento_intervento = coalesce(nullif(btrim(coalesce(d->>'documento_intervento', '')), ''), documento_intervento),
    coordinatore_nome = coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), coordinatore_nome),
    coordinatore_telefonato = coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false),
    tecnico_nome = coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), tecnico_nome),
    tecnico_dipendente_id = coalesce(tid, tecnico_dipendente_id),
    assegnato_dipendente_id = coalesce(tid, assegnato_dipendente_id),
    assegnato_nome = coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), assegnato_nome),
    tecnico_quando = coalesce(nullif(btrim(coalesce(d->>'tecnico_quando', '')), ''), tecnico_quando),
    tecnico_quando_at = coalesce(nullif(d->>'tecnico_quando_at', '')::timestamptz, tecnico_quando_at),
    commerciale_nome = coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), commerciale_nome),
    commerciale_email = coalesce(nullif(lower(btrim(coalesce(d->>'commerciale_email', ''))), ''), commerciale_email),
    sla_rispettato = case when risp is false then false else sla_rispettato end
   where id = p_id;
  perform privato.ct_evento(p_id, 'stato', p.stato_corrente, p_stadio, p_testo, d);
  if idx_sla is not null and idx >= idx_sla then perform privato.ct_prossimo_sla(p_id, idx);
  elsif p.sla_stadio is null then perform privato.ct_prossimo_sla(p_id, idx); end if;
  ultimo := privato.ct_ultimo(p.tipo);
  if p_stadio = ultimo then perform privato.ct_chiudi(p_id, 'chiusa_ok', null); end if;
  return jsonb_build_object('id', p_id, 'stato', p_stadio, 'chiusa', p_stadio = ultimo);
end $$;

-- 6. Creazione ------------------------------------------------------------------------------------
create or replace function public.centralino_crea(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.pratiche_flussi; v_anno int := extract(year from now() at time zone 'Europe/Rome')::int; k int; num text; nid bigint;
  v_tipo text := p->>'tipo'; v_sotto text := nullif(btrim(coalesce(p->>'sottotipo', '')), ''); urg boolean; imp numeric; v_urg text := nullif(p->>'urgenza', '');
  com jsonb; v_com text; v_com_email text; nessuno boolean := coalesce((p->>'nessuno_disponibile')::boolean, false);
begin
  perform privato.richiedi_centralino();
  imp := nullif(p->>'importo_stimato', '')::numeric;
  -- da 1.000 € compresi: Tecnico Commerciale; fino a 999,99 €: centralino
  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') and imp is not null then
    v_tipo := case when imp >= 1000 then 'offerta_grande' else 'offerta_piccola' end;
  elsif v_tipo = 'offerta' then v_tipo := 'offerta_piccola';
  end if;
  select * into f from public.pratiche_flussi where tipo = v_tipo and attivo;
  if f.tipo is null then raise exception 'Tipo di richiesta non valido'; end if;
  if nullif(btrim(coalesce(p->>'cliente_nome', '')), '') is null then raise exception 'Indica il cliente'; end if;
  if v_sotto is not null and cardinality(f.sottotipi) > 0 and not (v_sotto = any (f.sottotipi)) then raise exception 'Dettaglio non valido per questo tipo'; end if;
  if (p->>'appuntamento_data') is not null and (p->>'appuntamento_fascia') is null then raise exception 'Indica mattina o pomeriggio'; end if;
  if v_tipo in ('manutenzione', 'sopralluogo') then
    if v_sotto = 'Allarme sonoro attivo' and v_urg is null then v_urg := 'urgente'; end if;
    if v_urg is null or v_urg not in ('urgente', 'ordinario') then raise exception 'Valuta l''urgenza: urgente (oggi) o ordinario (entro 2 giorni lavorativi)'; end if;
  else v_urg := null;
  end if;
  if v_tipo = 'offerta_grande' then
    v_com := nullif(btrim(coalesce(p->>'commerciale_nome', '')), '');
    select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
    if com is null then raise exception 'Offerta da 1.000 €: scegli il Tecnico Commerciale (L. Esposito, A. Chiaradonna o A. Querini)'; end if;
    if not nessuno and not (com->>'disponibile')::boolean then raise exception '% non è disponibile ora: scegli un altro commerciale o «nessuno disponibile»', v_com; end if;
    v_com_email := com->>'email';
  end if;
  urg := coalesce(p->>'priorita', '') = 'urgente' or v_urg = 'urgente' or v_sotto = any (f.sottotipi_urgenti);

  insert into privato.pratiche_contatori (anno, ultimo) values (v_anno, 1)
  on conflict (anno) do update set ultimo = privato.pratiche_contatori.ultimo + 1 returning ultimo into k;
  num := 'CT-' || v_anno || '-' || lpad(k::text, 6, '0');

  insert into public.pratiche (numero, canale, tipo, sottotipo, priorita, urgenza, cliente_codice, cliente_nome, sede, contatto_nome, telefono, email,
    indirizzo, cap, comune, descrizione, assegnato_ruolo, assegnato_nome, assegnato_dipendente_id, commerciale_nome, commerciale_email, tecnico_nome,
    importo_stimato, appuntamento_data, appuntamento_fascia, tacitazione_tentata, stato_cliente)
  values (num, coalesce(p->>'canale', 'telefono'), v_tipo, v_sotto, case when urg then 'urgente' else 'normale' end, v_urg,
    nullif(btrim(coalesce(p->>'cliente_codice', '')), ''), btrim(p->>'cliente_nome'), nullif(btrim(coalesce(p->>'sede', '')), ''),
    nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), nullif(btrim(coalesce(p->>'telefono', '')), ''), nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
    nullif(btrim(coalesce(p->>'indirizzo', '')), ''), nullif(btrim(coalesce(p->>'cap', '')), ''), nullif(btrim(coalesce(p->>'comune', '')), ''),
    nullif(btrim(coalesce(p->>'descrizione', '')), ''),
    case when v_tipo = 'offerta_grande' then 'tecnico_commerciale' else coalesce(nullif(p->>'assegnato_ruolo', ''), f.assegnazione->>'ruolo') end,
    case when v_tipo = 'offerta_grande' then v_com else coalesce(nullif(p->>'assegnato_nome', ''), case when f.assegnazione->>'ruolo' in ('amministrazione', 'fornitori') then f.assegnazione->>'nome' end) end,
    nullif(p->>'assegnato_dipendente_id', '')::bigint,
    coalesce(v_com, nullif(btrim(coalesce(p->>'commerciale_nome', '')), '')), coalesce(nullif(lower(v_com_email), ''), nullif(lower(btrim(coalesce(p->>'commerciale_email', ''))), '')),
    nullif(btrim(coalesce(p->>'tecnico_nome', '')), ''),
    imp, nullif(p->>'appuntamento_data', '')::date, nullif(p->>'appuntamento_fascia', ''), coalesce((p->>'tacitazione_tentata')::boolean, false),
    nullif(p->>'stato_cliente', ''))
  returning id into nid;

  perform privato.ct_evento(nid, 'creata', null, 'ricevuta', p->>'descrizione',
    jsonb_build_object('canale', coalesce(p->>'canale', 'telefono'), 'tipo', v_tipo, 'sottotipo', v_sotto, 'urgenza', v_urg));
  perform privato.ct_prossimo_sla(nid, 1);
  -- offerta da 1.000 €: il commerciale ha sempre 2 ore per chiamare il cliente (campanella, promemoria, escalation)
  if v_tipo = 'offerta_grande' then
    perform public.centralino_trasferisci(jsonb_build_object('pratica_id', nid, 'destinatario_nome', v_com, 'destinatario_email', v_com_email,
      'destinatario_ruolo', 'tecnico_commerciale', 'modalita', 'richiamo', 'tipo_argomento', 'Offerta da 1.000 €', 'argomento', p->>'descrizione',
      'scadenza', privato.ct_sla(now(), '{"tipo":"ore","valore":2}'), 'entro_testo', 'entro 2 ore'));
  end if;
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo);
end $$;

-- 7. Avviso urgente nell'app del tecnico (stessa forma delle urgenze della giornata) ---------------------
create or replace function public.centralino_avviso_tecnico(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche; dove text; nid bigint;
begin
  perform privato.richiedi_centralino();
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.tecnico_dipendente_id is null then raise exception 'Prima scegli il tecnico (passo «Tecnico individuato»)'; end if;
  dove := nullif(concat_ws(', ', p.indirizzo, nullif(concat_ws(' ', p.cap, p.comune), '')), '');
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (p.tecnico_dipendente_id, 'avviso', jsonb_strip_nulls(jsonb_build_object('livello', case when p.urgenza = 'urgente' then 'urgente' else 'info' end,
            'evento', 'centralino_intervento', 'pratica', p.numero,
            'titolo', case when p.urgenza = 'urgente' then 'URGENTE: ' else '' end || p.cliente_nome || coalesce(' · ' || p.sottotipo, ''),
            'testo', concat_ws(' · ', p.descrizione, p.contatto_nome, p.telefono, p.tecnico_quando, case when p.documento_intervento is not null then 'Buono ' || p.documento_intervento end),
            'luogo', coalesce(dove, p.sede), 'ora', to_char(p.tecnico_quando_at at time zone 'Europe/Rome', 'DD/MM HH24:MI'),
            'mappa', case when coalesce(dove, p.sede) is not null then 'https://www.google.com/maps/search/?api=1&query=' || replace(coalesce(dove, p.sede), ' ', '+') end,
            'da', privato.ct_autore())), '/t')
  returning id into nid;
  update public.pratiche set avviso_app_at = now(), updated_at = now() where id = p_id;
  perform privato.ct_evento(p_id, 'nota', null, null, 'Avviso inviato nell''app del tecnico ' || coalesce(p.tecnico_nome, ''), jsonb_build_object('notifica_id', nid, 'avviso_app', true));
  return jsonb_build_object('ok', true, 'notifica_id', nid);
end $$;

grant execute on function public.centralino_coordinatori(text), public.centralino_tecnici(), public.centralino_avviso_tecnico(bigint) to authenticated;

-- 8. Modelli ------------------------------------------------------------------------------------
insert into public.email_template (codice, nome, oggetto, corpo_html, tipo_pratica, ordine) values
('intervento_coordinatore', 'Al coordinatore – nuovo intervento', 'Intervento {urgenza} – {cliente} ({numero_pratica})',
 '<p>Ciao,</p><p>nuova richiesta di intervento <b>{urgenza}</b> ({obiettivo}).</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Cliente</td><td><b>{cliente}</b></td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Problema</td><td>{dettaglio}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Richiesta</td><td>{descrizione}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Indirizzo</td><td>{indirizzo}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Contatto</td><td>{contatto} · {telefono} · {email_cliente}</td></tr></table><p>Al cliente ho detto che entro 1 ora lo ricontattiamo per confermare l''appuntamento: mi indichi il tecnico e quando passa?</p><p>{firma}</p>',
 'manutenzione', 3),
('intervento_cliente', 'Al cliente – tecnico e orario', 'Molajoni · Il suo intervento – {numero_pratica}',
 '<p>Gentile {contatto},</p><p>come promesso la aggiorniamo sulla sua richiesta: la contatterà il nostro tecnico <b>{tecnico}</b> <b>{quando}</b>.</p><p>Se nel frattempo dovesse cambiare qualcosa, ci risponda pure a questa email o ci chiami.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'manutenzione', 4),
('sopralluogo_coordinatore', 'Al coordinatore – nuovo sopralluogo', 'Sopralluogo {urgenza} – {cliente} ({numero_pratica})',
 '<p>Ciao,</p><p>nuova richiesta di sopralluogo <b>{urgenza}</b> ({obiettivo}).</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Cliente</td><td><b>{cliente}</b></td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Richiesta</td><td>{descrizione}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Indirizzo</td><td>{indirizzo}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Contatto</td><td>{contatto} · {telefono} · {email_cliente}</td></tr></table><p>Al cliente ho promesso una conferma entro 1 ora: chi lo fa e quando?</p><p>{firma}</p>',
 'sopralluogo', 3),
('sopralluogo_cliente', 'Al cliente – sopralluogo confermato', 'Molajoni · Il suo sopralluogo – {numero_pratica}',
 '<p>Gentile {contatto},</p><p>la contatterà <b>{tecnico}</b> <b>{quando}</b> per il sopralluogo presso <b>{cliente}</b>.</p><p>Per qualsiasi necessità ci risponda pure a questa email.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'sopralluogo', 4),
('riepilogo_commerciale', 'Al Tecnico Commerciale – riepilogo offerta', 'Offerta da 1.000 € – {cliente} ({numero_pratica}) – da chiamare entro 2 ore',
 '<p>Ciao {commerciale},</p><p>ti ho assegnato questa richiesta di offerta: <b>chiama il cliente entro 2 ore</b> (entro le {scadenza_richiamo}) e poi conferma per email con l''offerta o il sopralluogo.</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Cliente</td><td><b>{cliente}</b> · {stato_cliente}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Contatto</td><td>{contatto} · {telefono} · {email_cliente}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Richiesta</td><td>{descrizione}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Importo stimato</td><td>{importo}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Indirizzo</td><td>{indirizzo}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Già fatto</td><td>Email al cliente: «entro 2 ore la contatterà il nostro Tecnico Commerciale»</td></tr></table><p>{firma}</p>',
 'offerta_grande', 51)
on conflict (codice) do nothing;
update public.email_template set
  oggetto = 'Molajoni · La sua richiesta di offerta – {numero_pratica}',
  corpo_html = '<p>Gentile {contatto},</p><p>grazie per la sua richiesta. <b>Entro 2 ore la contatterà il nostro Tecnico Commerciale {commerciale}</b> per capire insieme le sue esigenze e preparare la proposta più adatta.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
  cc_offerte_grandi = false
 where codice = 'presa_offerta_grande';
