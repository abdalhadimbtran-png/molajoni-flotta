-- Corsi senza data di conseguimento: stato «da_completare» (né valido né scaduto).
-- Solo CREATE OR REPLACE, nessuna modifica di tabelle.

-- Riga attuale per corso: le registrazioni con data hanno la precedenza su quelle senza data.
create or replace function privato.formazione_righe()
 returns table(dipendente_id bigint, nome text, categoria text, corso_id bigint, corso text, obbligatorio boolean, data_conseguimento date, data_scadenza date, ente text, ore numeric, stato text, giorni integer)
 language sql stable set search_path to ''
as $function$
  with att as (
    select distinct on (cd.dipendente_id, cd.corso_id) cd.*
      from public.corsi_dipendente cd
     order by cd.dipendente_id, cd.corso_id, cd.data_conseguimento desc nulls last, cd.id desc)
  select d.id, d.cognome || ' ' || d.nome, d.categoria, c.id, c.nome, c.obbligatorio_per_tec,
         a.data_conseguimento, a.data_scadenza, a.ente, a.ore,
         case when a.data_conseguimento is null then 'da_completare' else privato.stato_corso(a.data_scadenza) end,
         case when a.data_conseguimento is null then null else (a.data_scadenza - public.oggi())::int end
    from att a join public.dipendenti d on d.id = a.dipendente_id join public.corsi c on c.id = a.corso_id
   where d.attivo
  union all
  select d.id, d.cognome || ' ' || d.nome, d.categoria, c.id, c.nome, true, null, null, null, null, 'mancante', null
    from public.dipendenti d cross join public.corsi c
   where d.attivo and d.categoria = 'TEC' and c.attivo and c.obbligatorio_per_tec
     and not exists (select 1 from public.corsi_dipendente x where x.dipendente_id = d.id and x.corso_id = c.id);
$function$;

create or replace function public.formazione_dati()
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  return jsonb_build_object('oggi', public.oggi(),
    'righe', coalesce((select jsonb_agg(to_jsonb(r)) from privato.formazione_righe() r), '[]'),
    'registrazioni', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cd.id, 'dipendente_id', cd.dipendente_id, 'nome', d.cognome || ' ' || d.nome, 'categoria', d.categoria, 'attivo', d.attivo,
        'corso_id', cd.corso_id, 'corso', c.nome, 'data_conseguimento', cd.data_conseguimento, 'data_scadenza', cd.data_scadenza,
        'ente', cd.ente, 'ore', cd.ore,
        'n_attestati', (select count(*) from public.corsi_attestati a where a.corso_dipendente_id = cd.id),
        'attuale', not exists (select 1 from public.corsi_dipendente y where y.dipendente_id = cd.dipendente_id and y.corso_id = cd.corso_id
                                 and (coalesce(y.data_conseguimento, '-infinity'::date), y.id) > (coalesce(cd.data_conseguimento, '-infinity'::date), cd.id))))
      from public.corsi_dipendente cd join public.dipendenti d on d.id = cd.dipendente_id join public.corsi c on c.id = cd.corso_id), '[]'));
end $function$;

create or replace function public.dipendente_corsi(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('corso', r.corso, 'data_conseguimento', r.data_conseguimento,
      'data_scadenza', r.data_scadenza, 'stato', r.stato, 'obbligatorio', r.obbligatorio,
      'attestati', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', coalesce(a.nome_file, 'Attestato')) order by a.id)
                               from public.corsi_attestati a join public.corsi_dipendente cd on cd.id = a.corso_dipendente_id
                              where cd.dipendente_id = did and cd.corso_id = r.corso_id
                                and cd.data_conseguimento is not distinct from r.data_conseguimento), '[]')) order by r.corso)
    from privato.formazione_righe() r where r.dipendente_id = did), '[]');
end $function$;

