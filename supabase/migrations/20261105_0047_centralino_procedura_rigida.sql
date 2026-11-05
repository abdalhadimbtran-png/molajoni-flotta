-- 0047 Centralino: procedura applicata alla lettera.
--  * stadi RIGIDI: si avanza solo al passo successivo e solo con i requisiti del passo (appuntamento, email, Taylor+documento,
--    commerciale, destinatario, esito). Chiusura anticipata solo «Annullata» con motivo. Ultimo passo → chiusa; offerta rifiutata → chiusa ko.
--  * appunti privati (solo l'autore, RLS) separati dalle note ufficiali
--  * offerte > 1.000 €: assegnazione a L. Esposito / A. Chiaradonna / A. Querini secondo disponibilità; nessuno disponibile → richiamo 2 ore
--  * intervento/sopralluogo: data e fascia obbligatorie al primo contatto; documento di intervento Taylor; spostamento con motivo e conferme
--  * nuovi tipi: Trasferta (alloggio TMQ), Abbigliamento di lavoro
-- Non distruttiva.

-- 1. Colonne ----------------------------------------------------------------------
alter table public.pratiche add column if not exists documento_intervento text;
comment on column public.pratiche.documento_intervento is 'Numero del Documento di Intervento allegato all''alert Taylor.';

-- 2. Flussi: requisiti per passo (data, non codice) -------------------------------------
-- requisiti: appuntamento | email | taylor | commerciale | destinatario | esito
update public.pratiche_flussi set stadi = '[{"key":"ricevuta","nome":"Ricevuta"},
  {"key":"appuntamento","nome":"Appuntamento fissato","azione":"appuntamento","requisiti":["appuntamento"],"template":"conferma_intervento"},
  {"key":"comunicato","nome":"Comunicato al tecnico (Taylor)","azione":"taylor","requisiti":["taylor"]},
  {"key":"eseguito","nome":"Intervento eseguito","sla":{"tipo":"giorni_lav","valore":1,"da":"creazione"}},
  {"key":"chiusa","nome":"Chiusa"}]' where tipo = 'manutenzione';
update public.pratiche_flussi set stadi = '[{"key":"ricevuta","nome":"Ricevuta"},
  {"key":"appuntamento","nome":"Appuntamento fissato","azione":"appuntamento","requisiti":["appuntamento"],"sla":{"tipo":"stesso_giorno","da":"creazione"}},
  {"key":"confermato","nome":"Confermato al cliente (email, cc commerciale)","template":"conferma_sopralluogo","requisiti":["commerciale","email"],"sla":{"tipo":"stesso_giorno","da":"creazione"}},
  {"key":"commerciale","nome":"Commerciale informato","requisiti":["commerciale"],"sla":{"tipo":"stesso_giorno","da":"creazione"}},
  {"key":"eseguito","nome":"Sopralluogo eseguito","sla":{"tipo":"giorni_lav","valore":2,"da":"creazione"}},
  {"key":"offerta","nome":"Offerta inviata","template":"invio_offerta","requisiti":["email"]},
  {"key":"esito","nome":"Esito","azione":"esito","requisiti":["esito"]},
  {"key":"contratto","nome":"Contratto firmato"}]',
  nota_procedura = 'Sopralluogo entro 2 giorni. Sempre confermato al cliente e in cc al Tecnico Commerciale che lo farà. Il commerciale può spostarlo solo dopo averlo concordato per telefono e confermato per iscritto.'
  where tipo = 'sopralluogo';
-- ≤ 1.000 €: gestita da Jennifer dall'inizio alla fine. Conferma entro 10 min (voce + email «entro 60 minuti»), offerta entro 60 min dalla richiesta.
update public.pratiche_flussi set stadi = '[{"key":"ricevuta","nome":"Ricevuta"},
  {"key":"conferma","nome":"Conferma al cliente (voce + email: offerta entro 60 minuti)","template":"presa_offerta_piccola","requisiti":["email"],"sla":{"tipo":"minuti","valore":10,"da":"creazione"}},
  {"key":"offerta","nome":"Offerta inviata","template":"invio_offerta","requisiti":["email"],"sla":{"tipo":"minuti","valore":60,"da":"creazione"}},
  {"key":"followup","nome":"Follow-up","template":"followup_offerta","sla":{"tipo":"giorni_lav","valore":2,"da":"ingresso"}},
  {"key":"esito","nome":"Esito","azione":"esito","requisiti":["esito"]},
  {"key":"contratto","nome":"Contratto / Ordine"}]',
  assegnazione = '{"ruolo":"centralino","nome":"Jennifer Marchetti"}',
  nota_procedura = 'Gestita dal centralino. Conferma subito al cliente a voce e per email che l''offerta arriverà entro 60 minuti, poi invia l''offerta entro 60 minuti dalla richiesta.'
  where tipo = 'offerta_piccola';
