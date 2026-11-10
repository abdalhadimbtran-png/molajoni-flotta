-- Centralino: email premium (titolo + dati in evidenza + firma), revisione oggetti/testi secondo la procedura
-- «Jennifer MARCHETTI Rev.01/2027» e le decisioni del titolare; flusso «Offerta da tablet TMQ»; destinazione «Emergenze h24».
-- Non distruttiva: solo ADD COLUMN, CREATE OR REPLACE, INSERT/UPDATE. I modelli non più usati sono disattivati (non cancellati).

alter table public.email_template add column if not exists titolo text;
alter table public.email_template add column if not exists dati jsonb not null default '[]'::jsonb;
alter table public.email_template add column if not exists firma_tipo text not null default 'front_office';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_template_firma_tipo_check') then
    alter table public.email_template add constraint email_template_firma_tipo_check check (firma_tipo in ('front_office', 'tmq', 'nessuna'));
  end if;
end $$;

-- SLA: giorni_lav con «ora» facoltativa (es. entro le 12:00 del giorno lavorativo successivo)
CREATE OR REPLACE FUNCTION privato.ct_sla(p_da timestamp with time zone, p_regola jsonb)
 RETURNS timestamp with time zone LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
declare
  v_tipo text := p_regola->>'tipo'; n int := coalesce((p_regola->>'valore')::int, 0);
  o jsonb; hi time; hf time; l timestamp; d date; t time; m int; disp int;
begin
  if p_da is null or v_tipo is null then return null; end if;
  select valore into o from public.centralino_impostazioni where chiave = 'orario';
  hi := coalesce((o->>'inizio')::time, '08:30'); hf := coalesce((o->>'fine')::time, '17:30');
  l := p_da at time zone 'Europe/Rome'; d := l::date; t := l::time;
  if v_tipo = 'giorni_lav' then
    for i in 1..greatest(n, 0) loop d := privato.ct_prossimo_lav(d); end loop;
    if n <= 0 and not privato.ct_lav(d) then d := privato.ct_prossimo_lav(d); end if;
    return (d + coalesce(nullif(p_regola->>'ora', '')::time, hf)) at time zone 'Europe/Rome';
  end if;
  if not privato.ct_lav(d) or t >= hf then d := privato.ct_prossimo_lav(d); t := hi;
  elsif t < hi then t := hi; end if;
  if v_tipo = 'stesso_giorno' then return (d + hf) at time zone 'Europe/Rome'; end if;
  if v_tipo in ('minuti', 'ore') then
    m := case when v_tipo = 'ore' then n * 60 else n end;
    loop
      disp := (extract(epoch from (hf - t)) / 60)::int;
      if m <= disp then return ((d + t) + make_interval(mins => m)) at time zone 'Europe/Rome'; end if;
      m := m - disp; d := privato.ct_prossimo_lav(d); t := hi;
    end loop;
  end if;
  return null;
end $function$;

-- requisito «verificato» (offerte da tablet TMQ)
CREATE OR REPLACE FUNCTION privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb DEFAULT '{}'::jsonb)
 RETURNS text[] LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text; email_fatta boolean; ass jsonb;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti', f.assegnazione into req, ass from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  email_fatta := exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata' and e.at >= coalesce(dal, p.created_at));
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null then m := m || text 'Data dell''appuntamento'; end if;
    if r = 'urgenza' and coalesce(nullif(d->>'urgenza', ''), p.urgenza) is null then m := m || text 'Valutazione urgenza'; end if;
    if r = 'coordinatore' then
      if coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), p.coordinatore_nome) is null then m := m || text 'Coordinatore'; end if;
      if not (email_fatta or p.coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false)) then m := m || text 'Email o telefonata al coordinatore'; end if;
    end if;
    if r = 'tecnico' and coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), p.tecnico_nome) is null then m := m || text 'Tecnico'; end if;
    if r = 'verificato' and not coalesce((d->>'verificato')::boolean, false) then m := m || text 'Preventivo verificato'; end if;
    if r in ('buono', 'avviso') and not (p.alert_taylor or p.whatsapp_tecnico or p.avviso_app_at is not null
                             or coalesce((d->>'alert_taylor')::boolean, false) or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || text 'Avviso al tecnico (Taylor, WhatsApp o app)'; end if;
    if r = 'taylor' and not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || text 'Alert inviato su Taylor'; end if;
    if r = 'commerciale' then
      val := coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome);
      if val is null then m := m || text 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from jsonb_array_elements(privato.ct_commerciali()) x;
        if not (val = any (coalesce(com, '{}'))) then m := m || text 'Commerciale tra i Tecnici Commerciali delle offerte da 1.000 €'; end if;
      end if;
    end if;
    if r = 'email' and not email_fatta then m := m || text 'Email (Invia email)'; end if;
    if r = 'informato' and not (email_fatta or coalesce((d->>'informato_voce')::boolean, false) or nullif(btrim(coalesce(d->>'email_non_disponibile', '')), '') is not null) then
      m := m || text 'Email al cliente o «informato a voce»'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome, ass->>'nome') is null then m := m || text 'A chi è stata girata'; end if;
  end loop;
  return m;
