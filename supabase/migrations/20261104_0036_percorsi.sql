-- 0036 Percorsi giornalieri dei tecnici (pagina /percorsi). Non distruttiva.
-- tecnico_id = public.dipendenti.id (la vista tecnici espone lo stesso id).
-- Accesso: solo responsabile flotta e amministratore (is_responsabile). HR e anon: nessun accesso.

create table if not exists public.percorsi (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint references public.dipendenti(id),
  partenza jsonb not null default '{}'::jsonb,
  stops jsonb not null default '[]'::jsonb,
  opzioni jsonb not null default '{}'::jsonb,
  risultato jsonb,
  stato text not null default 'bozza' check (stato in ('bozza', 'confermato')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists percorsi_data_tecnico on public.percorsi (data, tecnico_id) where tecnico_id is not null;
create index if not exists percorsi_data on public.percorsi (data);
comment on table public.percorsi is 'Percorso giornaliero pianificato: partenza, tappe, opzioni e risultato calcolato (tratti, orari, km, totali, avvisi).';

create or replace function privato.percorsi_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create or replace trigger percorsi_updated_at before update on public.percorsi for each row execute function privato.percorsi_updated_at();

alter table public.percorsi enable row level security;
grant select, insert, update, delete on public.percorsi to authenticated;
create policy percorsi_responsabile on public.percorsi for all to authenticated
  using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