update public.pratiche_flussi set stadi = '[{"key":"ricevuta","nome":"Ricevuta"},
  {"key":"presa","nome":"Presa in carico (email al cliente, cc commerciale + Esposito, Chiaradonna, Querini)","template":"presa_offerta_grande","requisiti":["commerciale","email"],"sla":{"tipo":"minuti","valore":30,"da":"creazione"}},
  {"key":"contattato","nome":"Commerciale ha telefonato al cliente","requisiti":["commerciale"],"sla":{"tipo":"ore","valore":2,"da":"creazione"}},
  {"key":"offerta","nome":"Offerta inviata o sopralluogo fissato (email)","template":"invio_offerta","requisiti":["email"],"sla":{"tipo":"stesso_giorno","da":"creazione"}},
  {"key":"esito","nome":"Esito","azione":"esito","requisiti":["esito"]},
  {"key":"contratto","nome":"Contratto firmato"}]',
  nota_procedura = 'Il centralino NON prepara l''offerta: la assegna a L. Esposito, A. Chiaradonna o A. Querini (chi è disponibile). Se nessuno è disponibile: «un nostro Tecnico Commerciale la contatterà entro 2 ore», email di presa in carico e richiamo entro 2 ore. Il commerciale telefona in giornata e conferma per email con l''offerta o il sopralluogo.'
  where tipo = 'offerta_grande';
update public.pratiche_flussi set stadi = '[{"key":"ricevuta","nome":"Ricevuta"},
  {"key":"registrata","nome":"Registrata","sla":{"tipo":"stesso_giorno","da":"creazione"}},
  {"key":"comunicata","nome":"Evasione comunicata al cliente (email)","template":"conferma_modifica_calendario","requisiti":["email"],"sla":{"tipo":"giorni_lav","valore":1,"da":"creazione"}},
  {"key":"chiusa","nome":"Chiusa"}]' where tipo = 'modifica';
update public.pratiche_flussi set stadi = jsonb_set(stadi, '{1,requisiti}', '["destinatario"]')
 where tipo in ('amministrazione', 'fornitori', 'informazione');
update public.pratiche_flussi set nota_procedura = 'Tasto 2 del risponditore. Al pomeriggio la telefonata va girata al cellulare di Simona Colagrossi.' where tipo = 'amministrazione';
update public.pratiche_flussi set nota_procedura = 'Tasto 3 del risponditore: fornitori il lunedì e il venerdì, verificare con Roberta Felci.' where tipo = 'fornitori';
update public.pratiche_flussi set nota_procedura = 'Anche le email su info@molajoni.it: girarle subito al responsabile competente.' where tipo = 'informazione';

insert into public.pratiche_flussi (tipo, nome, icona, ordine, stadi, assegnazione, nota_procedura) values
('trasferta', 'Trasferta (alloggio TMQ)', 'trasferta', 90,
 '[{"key":"ricevuta","nome":"Ricevuta"},{"key":"prenotata","nome":"Alloggio prenotato","requisiti":["destinatario"],"sla":{"tipo":"giorni_lav","valore":1,"da":"creazione"}},{"key":"comunicata","nome":"Comunicata al tecnico"},{"key":"chiusa","nome":"Chiusa"}]',
 '{"ruolo":"centralino","nome":"Centralino"}', 'Richiesta di un collega: alloggio per la trasferta del TMQ.'),
