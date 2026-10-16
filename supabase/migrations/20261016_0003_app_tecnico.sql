-- App tecnico: veicolo del piano apribile dalla home + elenco veicoli (se il QR non si legge)
create or replace function public.tecnico_home(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); t public.tecnici; d date; giorni jsonb := '[]'; vid bigint;
begin
  select * into t from public.tecnici where id = tid;
  foreach d in array array[public.oggi(), public.prossimo_lavorativo(public.oggi())] loop
    vid := null;
    select g.veicolo_id into vid from public.assegnazioni g where g.tecnico_id = tid and g.data = d;
    giorni := giorni || jsonb_build_object(
      'data', d,
      'confermato', exists (select 1 from public.piani p where p.data = d),
      'assenza', (select x.motivo from public.assenze x where x.tecnico_id = tid and d between x.dal and x.al limit 1),
      'veicolo', (select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'qr', v.qr_token) from public.veicoli v where v.id = vid and not v.dismesso),
      'interventi', coalesce((select jsonb_agg(jsonb_build_object('ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita) order by i.ora nulls last, i.id)
                              from public.interventi i where i.tecnico_id = tid and i.data = d), '[]'));
  end loop;
  return jsonb_build_object(
    'nome', t.nome || ' ' || t.cognome, 'codice', t.codice,
    'avvisi', coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_tecnico(tid) c where c.messaggio not like 'Assente%'), '[]'),
    'in_carico', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'km', v.km_attuali, 'dal', v.in_carico_dal, 'qr', v.qr_token))
                           from public.veicoli v where v.tecnico_in_carico = tid), '[]'),
    'giorni', giorni,
    'segnalazioni', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'categoria', s.categoria, 'gravita', s.gravita, 'stato', s.stato, 'creato_il', s.creato_il) order by s.creato_il desc)
                              from public.segnalazioni s join public.veicoli v on v.id = s.veicolo_id
                              where s.tecnico_id = tid and (s.stato <> 'chiusa' or s.creato_il > now() - interval '14 days')), '[]'));
end $$;

create or replace function public.tecnico_elenco_veicoli(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'targa', v.targa, 'modello', v.marca_modello, 'qr', v.qr_token,
      'in_carico_a', (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico),
      'mio', coalesce(v.tecnico_in_carico = tid, false),
      'utilizzabile', not exists (select 1 from public.controlli_veicolo(v.id) c where c.livello = 'ko')) order by v.targa)
    from public.veicoli v where not v.dismesso), '[]');
end $$;

revoke execute on function public.tecnico_home(text), public.tecnico_elenco_veicoli(text) from public;
grant execute on function public.tecnico_home(text), public.tecnico_elenco_veicoli(text) to anon, authenticated;
