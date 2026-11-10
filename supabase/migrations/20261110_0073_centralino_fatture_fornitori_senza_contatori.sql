-- 0073 · Decisione finale: Fatture/Fornitori non hanno pulsanti né contatori. Restano solo i flussi disattivati (0072)
-- e le indicazioni del risponditore (tasto 2 → Simona, tasto 3 → Roberta). La colonna «categoria» resta inutilizzata.
revoke execute on function public.centralino_chiamata_girata(text, text) from authenticated;

create or replace function public.centralino_registro_giorno(p_data date default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare g date := coalesce(p_data, (now() at time zone 'Europe/Rome')::date);
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return (
    with pr as (select * from public.pratiche where (created_at at time zone 'Europe/Rome')::date = g and tipo not in ('amministrazione', 'fornitori')),
         ci as (select * from public.centralino_chiamate_info where (at at time zone 'Europe/Rome')::date = g and categoria is null),
         ca as (select distinct contatto_id from public.clienti_contatti_storia where (at at time zone 'Europe/Rome')::date = g and campo <> 'nuovo')
    select jsonb_build_object(
      'data', g,
      'telefonate', (select count(*) from pr where canale = 'telefono') + (select count(*) from ci where canale = 'telefono'),
      'whatsapp', (select count(*) from pr where canale = 'whatsapp') + (select count(*) from ci where canale = 'whatsapp'),
      'email', (select count(*) from pr where canale = 'email') + (select count(*) from ci where canale = 'email'),
      'offerte_tablet', (select count(*) from pr where tipo like 'offerta%' and canale = 'tablet_tmq'),
      'offerte_whatsapp', (select count(*) from pr where tipo like 'offerta%' and canale = 'whatsapp'),
      'offerte_cliente', (select count(*) from pr where tipo like 'offerta%' and canale in ('telefono', 'email', 'altro')),
      'aggiornamenti_anagrafica', (select count(*) from pr where tipo = 'modifica') + (select count(*) from ca),
      'contatti_aggiornati', (select count(*) from ca),
      'chiamate_info', (select count(*) from ci),
      'pratiche', (select count(*) from pr),
      'chiuse', (select count(*) from public.pratiche where (closed_at at time zone 'Europe/Rome')::date = g and esito <> 'annullata' and tipo not in ('amministrazione', 'fornitori'))));
end $function$;