('abbigliamento', 'Abbigliamento di lavoro', 'abbigliamento', 95,
 '[{"key":"ricevuta","nome":"Ricevuta"},{"key":"ordinato","nome":"Ordinato / preparato","requisiti":["destinatario"],"sla":{"tipo":"giorni_lav","valore":2,"da":"creazione"}},{"key":"consegnato","nome":"Consegnato"},{"key":"chiusa","nome":"Chiusa"}]',
 '{"ruolo":"centralino","nome":"Centralino"}', 'Richiesta di un collega: capi di abbigliamento da lavoro.')
on conflict (tipo) do nothing;

-- destinatari delle chiamate con le regole del risponditore
update public.centralino_impostazioni set valore = '[
 {"nome":"L. Esposito","ruolo":"tecnico_commerciale","email":"","nota":"offerte oltre 1.000 €"},
 {"nome":"A. Chiaradonna","ruolo":"tecnico_commerciale","email":"","nota":"offerte oltre 1.000 €"},
 {"nome":"A. Querini","ruolo":"tecnico_commerciale","email":"","nota":"offerte oltre 1.000 €"},
 {"nome":"Tecnico commerciale","ruolo":"tecnico_commerciale","email":"","nota":"sopralluoghi"},
 {"nome":"Simona Colagrossi","ruolo":"amministrazione","email":"","nota":"tasto 2 · fatture · al pomeriggio sul cellulare"},
 {"nome":"Roberta Felci","ruolo":"fornitori","email":"","nota":"tasto 3 · fornitori lunedì e venerdì"},
 {"nome":"Tecnico","ruolo":"tecnico","email":"","nota":"manutenzione"},
 {"nome":"Altro","ruolo":"altro","email":"","nota":""}]'
 where chiave = 'destinatari_trasferimento';

insert into public.centralino_impostazioni (chiave, valore, descrizione) values
  ('commerciali_offerte_grandi', '[{"nome":"L. Esposito","email":""},{"nome":"A. Chiaradonna","email":""},{"nome":"A. Querini","email":""}]', 'Chi prende le offerte oltre 1.000 € (disponibilità: account attivo, non assente oggi, interruttore disponibile/occupato).'),
  ('motivi_annullamento', '["Richiesta duplicata","Il cliente ha rinunciato","Inserita per errore","Gestita da un altro ufficio","Altro"]', 'Motivi per annullare una pratica.'),
  ('motivi_senza_email', '["Il cliente non ha un indirizzo email","Il cliente non vuole dare l''email","Email non valida","Altro"]', 'Motivi per non inviare l''email di riepilogo.'),
  ('motivi_spostamento', '["Richiesta del cliente","Indisponibilità del tecnico","Urgenza su altro impianto","Altro"]', 'Motivi per spostare un appuntamento.')
on conflict (chiave) do nothing;

-- 3. Disponibilità dei commerciali --------------------------------------------------------
create table if not exists public.centralino_disponibilita (
  nome text primary key,
  disponibile boolean not null default true,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da text
);
alter table public.centralino_disponibilita enable row level security;
create policy cdisp_leggi on public.centralino_disponibilita for select to authenticated using ((select public.is_centralino_lettura()));
grant select on public.centralino_disponibilita to authenticated;

create or replace function privato.ct_commerciali() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'nome', x->>'nome', 'email', nullif(x->>'email', ''), 'account', r.user_id is not null and r.attivo,
      'assente', exists (select 1 from public.assenze a where a.tecnico_id = r.dipendente_id and (now() at time zone 'Europe/Rome')::date between a.dal and a.al),
      'occupato', coalesce(not d.disponibile, false),
      'disponibile', coalesce(r.attivo, true) and coalesce(d.disponibile, true)
                     and not exists (select 1 from public.assenze a where a.tecnico_id = r.dipendente_id and (now() at time zone 'Europe/Rome')::date between a.dal and a.al))
      order by ord), '[]'::jsonb)
    from public.centralino_impostazioni i, jsonb_array_elements(i.valore) with ordinality e(x, ord)
    left join lateral (select r2.* from public.responsabili r2 left join auth.users u on u.id = r2.user_id
                        where nullif(x->>'email', '') is not null and (lower(r2.email) = lower(x->>'email') or lower(u.email) = lower(x->>'email')) limit 1) r on true
    left join public.centralino_disponibilita d on d.nome = x->>'nome'
   where i.chiave = 'commerciali_offerte_grandi';
$$;

create or replace function public.centralino_commerciali() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return privato.ct_commerciali();
end $$;

