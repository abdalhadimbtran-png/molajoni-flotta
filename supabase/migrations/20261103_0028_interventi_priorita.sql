-- Priorità degli interventi: normale / urgente. Non distruttiva.
alter table public.interventi add column if not exists priorita text not null default 'normale'
  check (priorita in ('normale', 'urgente'));

do $$
declare d text; n text;
begin
  -- piano_giorno e tecnico_home: restituiscono priorita, urgenti per primi
  foreach n in array array['public.piano_giorno(date)', 'public.tecnico_home(text)'] loop
    d := pg_get_functiondef(n::regprocedure);
    if position('i.priorita' in d) = 0 then
      if position($q$'ora', to_char(i.ora,'HH24:MI'), $q$ in d) = 0 then raise exception 'frammento non trovato in %', n; end if;
      -- piano_giorno non aveva ancora ora_fine (la 0026 l'aveva saltata): la si aggiunge qui insieme a priorita
      if position('to_char(i.ora_fine' in d) = 0 then
        d := replace(d, $q$'ora', to_char(i.ora,'HH24:MI'), $q$, $q$'ora', to_char(i.ora,'HH24:MI'), 'ora_fine', to_char(i.ora_fine,'HH24:MI'), $q$);
      end if;
      d := replace(d, $q$'ora_fine', to_char(i.ora_fine,'HH24:MI'), $q$, $q$'ora_fine', to_char(i.ora_fine,'HH24:MI'), 'priorita', i.priorita, $q$);
      d := replace(d, 'order by i.ora nulls last, i.id', $q$order by (i.priorita = 'urgente') desc, i.ora nulls last, i.id$q$);
      execute d;
    end if;
  end loop;
  -- report_agenda: colonna «urgente»
  d := pg_get_functiondef('public.report_agenda(date,date,bigint)'::regprocedure);
  if position('i.priorita' in d) = 0 then
    if position($q$'luogo', i.luogo$q$ in d) = 0 then raise exception 'frammento non trovato in report_agenda'; end if;
    d := replace(d, $q$'luogo', i.luogo$q$, $q$'urgente', case when i.priorita = 'urgente' then 'URGENTE' else '' end, 'luogo', i.luogo$q$);
    d := replace(d, $q$'durata', '', 'luogo', ''$q$, $q$'durata', '', 'urgente', '', 'luogo', ''$q$);
    execute d;
  end if;
end $$;
