-- 0098 «Registra chiamata»: Jennifer registra dopo le chiamate non inserite in diretta.
-- Pratica già CHIUSA (chiusa_ok) con created_at = closed_at = ora scelta; registrata_dopo = true, inserito_il = now().
-- Nessuna email, nessun passo, nessuno SLA (sla_rispettato resta null: fuori da ogni KPI di tempo).
alter table public.pratiche add column if not exists registrata_dopo boolean not null default false;
alter table public.pratiche add column if not exists inserito_il timestamptz;

create or replace function public.centralino_registra_chiamata(p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_quando timestamptz; v_tipo text := p->>'tipo'; v_esito text := p->>'esito';
  v_canale text := coalesce(nullif(p->>'canale', ''), 'telefono');
  v_nome text := nullif(btrim(coalesce(p->>'cliente_nome', '')), ''); v_tel text := nullif(btrim(coalesce(p->>'telefono', '')), '');
  v_cod text := nullif(btrim(coalesce(p->>'cliente_codice', '')), '');
  v_cosa text := nullif(btrim(coalesce(p->>'descrizione', '')), '');
  v_pass text := nullif(btrim(coalesce(p->>'passata_a', '')), '');
  v_anno int; k int; num text; nid bigint; ref_ok boolean;
begin
  perform privato.richiedi_centralino();
  begin v_quando := (p->>'quando')::timestamptz; exception when others then raise exception 'Data e ora non valide'; end;
  if v_quando is null then raise exception 'Indica quando è arrivata la chiamata'; end if;
  if v_quando > now() + interval '1 minute' then raise exception 'L''ora non può essere nel futuro'; end if;
  if v_quando < now() - interval '7 days' then raise exception 'Si possono registrare solo chiamate degli ultimi 7 giorni'; end if;
  if v_canale not in ('telefono', 'whatsapp', 'email', 'altro') then raise exception 'Canale non valido'; end if;
  if v_tipo not in ('manutenzione', 'sopralluogo', 'offerta', 'modifica', 'informazione') then raise exception 'Tipo non valido'; end if;
  if v_cosa is null then raise exception 'Scrivi cosa voleva'; end if;
  if v_nome is null and v_tel is null then raise exception 'Indica il cliente o il telefono'; end if;
  if v_esito not in ('gestita', 'passata') then raise exception 'Esito: Gestita da me o Passata a…'; end if;
  if v_esito = 'passata' then
    if v_pass is null then raise exception 'Scegli a chi è stata passata'; end if;
    select exists (select 1 from public.referenti r where r.attivo and r.nome = v_pass) into ref_ok;
    if not ref_ok then raise exception 'Referente non valido (vedi Referenti)'; end if;
  else v_pass := null;
  end if;
  if v_tipo = 'offerta' then v_tipo := case when v_esito = 'passata' then 'offerta_grande' else 'offerta_piccola' end; end if;

  v_anno := extract(year from v_quando at time zone 'Europe/Rome')::int;
  insert into privato.pratiche_contatori (anno, ultimo) values (v_anno, 1)
  on conflict (anno) do update set ultimo = privato.pratiche_contatori.ultimo + 1 returning ultimo into k;
  num := 'CT-' || v_anno || '-' || lpad(k::text, 6, '0');

  insert into public.pratiche (numero, canale, tipo, priorita, urgenza, cliente_codice, cliente_nome, telefono, descrizione,
    assegnato_ruolo, assegnato_nome, commerciale_nome, stato_cliente, esito, stato_corrente, created_at, updated_at, closed_at,
    sla_rispettato, registrata_dopo, inserito_il)
  values (num, v_canale, v_tipo, 'normale', null, v_cod, coalesce(v_nome, v_tel), v_tel, v_cosa,
    case when v_tipo = 'offerta_grande' then 'tecnico_commerciale' when v_pass is not null then 'responsabile' end,
    v_pass, case when v_tipo = 'offerta_grande' then v_pass end,
    case when v_cod is not null then 'attivo' else nullif(p->>'stato_cliente', '') end,
    'chiusa_ok', 'ricevuta', v_quando, now(), v_quando, null, true, now())
  returning id into nid;

  perform privato.ct_evento(nid, 'creata', null, 'ricevuta', v_cosa,
    jsonb_build_object('canale', v_canale, 'tipo', v_tipo, 'passata_a', v_pass, 'registrata_dopo', true, 'quando', v_quando));
  perform privato.ct_evento(nid, 'chiusa', 'ricevuta', 'ricevuta',
    case when v_pass is null then 'Registrata dopo · gestita da me' else 'Registrata dopo · passata a ' || v_pass end,
    jsonb_build_object('esito', 'chiusa_ok', 'registrata_dopo', true));
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo);
end $function$;
revoke all on function public.centralino_registra_chiamata(jsonb) from public, anon;
grant execute on function public.centralino_registra_chiamata(jsonb) to authenticated;