-- il centralino, o il commerciale stesso (account con la stessa email), imposta disponibile/occupato
create or replace function public.centralino_imposta_disponibile(p_nome text, p_disponibile boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare em text; mia text;
begin
  select lower(nullif(x->>'email', '')) into em from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x
   where i.chiave = 'commerciali_offerte_grandi' and x->>'nome' = p_nome;
  if not found then raise exception 'Commerciale non in elenco'; end if;
  select lower(coalesce(nullif(r.email, ''), u.email)) into mia from public.responsabili r left join auth.users u on u.id = r.user_id where r.user_id = auth.uid();
  if not (public.is_centralino() or (em is not null and em = mia)) then raise exception 'Accesso riservato' using errcode = '42501'; end if;
  insert into public.centralino_disponibilita (nome, disponibile, aggiornato_da) values (p_nome, p_disponibile, privato.ct_autore())
  on conflict (nome) do update set disponibile = excluded.disponibile, aggiornato_il = now(), aggiornato_da = excluded.aggiornato_da;
end $$;

-- 4. Appunti privati -------------------------------------------------------------------
create table if not exists public.appunti (
  id bigint generated always as identity primary key,
  autore uuid not null default auth.uid(),
  chiave text not null check (chiave ~ '^(bozza|p:[0-9]+)$'),
  testo text not null default '' check (length(testo) <= 20000),
  aggiornato_il timestamptz not null default now(),
  unique (autore, chiave)
);
comment on table public.appunti is 'Appunti personali durante la chiamata: li vede solo chi li scrive (non direzione, non storia, non report). chiave = bozza (nuovo contatto) o p:<id pratica>.';
alter table public.appunti enable row level security;
create policy appunti_propri on public.appunti for all to authenticated
  using (autore = (select auth.uid())) with check (autore = (select auth.uid()));
grant select, insert, update on public.appunti to authenticated;

-- 5. Requisiti dei passi ----------------------------------------------------------------
create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb default '{}') returns text[]
language plpgsql stable set search_path = '' as $$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti' into req from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  -- l'email deve essere stata inviata dopo l'ingresso nel passo attuale
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and (coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null
                               or coalesce(nullif(d->>'appuntamento_fascia', ''), p.appuntamento_fascia) is null) then m := m || 'Data e fascia (mattina/pomeriggio)'; end if;
    if r = 'taylor' then
      if not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || 'Alert inviato su Taylor'; end if;
      if coalesce(nullif(btrim(coalesce(d->>'documento_intervento', '')), ''), p.documento_intervento) is null then m := m || 'Numero del Documento di Intervento'; end if;
    end if;
    if r = 'commerciale' then
      if coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome) is null then m := m || 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x where i.chiave = 'commerciali_offerte_grandi';
        if not (coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome) = any (coalesce(com, '{}'))) then m := m || 'Commerciale tra L. Esposito, A. Chiaradonna, A. Querini'; end if;
      end if;
    end if;
    if r = 'email' and not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata' and e.at >= coalesce(dal, p.created_at)) then
      m := m || 'Email al cliente (Invia email)'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome) is null then m := m || 'A chi è stata girata'; end if;
    if r = 'esito' and coalesce(d->>'esito_offerta', '') not in ('accettata', 'rifiutata', 'in_attesa') then m := m || 'Esito (accettata / rifiutata / in attesa)'; end if;
  end loop;
  return m;
end $$;

