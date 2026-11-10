-- 0079 — Centralino: «Avvisato per telefono» soddisfa il requisito «email» del passo.
-- Bug: «Per «Email di riepilogo al Tecnico Commerciale» manca: Email (Invia email)».
-- centralino_avvisato_telefono registra un evento 'nota' con dati.comunicazione = true,
-- ma ct_mancanti contava solo gli eventi 'email_inviata' → il passo restava bloccato.
create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb default '{}'::jsonb)
 returns text[]
 language plpgsql
 stable
 set search_path to ''
as $function$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text; email_fatta boolean; ass jsonb;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti', f.assegnazione into req, ass from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  -- email registrata (Resend, copia, Outlook) oppure avvisato per telefono (conta come l'email)
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
    if r = 'informato' and not (email_fatta or coalesce((d->>'informato_voce')::boolean, false) or nullif(btrim(coalesce(d->>'email_non_disponibile', '')), '') is not null) then
      m := m || text 'Email al cliente o «informato a voce»'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome, ass->>'nome') is null then m := m || text 'A chi è stata girata'; end if;
  end loop;
  return m;
end $function$;
