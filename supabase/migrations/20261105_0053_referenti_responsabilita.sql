-- 0053 Referenti e responsabilità: UNA sola fonte per persone, email e compiti.
-- Le impostazioni usate finora (commerciali_offerte_grandi, cc_offerte_grandi, commerciali, destinatari_trasferimento,
-- amministrazione, fornitori, sostituto) diventano DERIVATE: un trigger le riscrive a ogni modifica dei referenti,
-- così trasferimenti, assegnazioni, copie, disponibilità e modelli leggono sempre da qui. Non distruttiva.

create table if not exists public.referenti (
  id bigint generated always as identity primary key,
  nome text not null unique check (length(btrim(nome)) between 2 and 120),
  ruolo text,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefono text,
  cellulare text,
  attivo boolean not null default true,
  user_id uuid references auth.users(id),
  responsabilita text[] not null default '{}' check (responsabilita <@ array['offerte_grandi','offerte_piccole','sopralluoghi','amministrazione','fornitori','interventi','sostituto','formazione','flotta','trasferte','abbigliamento']),
  note text,
  ordine int not null default 100,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid()
);
comment on table public.referenti is 'Persone a cui il centralino passa chiamate e pratiche, con i loro compiti. Fonte unica: le impostazioni derivate si aggiornano da sole.';
alter table public.referenti enable row level security;
create policy referenti_leggi on public.referenti for select to authenticated using ((select public.is_centralino_lettura()));
create policy referenti_inserisci on public.referenti for insert to authenticated with check ((select public.is_centralino()));
create policy referenti_scrivi on public.referenti for update to authenticated using ((select public.is_centralino())) with check ((select public.is_centralino()));
grant select, insert, update on public.referenti to authenticated;
create trigger referenti_agg before update on public.referenti for each row execute function privato.tg_config_aggiornata();

insert into public.referenti (nome, ruolo, responsabilita, note, ordine) values
  ('Jennifer Marchetti', 'Front office', '{offerte_piccole}', null, 10),
  ('L. Esposito', 'Tecnico commerciale', '{offerte_grandi,sopralluoghi}', null, 20),
  ('A. Chiaradonna', 'Tecnico commerciale', '{offerte_grandi,sopralluoghi}', null, 21),
  ('A. Querini', 'Tecnico commerciale', '{offerte_grandi,sopralluoghi}', null, 22),
  ('Simona Colagrossi', 'Amministrazione', '{amministrazione,sostituto}', 'Tasto 2 · fatture · al pomeriggio sul cellulare', 30),
  ('Roberta Felci', 'Fornitori', '{fornitori}', 'Tasto 3 · fornitori lunedì e venerdì', 40),
  ('Tecnico', 'Tecnico manutentore', '{interventi}', 'Interventi: via Taylor con alert e Documento di Intervento', 50)
on conflict (nome) do nothing;
-- riporta le email già inserite nelle vecchie impostazioni
update public.referenti r set email = lower(x->>'email')
  from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x
 where i.chiave in ('destinatari_trasferimento', 'commerciali_offerte_grandi') and x->>'nome' = r.nome and nullif(x->>'email', '') is not null and r.email is null;

create or replace function privato.ct_deriva_referenti() returns void
language plpgsql security definer set search_path = '' as $$
declare
  nomi jsonb := '{"offerte_grandi":"offerte oltre 1.000 €","offerte_piccole":"offerte fino a 1.000 €","sopralluoghi":"sopralluoghi","amministrazione":"fatture","fornitori":"fornitori","interventi":"interventi","sostituto":"sostituto centralino","formazione":"formazione","flotta":"flotta","trasferte":"trasferte","abbigliamento":"abbigliamento"}';
  per jsonb;
begin
  per := (select jsonb_object_agg(k, coalesce(v, '[]'::jsonb)) from (
    select k.k, (select jsonb_agg(jsonb_build_object('nome', r.nome, 'email', coalesce(r.email, '')) order by r.ordine, r.nome)
                   from public.referenti r where r.attivo and k.k = any (r.responsabilita)) v
      from jsonb_object_keys(nomi) k(k)) t);
  update public.centralino_impostazioni set valore = per->'offerte_grandi' where chiave = 'commerciali_offerte_grandi';
  update public.centralino_impostazioni set valore = per->'offerte_grandi' where chiave = 'cc_offerte_grandi';
  update public.centralino_impostazioni set valore = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(per->'sopralluoghi' || per->'offerte_grandi') x) where chiave = 'commerciali';
  update public.centralino_impostazioni set valore = coalesce(per->'amministrazione'->0, '{"nome":"","email":""}') where chiave = 'amministrazione';
  update public.centralino_impostazioni set valore = coalesce(per->'fornitori'->0, '{"nome":"","email":""}') || '{"giorni":"lunedì e venerdì"}' where chiave = 'fornitori';
  update public.centralino_impostazioni set valore = to_jsonb(coalesce(per->'sostituto'->0->>'nome', '')) where chiave = 'sostituto';
  update public.centralino_impostazioni set valore = (
    select coalesce(jsonb_agg(jsonb_build_object('nome', r.nome, 'ruolo', coalesce(r.ruolo, ''), 'email', coalesce(r.email, ''),
             'nota', concat_ws(' · ', nullif((select string_agg(nomi->>x, ', ') from unnest(r.responsabilita) x), ''), r.note)) order by r.ordine, r.nome), '[]'::jsonb)
      || '[{"nome":"Altro","ruolo":"altro","email":"","nota":""}]'::jsonb
      from public.referenti r where r.attivo and not ('offerte_piccole' = any (r.responsabilita) and cardinality(r.responsabilita) = 1))
   where chiave = 'destinatari_trasferimento';
  update public.centralino_impostazioni set descrizione = 'Derivata da «Referenti e responsabilità» (non modificare qui).'
   where chiave in ('commerciali_offerte_grandi', 'cc_offerte_grandi', 'commerciali', 'amministrazione', 'fornitori', 'sostituto', 'destinatari_trasferimento');
end $$;

create or replace function privato.tg_referenti_deriva() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform privato.ct_deriva_referenti(); return null; end $$;
create trigger referenti_deriva after insert or update on public.referenti for each statement execute function privato.tg_referenti_deriva();

select privato.ct_deriva_referenti();

-- responsabilità senza email (avvisi nella pagina)
create or replace function public.centralino_referenti_avvisi() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return jsonb_build_object(
    'senza_email', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'responsabilita', responsabilita)) from public.referenti where attivo and email is null and cardinality(responsabilita) > 0), '[]'),
    'scoperte', coalesce((select jsonb_agg(k) from unnest(array['offerte_grandi','offerte_piccole','sopralluoghi','amministrazione','fornitori','interventi','sostituto','formazione','flotta','trasferte','abbigliamento']) k
                          where not exists (select 1 from public.referenti r where r.attivo and k = any (r.responsabilita))), '[]'));
end $$;
grant execute on function public.centralino_referenti_avvisi() to authenticated;