-- per la scheda: prossimo passo e cosa manca
create or replace function public.centralino_prossimo(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.pratiche; s jsonb;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  select * into p from public.pratiche where id = p_id;
  if p.id is null or p.esito <> 'aperta' then return null; end if;
  select f.stadi -> privato.ct_indice(p.tipo, p.stato_corrente) into s from public.pratiche_flussi f where f.tipo = p.tipo; -- indice 1-based → elemento successivo (0-based)
  if s is null then return null; end if;
  return jsonb_build_object('key', s->>'key', 'nome', s->>'nome', 'mancanti', to_jsonb(privato.ct_mancanti(p_id, s->>'key', '{}'::jsonb)));
end $$;

-- 6. Avanzamento rigido ------------------------------------------------------------------
create or replace function public.centralino_avanza(p_id bigint, p_stadio text, p_dati jsonb default '{}', p_testo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche; idx int; idx_sla int; risp boolean; d jsonb := coalesce(p_dati, '{}'::jsonb); ultimo text; m text[]; prossimo text;
begin
  perform privato.richiedi_centralino();
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è chiusa'; end if;
  idx := privato.ct_indice(p.tipo, p_stadio);
  if idx is null then raise exception 'Stadio non valido per questo tipo di pratica'; end if;
  if idx <> privato.ct_indice(p.tipo, p.stato_corrente) + 1 then
    select f.stadi -> privato.ct_indice(p.tipo, p.stato_corrente) ->> 'nome' into prossimo from public.pratiche_flussi f where f.tipo = p.tipo;
    raise exception 'Si procede un passo alla volta: il prossimo è «%»', prossimo;
  end if;
  m := privato.ct_mancanti(p_id, p_stadio, d);
  if array_length(m, 1) > 0 then raise exception 'Per «%» manca: %', (select s->>'nome' from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio), array_to_string(m, ', '); end if;

  if p.sla_stadio is not null then
    idx_sla := privato.ct_indice(p.tipo, p.sla_stadio);
    if idx >= idx_sla then
      risp := now() <= p.sla_scadenza;
      d := d || jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza, 'sla_rispettato', risp);
    end if;
  end if;

  update public.pratiche set
    stato_corrente = p_stadio, updated_at = now(),
    appuntamento_data = coalesce(nullif(d->>'appuntamento_data', '')::date, appuntamento_data),
    appuntamento_fascia = coalesce(nullif(d->>'appuntamento_fascia', ''), appuntamento_fascia),
    alert_taylor = alert_taylor or coalesce((d->>'alert_taylor')::boolean, false),
    documento_intervento = coalesce(nullif(btrim(coalesce(d->>'documento_intervento', '')), ''), documento_intervento),
    tecnico_nome = coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), tecnico_nome),
    commerciale_nome = coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), commerciale_nome),
    commerciale_email = coalesce(nullif(lower(btrim(coalesce(d->>'commerciale_email', ''))), ''), commerciale_email),
    assegnato_nome = coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), assegnato_nome),
    esito_offerta = coalesce(nullif(d->>'esito_offerta', ''), esito_offerta),
    sla_rispettato = case when risp is false then false else sla_rispettato end
   where id = p_id;
  perform privato.ct_evento(p_id, 'stato', p.stato_corrente, p_stadio, p_testo, d);
  if idx_sla is not null and idx >= idx_sla then perform privato.ct_prossimo_sla(p_id, idx);
  elsif p.sla_stadio is null then perform privato.ct_prossimo_sla(p_id, idx); end if;

  ultimo := privato.ct_ultimo(p.tipo);
  if p_stadio = ultimo then perform privato.ct_chiudi(p_id, 'chiusa_ok', null);
  elsif p_stadio = 'esito' and d->>'esito_offerta' = 'rifiutata' then perform privato.ct_chiudi(p_id, 'chiusa_ko', coalesce(p_testo, 'Offerta rifiutata'));
  end if;
  return jsonb_build_object('id', p_id, 'stato', p_stadio);
end $$;

