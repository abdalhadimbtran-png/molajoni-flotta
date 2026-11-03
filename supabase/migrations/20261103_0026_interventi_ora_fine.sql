-- Interventi con ora di inizio (ora) e ora di fine (ora_fine). Non distruttiva.
alter table public.interventi add column if not exists ora_fine time;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'interventi_ora_fine_check') then
    alter table public.interventi add constraint interventi_ora_fine_check check (ora_fine is null or ora is null or ora_fine > ora) not valid;
  end if;
end $$;
alter table public.interventi validate constraint interventi_ora_fine_check;

-- Aggiorna le funzioni esistenti (piano_giorno, tecnico_home, report_agenda) sostituendo solo il frammento dell'ora.
do $$
declare d text; n text;
begin
  foreach n in array array['public.piano_giorno(date)', 'public.tecnico_home(text)'] loop
    d := pg_get_functiondef(n::regprocedure);
    if position('to_char(i.ora_fine' in d) = 0 then
      if position($q$'ora', to_char(i.ora,'HH24:MI'), $q$ in d) = 0 then raise exception 'frammento ora non trovato in %', n; end if;
      execute replace(d, $q$'ora', to_char(i.ora,'HH24:MI'), $q$, $q$'ora', to_char(i.ora,'HH24:MI'), 'ora_fine', to_char(i.ora_fine,'HH24:MI'), $q$);
    end if;
  end loop;
  d := pg_get_functiondef('public.report_agenda(date,date,bigint)'::regprocedure);
  if position('ora_fine' in d) = 0 then
    if position($q$'ora', to_char(i.ora, 'HH24:MI'),$q$ in d) = 0 then raise exception 'frammento ora non trovato in report_agenda'; end if;
    execute replace(d, $q$'ora', to_char(i.ora, 'HH24:MI'),$q$,
      $q$'ora', to_char(i.ora, 'HH24:MI') || coalesce('–' || to_char(i.ora_fine, 'HH24:MI'), ''), 'durata', case when i.ora is not null and i.ora_fine is not null then to_char(i.ora_fine - i.ora, 'HH24:MI') else '' end,$q$);
    -- giorni di assenza: durata vuota
    d := pg_get_functiondef('public.report_agenda(date,date,bigint)'::regprocedure);
    execute replace(d, $q$'ora', '', 'luogo', ''$q$, $q$'ora', '', 'durata', '', 'luogo', ''$q$);
  end if;
end $$;
