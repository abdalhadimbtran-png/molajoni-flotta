-- Rimuove il job del riepilogo giornaliero (sostituito dal Report Direzione settimanale/mensile, 0092).
-- La funzione privato.direzione_digest è già no-op: anche se questo passo non venisse eseguito, non parte alcuna email.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'direzione_digest') then perform cron.unschedule('direzione_digest'); end if;
end $$;