-- chiusura anticipata: solo annullamento con motivo
create or replace function public.centralino_chiudi(p_id bigint, p_esito text, p_testo text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche;
begin
  perform privato.richiedi_centralino();
  if p_esito <> 'annullata' then raise exception 'Una pratica si chiude completando tutti i passi. Prima della fine si può solo annullare, con il motivo.'; end if;
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è già chiusa'; end if;
  if nullif(btrim(coalesce(p_testo, '')), '') is null then raise exception 'Scegli il motivo dell''annullamento'; end if;
  perform privato.ct_chiudi(p_id, 'annullata', p_testo);
end $$;

-- spostamento dell'appuntamento: motivo + concordato al telefono + confermato per iscritto
create or replace function public.centralino_sposta(p_id bigint, p_data date, p_fascia text, p_motivo text, p_concordato boolean, p_confermato boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.pratiche;
begin
  perform privato.richiedi_centralino();
  select * into v from public.pratiche where id = p_id for update;
  if v.id is null then raise exception 'Pratica non trovata'; end if;
  if v.esito <> 'aperta' then raise exception 'La pratica è chiusa'; end if;
  if p_data is null or p_fascia not in ('mattina', 'pomeriggio') then raise exception 'Indica la nuova data e la fascia'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Scegli il motivo dello spostamento'; end if;
  if not (coalesce(p_concordato, false) and coalesce(p_confermato, false)) then raise exception 'Lo spostamento va concordato al telefono con il cliente e confermato per iscritto'; end if;
  perform set_config('centralino.sposta', 'on', true);
  update public.pratiche set appuntamento_data = p_data, appuntamento_fascia = p_fascia, updated_at = now() where id = p_id;
  perform set_config('centralino.sposta', '', true);
  perform privato.ct_evento(p_id, 'appuntamento', null, null, 'Spostato: ' || p_motivo,
    jsonb_build_object('spostato', true, 'motivo', p_motivo, 'concordato_telefono', true, 'confermato_scritto', true,
      'da', jsonb_build_object('data', v.appuntamento_data, 'fascia', v.appuntamento_fascia), 'a', jsonb_build_object('data', p_data, 'fascia', p_fascia)));
end $$;

-- in «Dati e assegnazione» un appuntamento già fissato non si cambia: si usa «Sposta appuntamento»
create or replace function privato.tg_pratica_appuntamento() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.appuntamento_data is not null and (new.appuntamento_data, new.appuntamento_fascia) is distinct from (old.appuntamento_data, old.appuntamento_fascia)
     and coalesce(current_setting('centralino.sposta', true), '') <> 'on' then
    raise exception 'L''appuntamento è già fissato: usa «Sposta appuntamento» (motivo e conferme obbligatori)';
  end if;
  return new;
end $$;
create trigger pratiche_appuntamento before update of appuntamento_data, appuntamento_fascia on public.pratiche
  for each row execute function privato.tg_pratica_appuntamento();

-- 7. Creazione con le regole della procedura ---------------------------------------------
create or replace function public.centralino_crea(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.pratiche_flussi; v_anno int := extract(year from now() at time zone 'Europe/Rome')::int; k int; num text; nid bigint;
  v_tipo text := p->>'tipo'; v_sotto text := nullif(btrim(coalesce(p->>'sottotipo', '')), ''); urg boolean; imp numeric;
  com jsonb; v_com text; v_com_email text; nessuno boolean := coalesce((p->>'nessuno_disponibile')::boolean, false);
begin
  perform privato.richiedi_centralino();
  imp := nullif(p->>'importo_stimato', '')::numeric;
  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') and imp is not null then
    v_tipo := case when imp > 1000 then 'offerta_grande' else 'offerta_piccola' end;
  elsif v_tipo = 'offerta' then v_tipo := 'offerta_piccola';
  end if;
  select * into f from public.pratiche_flussi where tipo = v_tipo and attivo;
  if f.tipo is null then raise exception 'Tipo di richiesta non valido'; end if;
  if nullif(btrim(coalesce(p->>'cliente_nome', '')), '') is null then raise exception 'Indica il cliente'; end if;
  if v_sotto is not null and cardinality(f.sottotipi) > 0 and not (v_sotto = any (f.sottotipi)) then raise exception 'Dettaglio non valido per questo tipo'; end if;
  if (p->>'appuntamento_data') is not null and (p->>'appuntamento_fascia') is null then raise exception 'Indica mattina o pomeriggio'; end if;
  -- procedura 1.3: data e parte del giorno alla PRIMA telefonata
  if v_tipo in ('manutenzione', 'sopralluogo') and (nullif(p->>'appuntamento_data', '') is null or nullif(p->>'appuntamento_fascia', '') is null) then
    raise exception 'Procedura: dai subito al cliente data e fascia (mattina/pomeriggio)';
  end if;
  -- offerte > 1.000 €: a uno dei tre commerciali
  if v_tipo = 'offerta_grande' then
    v_com := nullif(btrim(coalesce(p->>'commerciale_nome', '')), '');
    select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
    if com is null then raise exception 'Offerta oltre 1.000 €: scegli L. Esposito, A. Chiaradonna o A. Querini'; end if;
    if not nessuno and not (com->>'disponibile')::boolean then raise exception '% non è disponibile ora: scegli un altro commerciale o «nessuno disponibile»', v_com; end if;
    v_com_email := com->>'email';
  end if;
  urg := coalesce(p->>'priorita', '') = 'urgente' or v_sotto = any (f.sottotipi_urgenti);

  insert into privato.pratiche_contatori (anno, ultimo) values (v_anno, 1)
  on conflict (anno) do update set ultimo = privato.pratiche_contatori.ultimo + 1 returning ultimo into k;
  num := 'CT-' || v_anno || '-' || lpad(k::text, 6, '0');

  insert into public.pratiche (numero, canale, tipo, sottotipo, priorita, cliente_codice, cliente_nome, sede, contatto_nome, telefono, email,
    indirizzo, cap, comune, descrizione, assegnato_ruolo, assegnato_nome, assegnato_dipendente_id, commerciale_nome, commerciale_email, tecnico_nome,
    importo_stimato, appuntamento_data, appuntamento_fascia, tacitazione_tentata, stato_cliente)
  values (num, coalesce(p->>'canale', 'telefono'), v_tipo, v_sotto, case when urg then 'urgente' else 'normale' end,
    nullif(btrim(coalesce(p->>'cliente_codice', '')), ''), btrim(p->>'cliente_nome'), nullif(btrim(coalesce(p->>'sede', '')), ''),
    nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), nullif(btrim(coalesce(p->>'telefono', '')), ''), nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
    nullif(btrim(coalesce(p->>'indirizzo', '')), ''), nullif(btrim(coalesce(p->>'cap', '')), ''), nullif(btrim(coalesce(p->>'comune', '')), ''),
    nullif(btrim(coalesce(p->>'descrizione', '')), ''),
    case when v_tipo = 'offerta_grande' then 'tecnico_commerciale' else coalesce(nullif(p->>'assegnato_ruolo', ''), f.assegnazione->>'ruolo') end,
    case when v_tipo = 'offerta_grande' then v_com else coalesce(nullif(p->>'assegnato_nome', ''), case when f.assegnazione->>'ruolo' in ('amministrazione', 'fornitori') then f.assegnazione->>'nome' end) end,
    nullif(p->>'assegnato_dipendente_id', '')::bigint,
    coalesce(v_com, nullif(btrim(coalesce(p->>'commerciale_nome', '')), '')), coalesce(nullif(lower(v_com_email), ''), nullif(lower(btrim(coalesce(p->>'commerciale_email', ''))), '')),
    nullif(btrim(coalesce(p->>'tecnico_nome', '')), ''),
    imp, nullif(p->>'appuntamento_data', '')::date, nullif(p->>'appuntamento_fascia', ''), coalesce((p->>'tacitazione_tentata')::boolean, false),
    nullif(p->>'stato_cliente', ''))
  returning id into nid;

  perform privato.ct_evento(nid, 'creata', null, 'ricevuta', p->>'descrizione',
    jsonb_build_object('canale', coalesce(p->>'canale', 'telefono'), 'tipo', v_tipo, 'sottotipo', v_sotto));
  perform privato.ct_prossimo_sla(nid, 1);
  if (p->>'appuntamento_data') is not null and privato.ct_indice(v_tipo, 'appuntamento') = 2 then
    perform public.centralino_avanza(nid, 'appuntamento', '{}'::jsonb, 'Data e fascia date al cliente al primo contatto');
  end if;
  -- nessun commerciale disponibile: «la contatterà entro 2 ore» → richiamo assegnato con SLA 2 ore
  if v_tipo = 'offerta_grande' and nessuno then
    perform public.centralino_trasferisci(jsonb_build_object('pratica_id', nid, 'destinatario_nome', v_com, 'destinatario_email', v_com_email,
      'destinatario_ruolo', 'tecnico_commerciale', 'modalita', 'richiamo', 'tipo_argomento', 'Offerta > 1.000 €', 'argomento', p->>'descrizione',
      'scadenza', privato.ct_sla(now(), '{"tipo":"ore","valore":2}'), 'entro_testo', 'entro 2 ore'));
  end if;
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo);
end $$;

grant execute on function public.centralino_commerciali(), public.centralino_imposta_disponibile(text, boolean), public.centralino_prossimo(bigint),
  public.centralino_sposta(bigint, date, text, text, boolean, boolean) to authenticated;