-- Report Direzione: «registrate dopo» contate a parte ed escluse dalla % entro 60 min.
create or replace function privato.report_sez_centralino(p_ini timestamptz, p_fin timestamptz)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  tipi text[] := array['manutenzione','sopralluogo','offerta_piccola','offerta_grande','offerta_tablet','modifica','informazione'];
  semplici text[] := array['manutenzione','sopralluogo','modifica','informazione'];
  tot int; n_chiuse int; n_ann int; n_jen int; n_com int; n_jen_inv int; n_jen_60 int; n_com_inv int; n_seg int; n_seg24 int; n_off_rit int; n_reg int;
  per_tipo jsonb; per_canale jsonb; serie jsonb; lista jsonb; passate jsonb;
  oggi date := (now() at time zone 'Europe/Rome')::date;
  g_ini date := (p_ini at time zone 'Europe/Rome')::date;
  g_fin date := least(((p_fin - interval '1 second') at time zone 'Europe/Rome')::date, oggi);
  rif timestamptz := least(p_fin, now());
  att jsonb := '[]';
begin
  select count(*), count(*) filter (where registrata_dopo) into tot, n_reg from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_tipo
  from (values (1,'Intervento',array['manutenzione']), (2,'Sopralluogo',array['sopralluogo']),
               (3,'Offerta',array['offerta_piccola','offerta_grande','offerta_tablet']),
               (4,'Modifiche / Disdetta',array['modifica']), (5,'Informazione',array['informazione'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select count(*) filter (where esito in ('chiusa_ok','chiusa_ko')), count(*) filter (where esito = 'annullata')
    into n_chiuse, n_ann from public.pratiche where tipo = any(tipi) and closed_at >= p_ini and closed_at < p_fin;

  -- offerte richieste nel periodo
  select count(*) filter (where tipo in ('offerta_piccola','offerta_tablet')), count(*) filter (where tipo = 'offerta_grande'),
         count(*) filter (where tipo = 'offerta_piccola' and esito = 'chiusa_ok' and not registrata_dopo),
         count(*) filter (where tipo = 'offerta_piccola' and esito = 'chiusa_ok' and not registrata_dopo and closed_at <= created_at + interval '60 minutes'),
         count(*) filter (where tipo = 'offerta_grande' and esito = 'chiusa_ok')
    into n_jen, n_com, n_jen_inv, n_jen_60, n_com_inv
    from public.pratiche where created_at >= p_ini and created_at < p_fin;

  -- «da seguire» aperte a fine periodo (tipi senza email)
  select count(*), count(*) filter (where created_at < rif - interval '24 hours') into n_seg, n_seg24 from public.pratiche
   where tipo = any(semplici) and created_at < p_fin and (closed_at is null or closed_at >= p_fin) and esito <> 'annullata';
  select count(*) into n_off_rit from public.pratiche
   where tipo like 'offerta%' and esito = 'aperta' and sla_scadenza < rif and created_at < p_fin;

  select coalesce(jsonb_agg(jsonb_build_array(d, n) order by n desc, d), '[]') into passate from (
    select coalesce(nullif(assegnato_nome, ''), 'Nessuno') d, count(*) n from public.pratiche
     where tipo = any(semplici) and created_at >= p_ini and created_at < p_fin group by 1 order by 2 desc limit 8) x;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_canale
  from (values (1,'Telefono',array['telefono']), (2,'WhatsApp',array['whatsapp']), (3,'Email',array['email']),
               (4,'Tablet TMQ',array['tablet_tmq']), (5,'Altro',array['collega','altro'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and p.canale = any(g.t)
                      and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d, 'DD/MM'), 'valore', coalesce(c.n, 0)) order by d), '[]') into serie
  from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi)
                      and (p.created_at at time zone 'Europe/Rome')::date = d::date) c on true;

  select coalesce(jsonb_agg(r order by o, n), '[]') into lista from (
    select * from (
      select 1 o, p.numero n, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Offerta in ritardo',
               'Scaduta il ' || to_char(p.sla_scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI')) r
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo like 'offerta%' and p.esito = 'aperta' and p.sla_scadenza < rif and p.created_at < p_fin
      union all
      select 2, p.numero, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Da seguire',
               'Dal ' || to_char(p.created_at at time zone 'Europe/Rome', 'DD/MM HH24:MI') || coalesce(' · ' || p.assegnato_nome, ''))
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(semplici) and p.esito = 'aperta' and p.created_at < rif - interval '24 hours'
      union all
      select 3, p.numero, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Annullata',
               coalesce(left((select ev.testo from public.pratiche_eventi ev where ev.pratica_id = p.id and ev.tipo in ('chiusa','stato')
                                and ev.testo is not null order by ev.at desc limit 1), 120), '—'))
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(tipi) and p.esito = 'annullata' and p.closed_at >= p_ini and p.closed_at < p_fin
    ) u order by o, n limit 15) x;

  if n_off_rit > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_off_rit || ' offerte in ritardo', 'livello', 'alto')); end if;
  if n_seg24 > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_seg24 || ' pratiche da seguire aperte da più di 24 ore', 'livello', 'medio')); end if;
  if n_ann > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_ann || ' pratiche annullate nel periodo', 'livello', 'medio')); end if;

  return jsonb_build_object('codice', 'centralino', 'titolo', 'Centralino',
    'kpi', jsonb_build_array(
      jsonb_build_object('label', 'Contatti ricevuti', 'valore', tot),
      jsonb_build_object('label', 'Offerte gestite da Jennifer', 'valore', n_jen),
      jsonb_build_object('label', 'Offerte inviate entro 60 min', 'valore', case when n_jen_inv = 0 then null else round(100.0 * n_jen_60 / n_jen_inv) end, 'unita', '%'),
      jsonb_build_object('label', 'Offerte al Tecnico Commerciale', 'valore', n_com),
      jsonb_build_object('label', 'Registrate dopo', 'valore', n_reg),
      jsonb_build_object('label', 'Pratiche chiuse', 'valore', n_chiuse),
      jsonb_build_object('label', 'Da seguire aperte', 'valore', n_seg, 'confronta', false),
      jsonb_build_object('label', 'Annullate', 'valore', n_ann)),
    'tabelle', jsonb_build_array(
      jsonb_build_object('titolo', 'Contatti per tipo', 'colonne', jsonb_build_array('Tipo', 'N.'), 'righe', per_tipo),
      jsonb_build_object('titolo', 'Contatti per canale', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale),
      jsonb_build_object('titolo', 'Offerte', 'colonne', jsonb_build_array('Gestione', 'N.'), 'righe', jsonb_build_array(
        jsonb_build_array('Gestite da Jennifer', n_jen), jsonb_build_array('Inviate', n_jen_inv), jsonb_build_array('Inviate entro 60 min', n_jen_60),
        jsonb_build_array('Passate al Tecnico Commerciale', n_com), jsonb_build_array('Commerciale avvisato', n_com_inv))),
      jsonb_build_object('titolo', 'Altre richieste passate a', 'colonne', jsonb_build_array('Responsabile', 'N.'), 'righe', passate),
      jsonb_build_object('titolo', 'Offerte in ritardo, da seguire da più di 24 ore, annullate', 'larga', true,
        'colonne', jsonb_build_array('Numero', 'Cliente', 'Tipo', 'Stato', 'Dettaglio'), 'righe', lista)),
    'serie', jsonb_build_array(jsonb_build_object('titolo', 'Contatti al giorno', 'punti', serie)),
    'attenzione', att);
end $function$;
revoke all on function privato.report_sez_centralino(timestamptz, timestamptz) from public, anon, authenticated;