end $function$;

-- modelli (oggetti in MAIUSCOLO come nella procedura + numero pratica; interni «[Centralino] …»)
insert into public.email_template (codice,nome,tipo_pratica,ordine,oggetto,titolo,dati,corpo_html,firma_tipo,attivo) values
('presa_intervento','Al cliente – richiesta intervento presa in carico (facoltativa)','manutenzione',2,'RICHIESTA INTERVENTO – PRESA IN CARICO – {cliente} – {numero_pratica}','Richiesta di intervento presa in carico','[["Numero pratica", "{numero_pratica}"], ["Problema", "{dettaglio}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che abbiamo preso in carico la Vostra richiesta di intervento. <b>Entro 1 ora</b> Vi ricontatteremo per comunicarVi il nome del tecnico e l''orario.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('intervento_coordinatore','Al coordinatore – intervento da assegnare','manutenzione',3,'[Centralino] Intervento da assegnare – {cliente} – {urgenza}','Intervento da assegnare','[["Numero pratica", "{numero_pratica}"], ["Urgenza", "{urgenza} · {obiettivo}"], ["Cliente", "{cliente} · {stato_cliente}"], ["Problema", "{dettaglio}"], ["Richiesta", "{descrizione}"], ["Indirizzo", "{indirizzo}"], ["Contatto", "{contatto}"], ["Telefono", "{telefono}"], ["Email", "{email_cliente}"]]'::jsonb,'<p>Ciao,</p><p>nuova richiesta di intervento da assegnare. Al cliente ho detto che <b>entro 1 ora</b> lo ricontattiamo con il nome del tecnico e l''orario.</p><p>Mi indichi chi va e quando?</p>','front_office',true),
('intervento_cliente','Al cliente – intervento programmato (tecnico e orario)','manutenzione',4,'INTERVENTO PROGRAMMATO – {cliente} – {numero_pratica}','Intervento programmato','[["Numero pratica", "{numero_pratica}"], ["Tecnico", "{tecnico}"], ["Quando", "{quando}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,'<p>{saluto},</p><p>come anticipato telefonicamente, Vi confermiamo che il nostro tecnico <b>{tecnico}</b> Vi contatterà <b>{quando}</b> per l''intervento richiesto.</p><p>Per qualsiasi variazione potete rispondere a questa email o chiamarci allo 06 6941 4281.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('sopralluogo_coordinatore','Al coordinatore – sopralluogo da assegnare','sopralluogo',3,'[Centralino] Sopralluogo da assegnare – {cliente} – {urgenza}','Sopralluogo da assegnare','[["Numero pratica", "{numero_pratica}"], ["Urgenza", "{urgenza} · {obiettivo}"], ["Cliente", "{cliente} · {stato_cliente}"], ["Richiesta", "{descrizione}"], ["Indirizzo", "{indirizzo}"], ["Contatto", "{contatto}"], ["Telefono", "{telefono}"], ["Email", "{email_cliente}"]]'::jsonb,'<p>Ciao,</p><p>nuova richiesta di sopralluogo da assegnare. Al cliente ho detto che <b>entro 1 ora</b> lo ricontattiamo per confermare l''appuntamento.</p><p>Mi indichi il Tecnico Commerciale e quando?</p>','front_office',true),
('sopralluogo_cliente','Al cliente – conferma appuntamento sopralluogo','sopralluogo',4,'CONFERMA APPUNTAMENTO – {cliente} – {numero_pratica}','Conferma appuntamento','[["Numero pratica", "{numero_pratica}"], ["Quando", "{quando}"], ["Tecnico Commerciale", "{tecnico}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo l''appuntamento per il sopralluogo <b>{quando}</b> con il nostro Tecnico Commerciale <b>{tecnico}</b>{tel_tecnico}.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('presa_offerta_piccola','Al cliente – preventivo entro 60 minuti','offerta_piccola',40,'PREVENTIVO – {cliente} – {numero_pratica}','Preventivo in lavorazione','[["Numero pratica", "{numero_pratica}"], ["Richiesta", "{descrizione}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che la Vostra richiesta è in lavorazione e che <b>riceverete il preventivo entro 60 minuti</b>.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('invio_offerta','Al cliente – invio preventivo','offerta_piccola',41,'PREVENTIVO – {cliente} – {numero_pratica}','Il Vostro preventivo','[["Numero pratica", "{numero_pratica}"], ["Importo indicativo", "{importo}"]]'::jsonb,'<p>{saluto},</p><p>in allegato il preventivo richiesto.</p><p>Restiamo a disposizione per qualsiasi chiarimento; per confermare è sufficiente rispondere a questa email.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('presa_offerta_grande','Al cliente – richiesta preventivo oltre 1.000 €','offerta_grande',50,'RICHIESTA PREVENTIVO – PRESA IN CARICO – {cliente} – {numero_pratica}','Richiesta di preventivo presa in carico','[["Numero pratica", "{numero_pratica}"], ["Tecnico Commerciale", "{commerciale}"], ["Vi contatterà", "entro 2 ore"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che abbiamo ricevuto la Vostra richiesta: <b>entro 2 ore Vi contatterà il nostro Tecnico Commerciale {commerciale}</b> per concordare il sopralluogo e preparare l''offerta.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('riepilogo_commerciale','Al Tecnico Commerciale – riepilogo preventivo oltre 1.000 €','offerta_grande',51,'[Centralino] Preventivo oltre 1.000 € – {cliente} – richiamare entro le {scadenza_richiamo}','Preventivo oltre 1.000 € da gestire','[["Numero pratica", "{numero_pratica}"], ["Richiamare entro", "{scadenza_richiamo}"], ["Cliente", "{cliente} · {stato_cliente}"], ["Contatto", "{contatto}"], ["Telefono", "{telefono}"], ["Email", "{email_cliente}"], ["Richiesta", "{descrizione}"], ["Importo stimato", "{importo}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,'<p>Ciao {commerciale},</p><p>ti ho assegnato questa richiesta: <b>chiama il cliente entro le {scadenza_richiamo}</b>, poi conferma per email giorno e fascia del sopralluogo.</p><p>Al cliente ho già scritto che entro 2 ore lo contatterai tu. Da qui la pratica è tua.</p>','front_office',true),
('preventivo_tmq','Al cliente – preventivo da tablet TMQ','offerta_tablet',45,'PREVENTIVO DA PARTE DEL TMQ VVF – {cliente} – {numero_pratica}','Preventivo','[["Numero pratica", "{numero_pratica}"], ["Cliente", "{cliente}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,'<p>{saluto},</p><p>in allegato il preventivo.</p><p>Distinti saluti.</p>','tmq',true),
('modifica_evasa','Al cliente – richiesta evasa (calendario, anagrafica, disdetta)','modifica',80,'RICHIESTA EVASA – {cliente} – {numero_pratica}','Richiesta evasa','[["Numero pratica", "{numero_pratica}"], ["Richiesta", "{dettaglio}"], ["Dettagli", "{descrizione}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che la Vostra richiesta è stata registrata ed evasa.</p><p>Per qualsiasi necessità potete rispondere a questa email.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('conferma_anagrafica','Al cliente – dati anagrafici aggiornati','modifica',90,'AGGIORNAMENTO DATI – {cliente} – {numero_pratica}','Dati aggiornati','[["Numero pratica", "{numero_pratica}"], ["Cliente", "{cliente}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che abbiamo aggiornato i dati di <b>{cliente}</b> come da Vostra richiesta.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('conferma_disdetta','Al cliente – disdetta ricevuta','modifica',100,'DISDETTA – CONFERMA DI RICEZIONE – {cliente} – {numero_pratica}','Disdetta ricevuta','[["Numero pratica", "{numero_pratica}"], ["Cliente", "{cliente}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo di aver ricevuto la richiesta di disdetta per <b>{cliente}</b>. L''ufficio competente la gestirà secondo i termini del contratto.</p><p>Distinti saluti.</p>','front_office',true),
('girata_ufficio','Al cliente – richiesta inoltrata all''ufficio competente',null,110,'RICHIESTA INOLTRATA – {cliente} – {numero_pratica}','Richiesta inoltrata','[["Numero pratica", "{numero_pratica}"], ["Inoltrata a", "{referente}"]]'::jsonb,'<p>{saluto},</p><p>Vi confermiamo che abbiamo inoltrato la Vostra richiesta a <b>{referente}</b>, che Vi ricontatterà il prima possibile.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('riepilogo_trasferita','Al cliente – riepilogo telefonata trasferita','trasferimento',5,'RIEPILOGO TELEFONATA – {cliente}{rif_pratica}','Riepilogo della telefonata','[["Numero pratica", "{numero_pratica}"], ["Argomento", "{argomento}"], ["Referente", "{referente}"]]'::jsonb,'<p>{saluto},</p><p>grazie per la telefonata di oggi. Come d''accordo Vi abbiamo messo in contatto con <b>{referente}</b>, che Vi invierà la conferma scritta di quanto concordato.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('riepilogo_richiamo','Al cliente – richiesta presa in carico, vi ricontatteremo','trasferimento',6,'RICHIESTA PRESA IN CARICO – {cliente}{rif_pratica}','Richiesta presa in carico','[["Numero pratica", "{numero_pratica}"], ["Argomento", "{argomento}"], ["Referente", "{referente}"], ["Vi ricontatterà", "{scadenza}"]]'::jsonb,'<p>{saluto},</p><p>grazie per averci chiamato. Abbiamo preso in carico la Vostra richiesta: <b>{referente}</b> Vi ricontatterà <b>{scadenza}</b>.</p><p>Se preferite un altro orario, potete rispondere a questa email.</p><p>Grazie per la preferenza e distinti saluti.</p>','front_office',true),
('trasf_referente','Al referente – chiamata trasferita','trasferimento_referente',1,'[Centralino] Chiamata trasferita – {cliente} – {argomento}','Chiamata trasferita','[["Numero pratica", "{numero_pratica}"], ["Scadenza", "{scadenza}"], ["Cliente", "{cliente} · {stato_cliente}"], ["Contatto", "{contatto}"], ["Telefono", "{telefono}"], ["Email", "{email_cliente}"], ["Sede", "{sede}"], ["Canale", "{canale}"], ["Argomento", "{argomento}"], ["Richiesta", "{richiesta}"], ["Importo stimato", "{importo}"]]'::jsonb,'<p>Ciao {referente},</p><p>{richiesta_al_referente}</p><p><a href="{link}" style="display:inline-block;background:#E30613;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Apri la pratica</a></p><p style="color:#8e8e93;font-size:12px">Trasferita da {autore} alle {ora_trasferimento}.</p>','front_office',true)
on conflict (codice) do update set nome=excluded.nome, tipo_pratica=excluded.tipo_pratica, ordine=excluded.ordine, oggetto=excluded.oggetto, titolo=excluded.titolo, dati=excluded.dati, corpo_html=excluded.corpo_html, firma_tipo=excluded.firma_tipo, attivo=true;

-- modelli non più usati: disattivati (non cancellati)
update public.email_template set attivo = false
 where codice in ('conferma_intervento', 'conferma_urgente_allarme', 'conferma_sopralluogo', 'conferma_modifica_calendario', 'followup_offerta');

-- modifica: il passo «Evasione comunicata» usa il modello generico (anagrafica/disdetta scelti dal dettaglio nell'app)
update public.pratiche_flussi f set stadi = (
  select jsonb_agg(case when s->>'key' = 'comunicata' then s || '{"template":"modifica_evasa"}'::jsonb else s end order by i)
  from jsonb_array_elements(f.stadi) with ordinality x(s, i)) where f.tipo = 'modifica';
-- girate (amministrazione / fornitori): modello «richiesta inoltrata»
update public.pratiche_flussi set nota_procedura = 'Tasto 2 del risponditore (fatture). Al pomeriggio la telefonata va girata al cellulare di Simona Colagrossi.' where tipo = 'amministrazione';

-- B.1 Offerte da tablet TMQ
insert into public.pratiche_flussi (tipo, nome, icona, ordine, sottotipi, sottotipi_urgenti, stadi, sla_sottotipi, assegnazione, nota_procedura, attivo)
select 'offerta_tablet', 'Offerta da tablet TMQ', icona, 35, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta dal tablet del TMQ"},
    {"key":"verificato","nome":"Preventivo verificato (TMQ che firma)","requisiti":["tecnico","verificato"],"sla":{"tipo":"giorni_lav","valore":1,"ora":"12:00","da":"creazione"}},
    {"key":"inviato","nome":"Inviato al cliente (entro le 12:00 del giorno lavorativo successivo)","template":"preventivo_tmq","requisiti":["email"],"sla":{"tipo":"giorni_lav","valore":1,"ora":"12:00","da":"creazione"}}]'::jsonb,
  '{}'::jsonb, '{"nome":"TMQ","ruolo":"tecnico"}'::jsonb,
  'Preventivo arrivato dal tablet del TMQ: verificalo in tutte le sue parti e invialo al cliente entro le 12:00 del giorno lavorativo successivo («PREVENTIVO DA PARTE DEL TMQ VVF», firma del TMQ).', true
from public.pratiche_flussi where tipo = 'offerta_piccola'
on conflict (tipo) do nothing;

-- tasto 4 del risponditore: destinazione «Emergenze h24» (telefono da definire)
update public.centralino_impostazioni
   set valore = valore || '[{"nome":"Emergenze h24","ruolo":"Emergenze tecniche h24","nota":"Tasto 4 del risponditore · tel. da definire","email":""}]'::jsonb
 where chiave = 'destinatari_trasferimento' and jsonb_typeof(valore) = 'array'
   and not exists (select 1 from jsonb_array_elements(valore) x where x->>'nome' = 'Emergenze h24');
