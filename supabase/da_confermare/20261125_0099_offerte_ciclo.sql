-- 0099 Ciclo di vita delle OFFERTE (richiesta del titolare, 25/11/2026).
-- Una riga per offerta (pratica di tipo offerta_*) in public.pratiche_offerta, separata dall'esito della pratica del centralino:
-- la pratica «passata al commerciale» si chiude al centralino, ma l'offerta resta aperta finché non è inviata e poi accettata o no.
-- Solo aggiunte: nuova tabella, nuove funzioni, CHECK degli eventi allargato (+ 'offerta'), report_sez_centralino riscritta.

-- 1. Tabella
create table if not exists public.pratiche_offerta (
  pratica_id bigint primary key references public.pratiche(id) on delete cascade,
  gestione text not null check (gestione in ('jennifer', 'collega')),
  gestita_da text not null,
  arrivata_il timestamptz not null,
  scadenza timestamptz not null,
  inviata_il timestamptz,
  esito text not null default 'da_inviare' check (esito in ('da_inviare', 'in_attesa', 'accettata', 'non_accettata', 'annullata')),
  esito_il timestamptz,
  motivo text check (motivo in ('Prezzo', 'Tempi', 'Scelto un concorrente', 'Nessuna risposta del cliente', 'Non più necessario', 'Altro')),
  motivo_nota text,
  motivo_ritardo text,
  numero_offerta_adhoc text,
  aggiornata_il timestamptz not null default now(),
  aggiornata_da text,
  creata_il timestamptz not null default now()
);
create index if not exists pratiche_offerta_arrivata on public.pratiche_offerta (arrivata_il);
create index if not exists pratiche_offerta_aperte on public.pratiche_offerta (esito) where esito in ('da_inviare', 'in_attesa');
alter table public.pratiche_offerta enable row level security;
drop policy if exists po_leggi on public.pratiche_offerta;
create policy po_leggi on public.pratiche_offerta for select to authenticated using ((select public.is_centralino_lettura()));
revoke all on public.pratiche_offerta from anon, public;
grant select on public.pratiche_offerta to authenticated;

alter table public.pratiche_eventi drop constraint if exists pratiche_eventi_tipo_check;
alter table public.pratiche_eventi add constraint pratiche_eventi_tipo_check check (tipo = any (array['creata','stato','nota','email_inviata',
  'chiamata','assegnata','appuntamento','allegato','sla_scaduto','chiusa','modifica','offerta']));

-- 2. Scadenza: Jennifer 60 minuti; colleghi 2 giorni lavorativi (lun–ven, esclusa public.festivita), stessa ora di Roma.
create or replace function public.offerta_scadenza(p_arrivata timestamptz, p_gestione text)
 returns timestamptz language plpgsql stable security definer set search_path to ''
as $function$
declare l timestamp := p_arrivata at time zone 'Europe/Rome'; g date := l::date;
begin
  if p_gestione = 'jennifer' then return p_arrivata + interval '60 minutes'; end if;
  g := public.prossimo_lavorativo(public.prossimo_lavorativo(g));
  return (g + l::time) at time zone 'Europe/Rome';
end $function$;
revoke all on function public.offerta_scadenza(timestamptz, text) from public, anon;
grant execute on function public.offerta_scadenza(timestamptz, text) to authenticated;

-- 3. Riga automatica per ogni pratica offerta (insert e cambio tipo/commerciale); invio Jennifer = chiusura della pratica (email 2).
create or replace function privato.offerta_sincronizza() returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_ges text; v_chi text; o public.pratiche_offerta;
begin
  if new.tipo not like 'offerta%' then return new; end if;
  v_ges := case when new.tipo = 'offerta_grande' then 'collega' else 'jennifer' end;
  v_chi := case when v_ges = 'jennifer' then 'Jennifer' else coalesce(nullif(btrim(new.commerciale_nome), ''), nullif(btrim(new.assegnato_nome), ''), 'Tecnico Commerciale') end;
  select * into o from public.pratiche_offerta where pratica_id = new.id;
  if not found then
    insert into public.pratiche_offerta (pratica_id, gestione, gestita_da, arrivata_il, scadenza, aggiornata_il, aggiornata_da)
    values (new.id, v_ges, v_chi, new.created_at, public.offerta_scadenza(new.created_at, v_ges), new.created_at, 'Centralino')
    returning * into o;
  elsif o.esito = 'da_inviare' and (o.gestione <> v_ges or (v_ges = 'collega' and o.gestita_da = 'Tecnico Commerciale' and v_chi <> o.gestita_da)) then
    update public.pratiche_offerta set gestione = v_ges, gestita_da = v_chi, scadenza = public.offerta_scadenza(o.arrivata_il, v_ges)
     where pratica_id = new.id returning * into o;
  end if;
  -- Jennifer: la pratica chiusa ok = offerta inviata (email 2 o registrata dopo)
  if o.gestione = 'jennifer' and new.esito = 'chiusa_ok' and o.inviata_il is null then
    update public.pratiche_offerta set inviata_il = coalesce(new.closed_at, now()),
           esito = case when esito = 'da_inviare' then 'in_attesa' else esito end
     where pratica_id = new.id;
  end if;
  -- pratica annullata al centralino → offerta annullata (se non già chiusa)
  if new.esito = 'annullata' and o.esito in ('da_inviare', 'in_attesa') then
    update public.pratiche_offerta set esito = 'annullata', esito_il = coalesce(new.closed_at, now()), motivo = 'Altro',
           motivo_nota = coalesce(motivo_nota, 'Pratica annullata al centralino') where pratica_id = new.id;
  end if;
  return new;
