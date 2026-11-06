-- Campi obbligatori ridotti al minimo (richiesta del titolare). Non distruttiva.
-- Creazione: canale, tipo, cliente O telefono; urgenza (preselezionata) per interventi/sopralluoghi; commerciale (preselezionato) per offerte da 1.000 €.
-- Passi: coordinatore = email O telefonato; tecnico = solo il nome; avviso = almeno uno tra Taylor / WhatsApp / app (buono facoltativo);
-- cliente informato = email O «informato a voce» O «email non disponibile» con motivo.

update public.pratiche_flussi f set stadi = (
  select jsonb_agg(case
    when s->>'key' = 'coordinatore' then jsonb_set(s, '{requisiti}', '["coordinatore"]')
    when (f.tipo in ('manutenzione', 'sopralluogo') and s->>'key' = 'cliente')
      or (f.tipo = 'offerta_grande' and s->>'key' = 'email_cliente')
      or (f.tipo = 'modifica' and s->>'key' = 'comunicata') then jsonb_set(s, '{requisiti}', '["informato"]')
    when s->>'key' = 'avviso' then jsonb_set(s, '{requisiti}', '["avviso"]')
    else s end order by o)
  from jsonb_array_elements(f.stadi) with ordinality x(s, o))
 where f.tipo in ('manutenzione', 'sopralluogo', 'offerta_grande', 'modifica');

create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb default '{}'::jsonb) returns text[]
language plpgsql stable set search_path = '' as $$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text; email_fatta boolean; ass jsonb;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti', f.assegnazione into req, ass from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  email_fatta := exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata' and e.at >= coalesce(dal, p.created_at));
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null then m := m || text 'Data dell''appuntamento'; end if;
    if r = 'urgenza' and coalesce(nullif(d->>'urgenza', ''), p.urgenza) is null then m := m || text 'Valutazione urgenza'; end if;
    if r = 'coordinatore' then
      if coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), p.coordinatore_nome) is null then m := m || text 'Coordinatore'; end if;
      if not (email_fatta or p.coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false)) then m := m || text 'Email o telefonata al coordinatore'; end if;
    end if;
    if r = 'tecnico' and coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), p.tecnico_nome) is null then m := m || text 'Tecnico'; end if;
    if r in ('buono', 'avviso') and not (p.alert_taylor or p.whatsapp_tecnico or p.avviso_app_at is not null
                             or coalesce((d->>'alert_taylor')::boolean, false) or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || text 'Avviso al tecnico (Taylor, WhatsApp o app)'; end if;
    if r = 'taylor' and not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || text 'Alert inviato su Taylor'; end if;
    if r = 'commerciale' then
      val := coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome);
      if val is null then m := m || text 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from jsonb_array_elements(privato.ct_commerciali()) x;
        if not (val = any (coalesce(com, '{}'))) then m := m || text 'Commerciale tra i Tecnici Commerciali delle offerte da 1.000 €'; end if;
      end if;
    end if;
    if r = 'email' and not email_fatta then m := m || text 'Email (Invia email)'; end if;
    if r = 'informato' and not (email_fatta or coalesce((d->>'informato_voce')::boolean, false) or nullif(btrim(coalesce(d->>'email_non_disponibile', '')), '') is not null) then
      m := m || text 'Email al cliente o «informato a voce»'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome, ass->>'nome') is null then m := m || text 'A chi è stata girata'; end if;
  end loop;
  return m;
end $$;

create or replace function public.centralino_crea(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  f public.pratiche_flussi; v_anno int := extract(year from now() at time zone 'Europe/Rome')::int; k int; num text; nid bigint;
  v_tipo text := p->>'tipo'; v_sotto text := nullif(btrim(coalesce(p->>'sottotipo', '')), ''); urg boolean; imp numeric; v_urg text := nullif(p->>'urgenza', '');
  com jsonb; v_com text; v_com_email text;
  v_nome text := nullif(btrim(coalesce(p->>'cliente_nome', '')), ''); v_tel text := nullif(btrim(coalesce(p->>'telefono', '')), '');
begin
  perform privato.richiedi_centralino();
  imp := nullif(p->>'importo_stimato', '')::numeric;
  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') and imp is not null then
    v_tipo := case when imp >= 1000 then 'offerta_grande' else 'offerta_piccola' end;
  elsif v_tipo = 'offerta' then v_tipo := 'offerta_piccola';
  end if;
  select * into f from public.pratiche_flussi where tipo = v_tipo and attivo;
  if f.tipo is null then raise exception 'Tipo di richiesta non valido'; end if;
  if v_nome is null and v_tel is null then raise exception 'Indica il cliente o il telefono'; end if;
  if v_sotto is not null and cardinality(f.sottotipi) > 0 and not (v_sotto = any (f.sottotipi)) then v_sotto := null; end if;
  if v_tipo in ('manutenzione', 'sopralluogo') then
    if v_sotto = 'Allarme sonoro attivo' and v_urg is null then v_urg := 'urgente'; end if;
    if v_urg is null or v_urg not in ('urgente', 'ordinario') then raise exception 'Valuta l''urgenza: urgente (oggi) o ordinario (entro 2 giorni lavorativi)'; end if;
  else v_urg := null;
  end if;
  if v_tipo = 'offerta_grande' then
    v_com := nullif(btrim(coalesce(p->>'commerciale_nome', '')), '');
    select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
    if com is null then raise exception 'Offerta da 1.000 €: scegli il Tecnico Commerciale (L. Esposito, A. Chiaradonna o A. Querini)'; end if;
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
    nullif(btrim(coalesce(p->>'cliente_codice', '')), ''), coalesce(v_nome, v_tel), nullif(btrim(coalesce(p->>'sede', '')), ''),
    nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), v_tel, nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
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
  if v_tipo = 'offerta_grande' then
    perform public.centralino_trasferisci(jsonb_build_object('pratica_id', nid, 'destinatario_nome', v_com, 'destinatario_email', v_com_email,
      'destinatario_ruolo', 'tecnico_commerciale', 'modalita', 'richiamo', 'tipo_argomento', 'Offerta da 1.000 €', 'argomento', p->>'descrizione',
      'scadenza', privato.ct_sla(now(), '{"tipo":"ore","valore":2}'), 'entro_testo', 'entro 2 ore'));
  end if;
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo);
end $function$;
