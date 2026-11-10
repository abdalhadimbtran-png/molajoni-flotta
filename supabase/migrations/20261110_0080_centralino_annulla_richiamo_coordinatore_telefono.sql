-- 0080 · Revisione E2E centralino
-- 1) Annullando una pratica, il richiamo automatico «2 ore» per il Tecnico Commerciale (solo_commerciale)
--    non resta aperto (niente promemoria/escalation/contatori per una pratica annullata).
-- 2) «Avvisato per telefono» del coordinatore con avanzamento (dal compositore email): il nome del
--    coordinatore e la telefonata valgono come dati del passo (prima: «manca: Coordinatore»).

create or replace function public.centralino_chiudi(p_id bigint, p_esito text, p_testo text default null)
returns void language plpgsql security definer set search_path to '' as $function$
declare p public.pratiche;
begin
  perform privato.richiedi_centralino();
  if p_esito <> 'annullata' then raise exception 'Una pratica si chiude completando tutti i passi. Prima della fine si può solo annullare, con il motivo.'; end if;
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è già chiusa'; end if;
  if nullif(btrim(coalesce(p_testo, '')), '') is null then raise exception 'Scegli il motivo dell''annullamento'; end if;
  perform privato.ct_chiudi(p_id, 'annullata', p_testo);
  update public.chiamate_trasferite
     set richiamato_at = now(), richiamato_da = privato.ct_autore(), esito_richiamo = 'Pratica annullata', richiamo_notificato = true
   where pratica_id = p_id and solo_commerciale and richiamato_at is null;
end $function$;

create or replace function public.centralino_avvisato_telefono(p_pratica_id bigint, p_trasf_id bigint, p_chi text, p_destinatario text, p_template text default null, p_avanza text default null)
returns void language plpgsql security definer set search_path to '' as $function$
declare r public.chiamate_trasferite; pid bigint := p_pratica_id; d jsonb := '{}'::jsonb;
begin
  perform privato.richiedi_centralino();
  if p_chi not in ('cliente', 'referente', 'tecnico', 'coordinatore', 'commerciale') then raise exception 'Destinatario non valido'; end if;
  if p_trasf_id is not null then
    select * into r from public.chiamate_trasferite where id = p_trasf_id for update;
    if r.id is null then raise exception 'Trasferimento non trovato'; end if;
    pid := coalesce(pid, r.pratica_id);
    if p_chi = 'cliente' then
      update public.chiamate_trasferite set email_riepilogo_at = now(), email_cliente_inviata_at = now(), email_non_disponibile = null where id = p_trasf_id;
    else
      update public.chiamate_trasferite set email_referente_inviata_at = now() where id = p_trasf_id;
    end if;
  end if;
  if pid is null then
    if p_trasf_id is null then raise exception 'Pratica non trovata'; end if;
    return;
  end if;
  if not exists (select 1 from public.pratiche where id = pid) then raise exception 'Pratica non trovata'; end if;
  perform privato.ct_evento(pid, 'nota', null, null,
    'Avvisato per telefono: ' || coalesce(nullif(btrim(coalesce(p_destinatario, '')), ''), p_chi),
    jsonb_build_object('canale', 'telefono', 'comunicazione', true, 'chi', p_chi, 'destinatario', p_destinatario,
      'template', p_template, 'trasferimento_id', p_trasf_id));
  update public.pratiche set updated_at = now() where id = pid;
  if p_chi = 'coordinatore' then
    d := jsonb_build_object('coordinatore_telefonato', true)
         || case when nullif(btrim(coalesce(p_destinatario, '')), '') is not null then jsonb_build_object('coordinatore_nome', btrim(p_destinatario)) else '{}'::jsonb end;
  end if;
  if p_avanza is not null then perform public.centralino_avanza(pid, p_avanza, d, 'Avvisato per telefono'); end if;
end $function$;
