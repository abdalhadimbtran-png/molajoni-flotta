-- Notifica del piano solo ai tecnici il cui piano è cambiato + avvisi manuali (urgenze, patente, comunicazioni)

alter table public.notifiche drop constraint if exists notifiche_tipo_check;
alter table public.notifiche add constraint notifiche_tipo_check
  check (tipo in ('piano','segnalazione_fermo','segnalazione_risolta','scadenze','avviso'));

-- Ultimo piano inviato a ogni tecnico per ogni giorno (per confrontare alla conferma successiva)
create table public.piano_inviato (
  data date not null,
  tecnico_id bigint not null references public.tecnici(id),
  impronta jsonb not null,
  inviato_il timestamptz not null default now(),
  primary key (data, tecnico_id)
);
alter table public.piano_inviato enable row level security;
revoke all on public.piano_inviato from anon, authenticated;

create or replace function public.conferma_piano(p_data date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb; bloccati text[]; r jsonb; nuovo jsonb; vecchio jsonb; tid bigint; n int := 0;
begin
  perform public.richiedi_responsabile();
  p := public.piano_giorno(p_data);
  select coalesce(array_agg(x->>'nome'), '{}') into bloccati from jsonb_array_elements(p->'righe') x where x->>'livello' = 'ko';
  if array_length(bloccati, 1) > 0 then
    return jsonb_build_object('ok', false, 'bloccati', to_jsonb(bloccati));
  end if;
  insert into public.piani (data, confermato_il, confermato_da) values (p_data, now(), auth.uid())
    on conflict (data) do update set confermato_il = now(), confermato_da = auth.uid();

  for r in select x from jsonb_array_elements(p->'righe') x loop
    tid := (r->>'tecnico_id')::bigint;
    nuovo := null;
    if r->>'assenza' is null and (jsonb_array_length(r->'interventi') > 0 or r->>'veicolo_id' is not null) then
      nuovo := jsonb_build_object(
        'veicolo', (select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello) from public.veicoli v where v.id = (r->>'veicolo_id')::bigint),
        'interventi', coalesce((select jsonb_agg(jsonb_build_object('ora', i->>'ora', 'luogo', i->>'luogo', 'attivita', i->>'attivita'))
                                from jsonb_array_elements(r->'interventi') i), '[]'::jsonb));
    end if;
    vecchio := null;
    select pi.impronta into vecchio from public.piano_inviato pi where pi.data = p_data and pi.tecnico_id = tid;
    continue when nuovo is null and vecchio is null;
    continue when nuovo is not distinct from vecchio;

    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values (tid, 'piano', jsonb_build_object(
      'data', p_data,
      'veicolo', nuovo->'veicolo', 'interventi', coalesce(nuovo->'interventi', '[]'::jsonb),
      'aggiornato', vecchio is not null and nuovo is not null,
      'annullato', nuovo is null,
      'veicolo_prima', case when vecchio is not null and (vecchio->'veicolo') is distinct from (nuovo->'veicolo') then vecchio->'veicolo' end), '/t');
    n := n + 1;

    if nuovo is null then
      delete from public.piano_inviato where data = p_data and tecnico_id = tid;
    else
      insert into public.piano_inviato (data, tecnico_id, impronta, inviato_il) values (p_data, tid, nuovo, now())
        on conflict (data, tecnico_id) do update set impronta = excluded.impronta, inviato_il = now();
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'notificati', n);
end $$;

-- Avviso manuale dal responsabile a uno o più tecnici
create or replace function public.invia_avviso(p_tecnici bigint[], p_livello text, p_titolo text, p_testo text,
  p_ora text default null, p_luogo text default null, p_contatto text default null, p_telefono text default null, p_targa text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; mitt text;
begin
  perform public.richiedi_responsabile();
  if p_livello not in ('urgente','importante','info') then raise exception 'Livello non valido'; end if;
  if length(trim(coalesce(p_titolo,''))) < 3 then raise exception 'Scrivi un titolo'; end if;
  if coalesce(array_length(p_tecnici, 1), 0) = 0 then raise exception 'Scegli almeno un tecnico'; end if;
  select r.nome into mitt from public.responsabili r where r.user_id = auth.uid();
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  select t.id, 'avviso', jsonb_strip_nulls(jsonb_build_object(
    'livello', p_livello, 'titolo', trim(p_titolo), 'testo', nullif(trim(coalesce(p_testo,'')), ''),
    'ora', nullif(trim(coalesce(p_ora,'')), ''), 'luogo', nullif(trim(coalesce(p_luogo,'')), ''),
    'contatto', nullif(trim(coalesce(p_contatto,'')), ''), 'telefono', nullif(trim(coalesce(p_telefono,'')), ''),
    'targa', nullif(trim(coalesce(p_targa,'')), ''), 'da', mitt)), '/t'
  from public.tecnici t where t.id = any(p_tecnici) and t.attivo;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'inviati', n);
end $$;

-- Il tecnico vede tutti i suoi avvisi non letti, non solo gli ultimi 15
create or replace function public.tecnico_notifiche(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'tipo', n.tipo, 'dati', n.dati, 'creato_il', n.creato_il, 'letta', n.letta_il is not null)
                    order by (n.tipo = 'avviso' and n.dati->>'livello' = 'urgente' and n.letta_il is null) desc, n.creato_il desc)
    from public.notifiche n where n.tecnico_id = tid and (n.letta_il is null or n.creato_il > now() - interval '7 days')), '[]');
end $$;

revoke execute on function public.conferma_piano(date), public.invia_avviso(bigint[], text, text, text, text, text, text, text, text), public.tecnico_notifiche(text) from public, anon;
grant execute on function public.conferma_piano(date), public.invia_avviso(bigint[], text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.tecnico_notifiche(text) to anon, authenticated;