end $function$;
drop trigger if exists pratiche_offerta_sync on public.pratiche;
create trigger pratiche_offerta_sync after insert or update of tipo, commerciale_nome, assegnato_nome, esito on public.pratiche
  for each row execute function privato.offerta_sincronizza();

-- 4. Backfill delle offerte esistenti (Jennifer: invio = chiusura della pratica, cioè email 2 «offerta inviata»)
insert into public.pratiche_offerta (pratica_id, gestione, gestita_da, arrivata_il, scadenza, inviata_il, esito, aggiornata_il, aggiornata_da)
select p.id, g.ges,
       case when g.ges = 'jennifer' then 'Jennifer' else coalesce(nullif(btrim(p.commerciale_nome), ''), nullif(btrim(p.assegnato_nome), ''), 'Tecnico Commerciale') end,
       p.created_at, public.offerta_scadenza(p.created_at, g.ges),
       case when g.ges = 'jennifer' and p.esito = 'chiusa_ok' then coalesce(
         (select min(e.at) from public.pratiche_eventi e where e.pratica_id = p.id and e.tipo = 'chiusa'), p.closed_at) end,
       case when p.esito = 'annullata' then 'annullata' when g.ges = 'jennifer' and p.esito = 'chiusa_ok' then 'in_attesa' else 'da_inviare' end,
       coalesce(p.closed_at, p.created_at), 'Centralino'
  from public.pratiche p cross join lateral (select case when p.tipo = 'offerta_grande' then 'collega' else 'jennifer' end ges) g
 where p.tipo like 'offerta%'
on conflict (pratica_id) do nothing;
update public.pratiche_offerta set motivo = 'Altro', motivo_nota = 'Pratica annullata al centralino', esito_il = aggiornata_il
 where esito = 'annullata' and motivo is null;

