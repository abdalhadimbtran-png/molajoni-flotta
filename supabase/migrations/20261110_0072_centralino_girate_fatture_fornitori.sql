-- 0072 · Fatture (→ Simona) e Fornitori (→ Roberta): nessuna pratica, solo chiamata girata e contata.
alter table public.centralino_chiamate_info add column if not exists categoria text
  check (categoria is null or categoria in ('fatture', 'fornitori'));

update public.pratiche_flussi set attivo = false where tipo in ('amministrazione', 'fornitori');

create or replace function public.centralino_chiamata_girata(p_categoria text, p_canale text default 'telefono')
returns void language plpgsql security definer set search_path to '' as $$
begin
  perform privato.richiedi_centralino();
  if p_categoria not in ('fatture', 'fornitori') then raise exception 'Categoria non valida'; end if;
  insert into public.centralino_chiamate_info (canale, nota, categoria, autore_nome)
  values (coalesce(p_canale, 'telefono'), case p_categoria when 'fatture' then 'Girata a Fatture' else 'Girata a Fornitori' end, p_categoria, privato.ct_autore());
end $$;
revoke all on function public.centralino_chiamata_girata(text, text) from public, anon;
grant execute on function public.centralino_chiamata_girata(text, text) to authenticated;

create or replace function public.centralino_registro_giorno(p_data date default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare g date := coalesce(p_data, (now() at time zone 'Europe/Rome')::date);
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return (
    with pr as (select * from public.pratiche where (created_at at time zone 'Europe/Rome')::date = g),
         ci as (select * from public.centralino_chiamate_info where (at at time zone 'Europe/Rome')::date = g),
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
      'chiamate_info', (select count(*) from ci where categoria is null),
      'girate_fatture', (select count(*) from ci where categoria = 'fatture'),
      'girate_fornitori', (select count(*) from ci where categoria = 'fornitori'),
      'pratiche', (select count(*) from pr),
      'chiuse', (select count(*) from public.pratiche where (closed_at at time zone 'Europe/Rome')::date = g and esito <> 'annullata')));
end $function$;
