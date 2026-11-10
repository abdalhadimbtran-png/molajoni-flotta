-- Audit affidabilità: indici additivi su FK calde del Centralino + pulizia storico pg_cron.
create index if not exists chiamate_trasferite_pratica_id on public.chiamate_trasferite (pratica_id);
create index if not exists pratiche_allegati_pratica_id on public.pratiche_allegati (pratica_id);
create index if not exists pratiche_assegnato_dipendente_id on public.pratiche (assegnato_dipendente_id);
create index if not exists pratiche_tecnico_dipendente_id on public.pratiche (tecnico_dipendente_id);
create index if not exists clienti_contatti_storia_contatto_id on public.clienti_contatti_storia (contatto_id);
create index if not exists clienti_contatti_storia_pratica_id on public.clienti_contatti_storia (pratica_id);

-- centralino_sla gira ogni 5 minuti (~290 righe/giorno): tieni 14 giorni di storico.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'pulizia_cron_storico') then
    perform cron.schedule('pulizia_cron_storico', '23 3 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '14 days'$q$);
  end if;
end $$;
