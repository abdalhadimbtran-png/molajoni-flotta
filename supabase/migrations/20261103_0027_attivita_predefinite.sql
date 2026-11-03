-- Elenco di attività predefinite da scegliere negli interventi. Non si eliminano: si disattivano.
create table if not exists public.attivita_predefinite (
  id bigint generated always as identity primary key,
  nome text not null unique check (btrim(nome) <> ''),
  gruppo text,
  durata_minuti int check (durata_minuti is null or durata_minuti between 5 and 1440),
  ordine int not null default 0,
  attiva boolean not null default true,
  creato_il timestamptz not null default now()
);
alter table public.attivita_predefinite enable row level security;
create policy attivita_predefinite_lettura on public.attivita_predefinite for select to authenticated
  using ((select public.is_responsabile()) or (select public.is_hr()));
create policy attivita_predefinite_inserisci on public.attivita_predefinite for insert to authenticated
  with check ((select public.is_responsabile()));
create policy attivita_predefinite_modifica on public.attivita_predefinite for update to authenticated
  using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
-- nessuna policy di delete: le voci si disattivano
grant select, insert, update on public.attivita_predefinite to authenticated;

insert into public.attivita_predefinite (nome, gruppo, durata_minuti, ordine) values
  ('Controllo semestrale estintori', 'Estintori', 120, 10),
  ('Ritiro estintori', 'Estintori', 60, 20),
  ('Manutenzione idranti', 'Idranti', 180, 30),
  ('Verifica porte tagliafuoco', 'Porte REI', 120, 40),
  ('Manutenzione impianto IRAI', 'IRAI', 240, 50),
  ('Prova impianto EVAC', 'EVAC', 120, 60),
  ('Sopralluogo', 'Altro', 60, 70),
  ('Installazione', 'Altro', 240, 80),
  ('Riparazione', 'Altro', 120, 90),
  ('Consegna materiale', 'Altro', 60, 100)
on conflict (nome) do nothing;
