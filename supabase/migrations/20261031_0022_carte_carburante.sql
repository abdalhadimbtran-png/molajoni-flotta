-- Carte carburante Q8: gestione HR (+admin), lettura responsabile flotta, dipendente vede solo la propria (ultime 4 cifre).
-- Mai salvare PAN completo o PIN: solo le ultime 4 cifre.

alter table public.veicoli add column if not exists capacita_serbatoio numeric(6,1);
alter table public.veicoli add column if not exists alimentazione text
  check (alimentazione in ('benzina','diesel','gpl','metano','elettrica','ibrida_benzina','ibrida_diesel'));

create table if not exists public.carte_carburante (
  id bigint generated always as identity primary key,
  ultime4 text not null check (ultime4 ~ '^[0-9]{4}$'),
  circuito text not null default 'Q8',
  veicolo_id bigint references public.veicoli(id),
  scadenza date,
  stato text not null default 'attiva' check (stato in ('attiva','sospesa','smarrita','restituita')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists carte_carburante_ultime4 on public.carte_carburante (ultime4);

create table if not exists public.carte_assegnazioni (
  id bigint generated always as identity primary key,
  carta_id bigint not null references public.carte_carburante(id),
  dipendente_id bigint references public.dipendenti(id),
  veicolo_id bigint references public.veicoli(id),
  dal date not null,
  al date,
  consegnata_da text,
  restituita_a text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (dipendente_id is not null or veicolo_id is not null),
  check (al is null or al >= dal)
);
create index if not exists carte_assegnazioni_carta on public.carte_assegnazioni (carta_id, dal);

alter table public.rifornimenti add column if not exists carta_id bigint references public.carte_carburante(id);
alter table public.rifornimenti add column if not exists ora time;
alter table public.rifornimenti add column if not exists dipendente_id bigint references public.dipendenti(id);

alter table public.carte_carburante enable row level security;
alter table public.carte_assegnazioni enable row level security;
create policy hr_carte on public.carte_carburante for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
create policy resp_carte_lettura on public.carte_carburante for select to authenticated using ((select public.is_responsabile()));
create policy carte_ass_lettura on public.carte_assegnazioni for select to authenticated using ((select public.is_hr()) or (select public.is_responsabile()));
-- storico: nessuna modifica diretta, solo tramite RPC
grant select, insert, update on public.carte_carburante to authenticated;
grant select on public.carte_assegnazioni to authenticated;
-- HR importa gli estratti Q8 e legge i rifornimenti
create policy hr_rifornimenti on public.rifornimenti for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));

-- Risolve veicolo e dipendente all'import: assegnazione carta valida in quella data, poi tecnico pianificato sul veicolo.
create or replace function privato.rifornimento_risolvi() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.carte_assegnazioni;
begin
  if new.carta_id is not null then
    select * into a from public.carte_assegnazioni x
     where x.carta_id = new.carta_id and x.dal <= new.data and (x.al is null or x.al >= new.data)
     order by x.dal desc, x.id desc limit 1;
    if new.dipendente_id is null then new.dipendente_id := a.dipendente_id; end if;
    if new.veicolo_id is null then
      new.veicolo_id := coalesce(a.veicolo_id, (select c.veicolo_id from public.carte_carburante c where c.id = new.carta_id));
    end if;
  end if;
  if new.dipendente_id is null and new.veicolo_id is not null then
    select g.tecnico_id into new.dipendente_id from public.assegnazioni g where g.veicolo_id = new.veicolo_id and g.data = new.data limit 1;
  end if;
  return new;
end $$;
create or replace trigger rifornimenti_risolvi before insert on public.rifornimenti
  for each row execute function privato.rifornimento_risolvi();

create or replace function public.richiedi_hr_o_flotta() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not (public.is_hr() or public.is_responsabile()) then
    raise exception 'Accesso riservato all''ufficio HR o al responsabile flotta' using errcode = '42501';
  end if;
end $$;