create or replace function public.formazione_report(p_tipo text, p_categoria text default null, p_dipendente bigint default null, p_giorni integer default 60)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  if p_tipo not in ('per_dipendente', 'scadenze') then raise exception 'Report non valido'; end if;
  return jsonb_build_object('righe', coalesce((select jsonb_agg(jsonb_build_object(
      'dipendente', r.nome, 'categoria', r.categoria, 'corso', r.corso, 'obbligatorio', case when r.obbligatorio then 'Sì' else '' end,
      'data_conseguimento', r.data_conseguimento, 'data_scadenza', r.data_scadenza, 'ente', r.ente, 'ore', r.ore,
      'stato', case r.stato when 'valido' then 'Valido' when 'in_scadenza' then 'In scadenza' when 'scaduto' then 'Scaduto'
                            when 'da_completare' then 'Data da completare' else 'Mancante' end,
      'giorni', r.giorni)
      order by case when p_tipo = 'scadenze' then r.data_scadenza end, r.nome, r.corso)
    from privato.formazione_righe() r
   where (p_categoria is null or r.categoria = p_categoria) and (p_dipendente is null or r.dipendente_id = p_dipendente)
     and (p_tipo = 'per_dipendente' or (r.data_scadenza is not null and r.data_scadenza <= public.oggi() + greatest(coalesce(p_giorni, 60), 0)))), '[]'));
end $function$;

-- Registrare un corso che ha già una riga «data da completare» la completa (stessa riga, attestati compresi)
-- invece di crearne una nuova.
create or replace function public.formazione_registra(p_corso bigint, p_dipendenti bigint[], p_data date, p_scadenza date default null, p_ente text default null, p_ore numeric default null, p_note text default null, p_attestato text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare ids bigint[];
begin
  perform privato.richiedi_formazione();
  if p_data is null then raise exception 'Indica la data del corso'; end if;
  if p_data > public.oggi() then raise exception 'La data del corso non può essere nel futuro'; end if;
  if coalesce(cardinality(p_dipendenti), 0) = 0 then raise exception 'Scegli almeno un dipendente'; end if;
  if not exists (select 1 from public.corsi where id = p_corso) then raise exception 'Corso non trovato'; end if;
  with upd as (
    update public.corsi_dipendente cd
       set data_conseguimento = p_data, data_scadenza = p_scadenza,
           ente = coalesce(nullif(btrim(p_ente), ''), cd.ente), ore = coalesce(p_ore, cd.ore),
           note = nullif(btrim(p_note), ''), attestato_path = coalesce(p_attestato, cd.attestato_path), updated_at = now()
     where cd.corso_id = p_corso and cd.dipendente_id = any(p_dipendenti) and cd.data_conseguimento is null
       and cd.id = (select min(z.id) from public.corsi_dipendente z
                     where z.dipendente_id = cd.dipendente_id and z.corso_id = p_corso and z.data_conseguimento is null)
    returning cd.id, cd.dipendente_id),
  ins as (
    insert into public.corsi_dipendente (dipendente_id, corso_id, data_conseguimento, data_scadenza, ente, ore, note, attestato_path, created_by)
    select d.id, p_corso, p_data, p_scadenza, nullif(btrim(p_ente), ''), p_ore, nullif(btrim(p_note), ''), p_attestato, auth.uid()
      from public.dipendenti d where d.id = any(p_dipendenti) and d.id not in (select dipendente_id from upd)
    returning id)
  select array_agg(id) into ids from (select id from upd union all select id from ins) x;
  if coalesce(cardinality(ids), 0) <> cardinality(array(select distinct unnest(p_dipendenti))) then
    raise exception 'Dipendente non trovato';
  end if;
  return jsonb_build_object('ok', true, 'id', to_jsonb(ids));
end $function$;

-- Avvisi giornalieri (cron): stessa precedenza delle righe con data; le righe senza data non hanno scadenza → nessun avviso.
do $$ declare d text; begin
  d := pg_get_functiondef('privato.formazione_controlla()'::regprocedure);
  d := replace(d, 'cd.data_conseguimento desc, cd.id desc', 'cd.data_conseguimento desc nulls last, cd.id desc');
  execute d;
end $$;

create or replace view public.corsi_attuali with (security_invoker = true) as
  select distinct on (cd.dipendente_id, cd.corso_id)
         cd.id, cd.dipendente_id, cd.corso_id, c.nome as corso, cd.data_conseguimento, cd.data_scadenza,
         cd.ente, cd.ore, cd.note, cd.attestato_path,
         case when cd.data_conseguimento is null then 'da_completare'
              when cd.data_scadenza is null then 'valido'
              when cd.data_scadenza < (now() at time zone 'Europe/Rome')::date then 'scaduto'
              when cd.data_scadenza <= (now() at time zone 'Europe/Rome')::date + 60 then 'in_scadenza'
              else 'valido' end as stato
    from public.corsi_dipendente cd join public.corsi c on c.id = cd.corso_id
   order by cd.dipendente_id, cd.corso_id, cd.data_conseguimento desc nulls last, cd.id desc;
