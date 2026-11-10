-- «Avvisato per telefono»: alternativa rapida all'email. Registra l'avviso (nota, canale telefono) e conta
-- come l'email inviata: per i trasferimenti valorizza gli stessi campi *_inviata_at, per le pratiche può avanzare il passo.
-- Solo aggiunte (nessun DROP/DELETE/REVOKE).
create or replace function public.centralino_avvisato_telefono(
  p_pratica_id bigint, p_trasf_id bigint, p_chi text, p_destinatario text,
  p_template text default null, p_avanza text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.chiamate_trasferite; pid bigint := p_pratica_id;
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
  if p_avanza is not null then perform public.centralino_avanza(pid, p_avanza, '{}'::jsonb, 'Avvisato per telefono'); end if;
end $$;
grant execute on function public.centralino_avvisato_telefono(bigint, bigint, text, text, text, text) to authenticated;