-- Assegna (chiude l'assegnazione aperta il giorno prima e ne apre una nuova)
create or replace function public.carta_assegna(p_carta bigint, p_dipendente bigint, p_veicolo bigint, p_dal date, p_consegnata_da text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nid bigint;
begin
  if not public.is_hr() then raise exception 'Accesso riservato all''ufficio HR' using errcode = '42501'; end if;
  if p_dipendente is null and p_veicolo is null then raise exception 'Indica il dipendente o il veicolo.'; end if;
  if exists (select 1 from public.carte_carburante c where c.id = p_carta and c.stato <> 'attiva') then
    raise exception 'La carta non è attiva: riattivala prima di assegnarla.'; end if;
  if exists (select 1 from public.carte_assegnazioni x where x.carta_id = p_carta and x.al is null and x.dal > p_dal) then
    raise exception 'Esiste già un''assegnazione aperta che inizia dopo questa data.'; end if;
  update public.carte_assegnazioni set al = greatest(dal, p_dal - 1) where carta_id = p_carta and al is null;
  insert into public.carte_assegnazioni (carta_id, dipendente_id, veicolo_id, dal, consegnata_da, note)
  values (p_carta, p_dipendente, p_veicolo, p_dal, p_consegnata_da, p_note) returning id into nid;
  if p_veicolo is not null then update public.carte_carburante set veicolo_id = p_veicolo where id = p_carta; end if;
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.carta_restituisci(p_carta bigint, p_al date, p_restituita_a text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_hr() then raise exception 'Accesso riservato all''ufficio HR' using errcode = '42501'; end if;
  update public.carte_assegnazioni set al = greatest(dal, p_al), restituita_a = p_restituita_a,
         note = case when p_note is null then note else concat_ws(' · ', note, p_note) end
   where carta_id = p_carta and al is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'La carta non è assegnata a nessuno.'; end if;
  return jsonb_build_object('chiuse', n);
end $$;

-- Anomalie (una riga per segnalazione)
create or replace function public.anomalie_carburante(p_da date default null, p_a date default null)
returns table (rifornimento_id bigint, data date, ora time, targa text, dipendente text, carta text, litri numeric, importo numeric, tipo text, dettaglio text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.richiedi_hr_o_flotta();
  return query
  with r as (
    select f.*, v.targa, v.capacita_serbatoio cap, v.alimentazione alim, c.ultime4, c.stato cstato, c.scadenza cscad,
           d.nome || ' ' || d.cognome nome_dip, d.data_cessazione,
           (f.data + coalesce(f.ora, time '12:00')) ts
      from public.rifornimenti f join public.veicoli v on v.id = f.veicolo_id
      left join public.carte_carburante c on c.id = f.carta_id
      left join public.dipendenti d on d.id = f.dipendente_id
     where f.data between coalesce(p_da, public.oggi() - 90) and coalesce(p_a, public.oggi())
  ), x as (
    select r.id, 'ferie'::text t, 'Rifornimento mentre il dipendente era assente (approvato)'::text dd from r
     where r.dipendente_id is not null and exists (select 1 from public.assenze s where s.tecnico_id = r.dipendente_id and r.data between s.dal and s.al)
    union all
    select r.id, 'orario', case when extract(isodow from r.data) >= 6 then 'Rifornimento nel fine settimana' else 'Rifornimento tra le 21:00 e le 06:00' end from r
     where extract(isodow from r.data) >= 6 or (r.ora is not null and (r.ora >= time '21:00' or r.ora < time '06:00'))
    union all
    select r.id, 'litri', format('%s litri oltre la capacità del serbatoio (%s l)', r.litri, r.cap) from r where r.cap is not null and r.litri > r.cap
    union all
    select r.id, 'prodotto', format('Prodotto «%s» diverso dall''alimentazione del veicolo (%s)', r.prodotto, r.alim) from r
     where r.alim is not null and r.prodotto is not null and (
       (r.alim in ('diesel','ibrida_diesel') and r.prodotto ~* '(benzin|senza ?piombo|sp ?9[58]|super|gpl|metano)' and r.prodotto !~* '(diesel|gasolio)')
       or (r.alim in ('benzina','ibrida_benzina','gpl','metano') and r.prodotto ~* '(diesel|gasolio)')
       or (r.alim = 'elettrica'))
    union all
    select r.id, 'km', format('Km dichiarati %s incoerenti con le letture QR (%s – %s)', r.km, k.prima, k.dopo) from r
      cross join lateral (select (select max(m.km) from public.movimenti m where m.veicolo_id = r.veicolo_id and (m.creato_il at time zone 'Europe/Rome')::date < r.data) prima,
                                 (select min(m.km) from public.movimenti m where m.veicolo_id = r.veicolo_id and (m.creato_il at time zone 'Europe/Rome')::date > r.data) dopo) k
     where r.km is not null and (r.km < k.prima - 20 or r.km > k.dopo + 20)
    union all
    select r.id, 'ravvicinati', format('Due rifornimenti in meno di 24 ore (%s l in totale)', r.litri + o.litri) from r
      join r o on o.veicolo_id = r.veicolo_id and o.id <> r.id and abs(extract(epoch from (o.ts - r.ts))) < 86400
     where r.litri + o.litri > coalesce(r.cap, 60)
    union all
    select r.id, 'cessato', 'Carta usata da un dipendente con rapporto cessato' from r where r.data_cessazione is not null and r.data > r.data_cessazione
    union all
    select r.id, 'carta', case when r.cscad < r.data then 'Carta scaduta in uso' else format('Carta in stato «%s» in uso', r.cstato) end from r
     where r.carta_id is not null and (r.cscad < r.data or r.cstato <> 'attiva')
  )
  select distinct on (x.id, x.t, x.dd) r.id, r.data, r.ora, r.targa, r.nome_dip, case when r.ultime4 is null then null else '•••• ' || r.ultime4 end,
         r.litri, r.importo, x.t, x.dd
    from x join r on r.id = x.id
   order by x.id, x.t, x.dd;
end $$;

-- Carte attive assegnate a dipendenti cessati (anomalia senza rifornimento)
create or replace function public.carte_da_ritirare() returns table (carta_id bigint, carta text, dipendente text, data_cessazione date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.richiedi_hr_o_flotta();
  return query select c.id, '•••• ' || c.ultime4, d.nome || ' ' || d.cognome, d.data_cessazione
    from public.carte_carburante c join public.carte_assegnazioni a on a.carta_id = c.id and a.al is null
    join public.dipendenti d on d.id = a.dipendente_id
   where c.stato = 'attiva' and d.data_cessazione is not null and d.data_cessazione < public.oggi();
end $$;

-- Report consumi e spesa
create or replace function public.report_carburante(p_tipo text, p_da date, p_a date, p_veicolo bigint default null, p_tecnico bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  perform public.richiedi_hr_o_flotta();
  if p_tipo = 'consumi_veicoli' then
    select coalesce(jsonb_agg(x order by x->>'targa'), '[]') into res from (
      select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'alimentazione', v.alimentazione,
        'rifornimenti', f.n, 'litri', f.litri, 'importo', f.eur, 'km_percorsi', k.km,
        'l_100km', case when k.km > 0 then round(f.litri * 100 / k.km, 2) end,
        'eur_km', case when k.km > 0 then round(f.eur / k.km, 3) end) x
      from public.veicoli v
      cross join lateral (select count(*) n, coalesce(sum(r.litri), 0) litri, coalesce(sum(r.importo), 0) eur from public.rifornimenti r
                           where r.veicolo_id = v.id and r.data between p_da and p_a) f
      cross join lateral (select max(m.km) - min(m.km) km from public.movimenti m
                           where m.veicolo_id = v.id and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a) k
      where (p_veicolo is null or v.id = p_veicolo) and f.n > 0) s;
  elsif p_tipo = 'spesa_mensile' then
    select coalesce(jsonb_agg(x order by x->>'mese', x->>'targa', x->>'dipendente'), '[]') into res from (
      select jsonb_build_object('mese', to_char(r.data, 'YYYY-MM'), 'targa', v.targa,
        'dipendente', coalesce(d.nome || ' ' || d.cognome, 'Non attribuito'), 'rifornimenti', count(*),
        'litri', sum(r.litri), 'importo', sum(r.importo)) x
      from public.rifornimenti r join public.veicoli v on v.id = r.veicolo_id left join public.dipendenti d on d.id = r.dipendente_id
      where r.data between p_da and p_a and (p_veicolo is null or r.veicolo_id = p_veicolo) and (p_tecnico is null or r.dipendente_id = p_tecnico)
      group by to_char(r.data, 'YYYY-MM'), v.targa, d.nome, d.cognome, r.dipendente_id) s;
  else raise exception 'Report sconosciuto';
  end if;
  return jsonb_build_object('righe', res);
end $$;

-- Dipendente: solo la propria carta (ultime 4 + stato)
create or replace function public.dipendente_carta(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('ultime4', c.ultime4, 'circuito', c.circuito, 'stato', c.stato, 'scadenza', c.scadenza))
    from public.carte_carburante c join public.carte_assegnazioni a on a.carta_id = c.id
   where a.dipendente_id = did and a.dal <= public.oggi() and (a.al is null or a.al >= public.oggi())), '[]');
end $$;

-- (EXECUTE di default anche per anon: le funzioni rifiutano chi non è HR/flotta)
grant execute on function public.carta_assegna(bigint, bigint, bigint, date, text, text), public.carta_restituisci(bigint, date, text, text),
  public.anomalie_carburante(date, date), public.carte_da_ritirare(), public.report_carburante(text, date, date, bigint, bigint), public.richiedi_hr_o_flotta() to authenticated;
grant execute on function public.dipendente_carta(text) to anon, authenticated;