-- 5. RPC: aggiorna l'offerta (solo centralino/admin), con motivi obbligatori.
create or replace function public.offerta_aggiorna(p_id bigint, p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare o public.pratiche_offerta; n public.pratiche_offerta; v_ts timestamptz; v_imp numeric; parti text[] := '{}';
  fmt constant text := 'DD/MM HH24:MI';
begin
  perform privato.richiedi_centralino();
  select * into o from public.pratiche_offerta where pratica_id = p_id for update;
  if not found then raise exception 'Offerta non trovata'; end if;
  n := o;
  if p ? 'arrivata_il' then
    begin v_ts := (p->>'arrivata_il')::timestamptz; exception when others then raise exception 'Data di arrivo non valida'; end;
    if v_ts is null then raise exception 'Indica quando è arrivata la richiesta'; end if;
    if v_ts > now() + interval '2 minutes' then raise exception 'La data di arrivo non può essere nel futuro'; end if;
    if v_ts < now() - interval '60 days' then raise exception 'Data di arrivo troppo vecchia (massimo 60 giorni)'; end if;
    n.arrivata_il := v_ts; parti := parti || ('Arrivata il ' || to_char(v_ts at time zone 'Europe/Rome', fmt));
  end if;
  if p ? 'gestita_da' then
    if btrim(coalesce(p->>'gestita_da', '')) = 'Jennifer' then n.gestione := 'jennifer'; n.gestita_da := 'Jennifer';
    elsif exists (select 1 from public.referenti r where r.attivo and r.nome = btrim(p->>'gestita_da')) then n.gestione := 'collega'; n.gestita_da := btrim(p->>'gestita_da');
    else raise exception 'Scegli Jennifer o un referente attivo'; end if;
    parti := parti || ('Gestita da ' || n.gestita_da);
  end if;
  n.scadenza := public.offerta_scadenza(n.arrivata_il, n.gestione);
  if p ? 'inviata_il' then
    if nullif(p->>'inviata_il', '') is null then n.inviata_il := null;
    else
      begin v_ts := (p->>'inviata_il')::timestamptz; exception when others then raise exception 'Data di invio non valida'; end;
      if v_ts > now() + interval '2 minutes' then raise exception 'La data di invio non può essere nel futuro'; end if;
      n.inviata_il := v_ts; parti := parti || ('Inviata il ' || to_char(v_ts at time zone 'Europe/Rome', fmt));
      if n.esito = 'da_inviare' then n.esito := 'in_attesa'; end if;
    end if;
  end if;
  if n.inviata_il is not null and n.inviata_il < n.arrivata_il then raise exception 'L''invio non può essere prima dell''arrivo'; end if;
  if p ? 'motivo_ritardo' then n.motivo_ritardo := nullif(btrim(p->>'motivo_ritardo'), ''); if n.motivo_ritardo is not null then parti := parti || ('Motivo ritardo: ' || n.motivo_ritardo); end if; end if;
  if p ? 'numero_offerta_adhoc' then n.numero_offerta_adhoc := nullif(btrim(p->>'numero_offerta_adhoc'), ''); parti := parti || ('N. offerta Ad Hoc: ' || coalesce(n.numero_offerta_adhoc, '—')); end if;
  if p ? 'esito' then
    if p->>'esito' not in ('da_inviare', 'in_attesa', 'accettata', 'non_accettata', 'annullata') then raise exception 'Stato non valido'; end if;
    n.esito := p->>'esito'; n.esito_il := now();
    n.motivo := nullif(p->>'motivo', ''); n.motivo_nota := nullif(btrim(coalesce(p->>'motivo_nota', '')), '');
    if n.esito = 'accettata' and n.inviata_il is null then raise exception 'Prima segna l''offerta come inviata'; end if;
    if n.esito = 'in_attesa' and n.inviata_il is null then raise exception 'Prima segna l''offerta come inviata'; end if;
    if n.esito in ('non_accettata', 'annullata') then
      if n.motivo is null then raise exception 'Scegli il motivo'; end if;
      if n.motivo = 'Altro' and n.motivo_nota is null then raise exception 'Motivo «Altro»: scrivi una nota'; end if;
    else n.motivo := null; n.motivo_nota := null;
    end if;
    parti := parti || (case n.esito when 'accettata' then 'Accettata' when 'non_accettata' then 'Non accettata' when 'annullata' then 'Annullata'
      when 'in_attesa' then 'In attesa di risposta' else 'Da inviare' end || coalesce(' · ' || n.motivo, '') || coalesce(' · ' || n.motivo_nota, ''));
  end if;
  if n.inviata_il is null and n.esito in ('in_attesa', 'accettata') then n.esito := 'da_inviare'; end if;
  -- ritardo: motivo obbligatorio SOLO per le offerte di Jennifer (decisione 25/11: per i colleghi «Scaduta» è solo informativa)
  if n.gestione = 'jennifer' and n.motivo_ritardo is null and ((n.inviata_il is not null and n.inviata_il > n.scadenza)
     or (n.esito = 'annullata' and n.inviata_il is null and now() > n.scadenza and n.motivo <> 'Non più necessario')) then
    raise exception 'Offerta in ritardo: scrivi il motivo del ritardo';
  end if;
  if p ? 'importo' then
    begin v_imp := nullif(p->>'importo', '')::numeric; exception when others then raise exception 'Importo non valido'; end;
    if v_imp < 0 then raise exception 'Importo non valido'; end if;
    update public.pratiche set importo_stimato = v_imp, updated_at = now() where id = p_id;
    parti := parti || ('Importo ' || coalesce(v_imp::text || ' €', '—'));
  end if;
  update public.pratiche_offerta set gestione = n.gestione, gestita_da = n.gestita_da, arrivata_il = n.arrivata_il, scadenza = n.scadenza,
    inviata_il = n.inviata_il, esito = n.esito, esito_il = n.esito_il, motivo = n.motivo, motivo_nota = n.motivo_nota,
    motivo_ritardo = n.motivo_ritardo, numero_offerta_adhoc = n.numero_offerta_adhoc, aggiornata_il = now(), aggiornata_da = privato.ct_autore()
   where pratica_id = p_id returning * into n;
  perform privato.ct_evento(p_id, 'offerta', null, null, array_to_string(parti, ' · '), jsonb_build_object('offerta', to_jsonb(n)));
  return to_jsonb(n);
end $function$;
revoke all on function public.offerta_aggiorna(bigint, jsonb) from public, anon;
grant execute on function public.offerta_aggiorna(bigint, jsonb) to authenticated;

create or replace function public.offerta_nota(p_id bigint, p_testo text)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform privato.richiedi_centralino();
  if nullif(btrim(coalesce(p_testo, '')), '') is null then raise exception 'Scrivi l''aggiornamento'; end if;
  update public.pratiche_offerta set aggiornata_il = now(), aggiornata_da = privato.ct_autore() where pratica_id = p_id;
  if not found then raise exception 'Offerta non trovata'; end if;
  perform privato.ct_evento(p_id, 'offerta', null, null, btrim(p_testo), jsonb_build_object('nota', true));
end $function$;
revoke all on function public.offerta_nota(bigint, text) from public, anon;
grant execute on function public.offerta_nota(bigint, text) to authenticated;

-- 6. Impostazione (decisione di Hadi 25/11/2026): aggiornare le offerte dei colleghi NON è obbligatorio per ora.
--    true = ogni offerta aperta va aggiornata ogni giorno (banner «Da aggiornare oggi» in Oggi e Offerte).
insert into public.centralino_impostazioni (chiave, valore, descrizione)
values ('offerte_aggiornamento_obbligatorio', 'false', 'Se true, Jennifer deve aggiornare ogni giorno tutte le offerte aperte (avviso in Oggi). Predefinito: false.')
on conflict (chiave) do nothing;
