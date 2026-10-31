-- Richieste del pannello flotta (21/10/2026):
-- 1. piano_giorno: per riga anche `rientro` (giorno di rientro dell'assenza che blocca) e
--    `parte_giornata` ('mattina'|'pomeriggio' se assente mezza giornata), sempre senza il tipo.
-- 2. notifiche al responsabile flotta: link con la data (/piano?data=AAAA-MM-GG).
-- 3. vista assenze: i motivi liberi delle vecchie assenze manuali (es. "Ferie") si leggono come
--    "Assenza"; restano visibili solo Formazione / Trasferta / Altro / Assenza.
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.piano_giorno(date)'::regprocedure);
  nuovo := replace(src, $a$'possibile_assenza', poss and ass is null,$a$,
    $a$'rientro', (select max(x.al) + 1 from public.assenze x where x.tecnico_id = t.id and p_data between x.dal and x.al),
      'parte_giornata', (select x.meta from public.assenze_da_richieste x where x.dipendente_id = t.id and x.attiva and x.tipo_riga = 'nota'
                           and x.meta is not null and p_data between x.dal and x.al order by x.richiesta_id limit 1),
      'possibile_assenza', poss and ass is null,$a$);
  if nuovo = src then raise exception 'piano_giorno: testo atteso non trovato'; end if;
  execute nuovo;

  src := pg_get_functiondef('privato.tg_richiesta_notifiche()'::regprocedure);
  nuovo := replace(src, $a$'importante', '/piano');$a$,
    $a$'importante', '/piano?data=' || to_char(greatest(new.primo_giorno, public.oggi()), 'YYYY-MM-DD'));$a$);
  nuovo := replace(nuovo, $a$'info', '/piano');$a$,
    $a$'info', '/piano?data=' || to_char(greatest(new.primo_giorno, public.oggi()), 'YYYY-MM-DD'));$a$);
  if nuovo = src or position('/piano?data=' in nuovo) = 0 then raise exception 'tg_richiesta_notifiche: testo atteso non trovato'; end if;
  execute nuovo;
end $$;

create or replace view public.assenze with (security_invoker = true) as
  select m.id, m.tecnico_id, m.dal, m.al,
         case when m.motivo in ('Assenza', 'Formazione', 'Trasferta', 'Altro') then m.motivo else 'Assenza' end as motivo,
         m.creato_il, 'manuale'::text as origine
    from public.assenze_manuali m
   where not m.annullata
  union all
  select -d.richiesta_id, d.dipendente_id, d.dal, d.al, d.etichetta, d.creato_il, 'richiesta'::text
    from public.assenze_da_richieste d
   where d.attiva and d.tipo_riga = 'assenza';
