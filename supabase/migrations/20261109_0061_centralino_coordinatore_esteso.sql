-- 0061: passo «Inviato al coordinatore» esteso: coordinatori + altri referenti + tecnici.
-- privato.ct_mancanti / centralino_avanza accettano già qualunque nome (nessun controllo sul flag).

-- tecnici: anche email (invio diretto al tecnico)
create or replace function public.centralino_tecnici()
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.cognome || ' ' || d.nome, 'telefono', d.telefono, 'email', d.email,
      'assente', exists (select 1 from public.assenze s where s.tecnico_id = d.id and oggi between s.dal and s.al),
      'interventi_oggi', (select count(*) from public.interventi i where i.tecnico_id = d.id and i.data = oggi)) order by d.cognome, d.nome)
    from public.dipendenti d where d.attivo and d.categoria = 'TEC'), '[]'::jsonb);
end $function$;

-- referenti attivi NON coordinatori del tipo (escluso il segnaposto «Tecnico»), stessa disponibilità di ct_persone
create or replace function public.centralino_altri_referenti(p_tipo text)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare coord jsonb;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  coord := privato.ct_persone(case when p_tipo = 'sopralluogo' then 'coord_sopralluoghi' else 'coord_interventi' end);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'nome', x.nome, 'email', x.email, 'telefono', x.telefono, 'cellulare', x.cellulare, 'account', u.user_id is not null,
      'assente', coalesce(a.assente, false), 'occupato', coalesce(not d.disponibile, false),
      'disponibile', coalesce(d.disponibile, true) and not coalesce(a.assente, false)) order by x.ordine, x.nome)
    from public.referenti x
    left join lateral (select r.user_id, r.dipendente_id from public.responsabili r left join auth.users au on au.id = r.user_id
                        where x.email is not null and r.attivo and (lower(r.email) = x.email or lower(au.email) = x.email) limit 1) u on true
    left join lateral (select true as assente from public.assenze s where s.tecnico_id = u.dipendente_id and (now() at time zone 'Europe/Rome')::date between s.dal and s.al limit 1) a on true
    left join public.centralino_disponibilita d on d.nome = x.nome
   where x.attivo and lower(btrim(x.nome)) <> 'tecnico'
     and not exists (select 1 from jsonb_array_elements(coord) c where c->>'nome' = x.nome)), '[]'::jsonb);
end $function$;
grant execute on function public.centralino_altri_referenti(text) to authenticated;
