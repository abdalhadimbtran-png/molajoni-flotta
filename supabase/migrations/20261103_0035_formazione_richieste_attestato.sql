-- 0035 Attestati dal dipendente solo su richiesta del responsabile formazione.
-- Il responsabile prepara la registrazione (corso, data, scadenza) e chiede l'attestato; il dipendente carica solo il file.
-- La tabella attestati_proposti (0034) resta inutilizzata: dipendente_proponi_attestato è disattivata.

create table if not exists public.richieste_attestato (
  id bigint generated always as identity primary key,
  corso_dipendente_id bigint not null references public.corsi_dipendente(id),
  stato text not null default 'richiesto' check (stato in ('richiesto', 'da_verificare', 'approvato', 'rifiutato')),
  path text unique, nome_file text, mime text, motivo text,
  richiesto_da uuid default auth.uid(), richiesto_il timestamptz not null default now(),
  ultimo_promemoria timestamptz, caricato_il timestamptz,
  deciso_da uuid, deciso_il timestamptz
);
create unique index if not exists richieste_attestato_aperta on public.richieste_attestato (corso_dipendente_id)
  where stato in ('richiesto', 'da_verificare', 'rifiutato');
comment on table public.richieste_attestato is 'Richiesta di attestato al dipendente. Audit: richiesto_da/il, caricato_il (dipendente), deciso_da/il.';
alter table public.richieste_attestato enable row level security;
grant select on public.richieste_attestato to authenticated;
create policy ra_leggi on public.richieste_attestato for select to authenticated
  using ((select public.is_formazione()) or (select public.is_hr()));

create or replace function public.dipendente_proponi_attestato(p_token text, p_corso bigint, p_corso_testo text, p_data date,
  p_path text, p_nome text, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin raise exception 'Puoi caricare solo gli attestati richiesti dal responsabile formazione.'; end $$;

create or replace function privato.notifica_dipendente_attestato(p_dip bigint, p_titolo text, p_testo text, p_livello text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (p_dip, 'avviso', jsonb_build_object('categoria', 'formazione', 'livello', p_livello, 'titolo', p_titolo, 'testo', p_testo), '/t/profilo');
$$;

create or replace function public.formazione_chiedi_attestato(p_registrazioni bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record;
begin
  perform privato.richiedi_formazione();
  for r in select cd.id, cd.dipendente_id, c.nome from public.corsi_dipendente cd join public.corsi c on c.id = cd.corso_id
            where cd.id = any(p_registrazioni)
              and not exists (select 1 from public.richieste_attestato x where x.corso_dipendente_id = cd.id and x.stato in ('richiesto', 'da_verificare', 'rifiutato'))
  loop
    insert into public.richieste_attestato (corso_dipendente_id) values (r.id);
    perform privato.notifica_dipendente_attestato(r.dipendente_id, 'Carica il tuo attestato', r.nome || ': apri il profilo e carica la foto o il PDF.', 'importante');
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'richieste', n);
end $$;

create or replace function public.formazione_ricorda_attestato(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform privato.richiedi_formazione();
  select q.id, cd.dipendente_id, c.nome, q.stato into r from public.richieste_attestato q
    join public.corsi_dipendente cd on cd.id = q.corso_dipendente_id join public.corsi c on c.id = cd.corso_id where q.id = p_id;
  if r is null or r.stato not in ('richiesto', 'rifiutato') then raise exception 'Richiesta non in attesa'; end if;
  update public.richieste_attestato set ultimo_promemoria = now() where id = p_id;
  perform privato.notifica_dipendente_attestato(r.dipendente_id, 'Promemoria: carica il tuo attestato', r.nome, 'importante');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dipendente_attestati_richiesti(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'corso', c.nome, 'stato', q.stato, 'motivo', q.motivo,
      'data_conseguimento', cd.data_conseguimento) order by q.richiesto_il desc)
    from public.richieste_attestato q join public.corsi_dipendente cd on cd.id = q.corso_dipendente_id join public.corsi c on c.id = cd.corso_id
   where cd.dipendente_id = did and (q.stato <> 'approvato' or q.deciso_il > now() - interval '30 days')), '[]');
end $$;

-- chiamata dalla edge function dopo il caricamento in dip/<id>/
create or replace function public.dipendente_carica_attestato(p_token text, p_id bigint, p_path text, p_nome text, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); r record;
begin
  if p_path is null or p_path not like 'dip/' || did || '/%' then raise exception 'File non valido'; end if;
  select q.id, q.stato, c.nome as corso, d.cognome || ' ' || d.nome as nome into r
    from public.richieste_attestato q join public.corsi_dipendente cd on cd.id = q.corso_dipendente_id
    join public.corsi c on c.id = cd.corso_id join public.dipendenti d on d.id = cd.dipendente_id
   where q.id = p_id and cd.dipendente_id = did for update of q;
  if r is null then raise exception 'Richiesta non trovata'; end if;
  if r.stato not in ('richiesto', 'rifiutato') then raise exception 'Questo attestato è già stato caricato.'; end if;
  update public.richieste_attestato set stato = 'da_verificare', path = p_path, nome_file = left(p_nome, 120), mime = left(p_mime, 60),
         motivo = null, caricato_il = now() where id = p_id;
  perform privato.notifica_formazione('Attestato da verificare', r.nome || ' ha caricato l''attestato: ' || r.corso, '/formazione');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.formazione_approva_richiesta(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.richieste_attestato; cd public.corsi_dipendente;
begin
  perform privato.richiedi_formazione();
  select * into q from public.richieste_attestato where id = p_id for update;
  if q is null or q.stato <> 'da_verificare' then raise exception 'Niente da approvare'; end if;
  select * into cd from public.corsi_dipendente where id = q.corso_dipendente_id;
  insert into public.corsi_attestati (corso_dipendente_id, path, nome_file, mime, caricato_da_dipendente) values (cd.id, q.path, q.nome_file, q.mime, true);
  update public.richieste_attestato set stato = 'approvato', deciso_da = auth.uid(), deciso_il = now() where id = p_id;
  perform privato.notifica_dipendente_attestato(cd.dipendente_id, 'Attestato approvato', (select nome from public.corsi where id = cd.corso_id), 'info');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.formazione_rifiuta_richiesta(p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.richieste_attestato; cd public.corsi_dipendente;
begin
  perform privato.richiedi_formazione();
  if nullif(btrim(p_motivo), '') is null then raise exception 'Scrivi il motivo del rifiuto.'; end if;
  select * into q from public.richieste_attestato where id = p_id for update;
  if q is null or q.stato <> 'da_verificare' then raise exception 'Niente da rifiutare'; end if;
  select * into cd from public.corsi_dipendente where id = q.corso_dipendente_id;
  update public.richieste_attestato set stato = 'rifiutato', motivo = left(btrim(p_motivo), 300), deciso_da = auth.uid(), deciso_il = now() where id = p_id;
  perform privato.notifica_dipendente_attestato(cd.dipendente_id, 'Attestato da ricaricare', left(btrim(p_motivo), 300), 'importante');
  return jsonb_build_object('ok', true);
end $$;
