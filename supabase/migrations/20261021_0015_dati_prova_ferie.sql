-- =====================================================================
-- Portale unico · DATI DI PROVA per il modulo ferie (per gli agenti frontend)
-- Tutti marcati "(prova)" nel ruolo o "[PROVA]" nelle note. PIN in docs/PROVE_fase2-4.md.
-- Le notifiche sono disattivate durante l'inserimento (nessun push ai telefoni).
-- =====================================================================
-- Dipendenti non TEC + un tecnico per provare ferie e piano insieme
insert into public.dipendenti (codice, nome, cognome, ruolo, categoria, reparto, data_assunzione, contratto, ore_giornaliere, giorni_riposo,
                               telefono, email, patente_categoria, patente_scadenza)
values
  ('NERIR',    'Roberta', 'Neri',    'Impiegata ufficio personale (prova)',     'UFFICIO',   'Amministrazione e personale', '2015-03-02', 'full-time', 8, '0000011', null, null, null, null),
  ('COLOMBOA', 'Andrea',  'Colombo', 'Magazziniere (prova)',                    'MAGAZZINO', 'Magazzino',                   '2019-09-16', 'full-time', 8, '0000011', null, null, null, null),
  ('RICCIS',   'Sara',    'Ricci',   'Impiegata commerciale part-time (prova)', 'UFFICIO',   'Commerciale',                 '2026-04-15', 'part-time', 4, '0000011', null, null, null, null),
  ('GALLIS',   'Stefano', 'Galli',   'Tecnico manutenzione (prova ferie)',      'TEC',       'Manutenzione',                '2020-01-13', 'full-time', 8, '0000011', null, null, 'B', '2030-06-30')
on conflict (codice) do nothing;

-- Data di assunzione dei tecnici demo (prima era vuota: serve al calcolo dei saldi)
update public.dipendenti set data_assunzione = '2018-01-08'
 where codice in ('DEMO1', 'DEMO2', 'DEMO3', 'DEMO4', 'DEMO5', 'DEMO6', 'DEMO7') and data_assunzione is null;

-- PIN di prova (noti, documentati in docs/PROVE_fase2-4.md)
update public.dipendenti d set pin_hash = extensions.crypt(p.pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null
  from (values ('NERIR', '274913'), ('COLOMBOA', '581362'), ('RICCIS', '936147'), ('GALLIS', '482916')) p(codice, pin)
 where d.codice = p.codice;

-- Saldi iniziali "da cedolino" (prova)
insert into public.saldi_iniziali (dipendente_id, anno, tipo, data_riferimento, residuo, goduto_anno, fonte)
select d.id, 2026, x.tipo, '2026-09-30', x.residuo, x.goduto, '[PROVA] cedolino settembre 2026'
  from (values ('NERIR', 'FERIE', 12.5, 10), ('NERIR', 'ROL', 40, 20), ('DEMO1', 'FERIE', 3, 15)) x(codice, tipo, residuo, goduto)
  join public.dipendenti d on d.codice = x.codice
on conflict (dipendente_id, anno, tipo) do nothing;

-- Richieste di prova (calcolate con le regole vere, poi decise)
do $$
declare c jsonb; r public.richieste_assenza; x record;
begin
  perform set_config('portale.senza_notifiche', 'on', true);   -- niente push durante l'inserimento
  if exists (select 1 from public.richieste_assenza where note like '[PROVA]%') then return; end if;
  for x in select * from (values
      (1, 'DEMO2',    'FERIE', date '2026-10-22', date '2026-10-23', null::time, null::time, false, 'in_attesa', null::text, '[PROVA] visita parenti'),
      (2, 'DEMO1',    'FERIE', date '2026-11-09', date '2026-11-14', null, null, false, 'approvata', null, '[PROVA] settimana di ferie'),
      (3, 'COLOMBOA', 'ROL',   date '2026-10-27', null, time '08:00', time '10:00', false, 'approvata', null, '[PROVA] visita'),
      (4, 'RICCIS',   'FERIE', date '2026-11-02', date '2026-11-04', null, null, false, 'rifiutata', '[PROVA] chiusura contabile di inizio mese', '[PROVA] ponte'),
      (5, 'NERIR',    'FERIE', date '2026-12-28', date '2027-01-07', null, null, false, 'in_attesa', null, '[PROVA] vacanze di Natale'),
      (6, 'COLOMBOA', 'MAL',   date '2026-10-19', date '2026-10-21', null, null, false, 'hr', null, '[PROVA] PUC 123456789'),
      (7, 'GALLIS',   'FERIE', date '2026-11-16', null, null, null, true, 'in_attesa', null, '[PROVA] mezza giornata')
    ) v(n, codice, tipo, primo, rientro, oi, ofi, mezza, esito, motivo, note) order by n loop
    c := privato.calcola_richiesta((select id from public.dipendenti where codice = x.codice), x.tipo, x.primo, x.rientro, x.oi, x.ofi, x.mezza, false);
    if not (c->>'ok')::boolean then raise exception 'Dato di prova % non valido: %', x.n, c->'errori'; end if;
    r := privato.salva_richiesta(c, x.note, case when x.esito = 'hr' then 'hr' else 'dipendente' end, null, x.esito = 'hr');
    if x.esito = 'approvata' then
      update public.richieste_assenza set stato = 'approvata', deciso_il = now() where id = r.id;
    elsif x.esito = 'rifiutata' then
      update public.richieste_assenza set stato = 'rifiutata', deciso_il = now(), motivo_decisione = x.motivo where id = r.id;
    end if;
  end loop;
end $$;
