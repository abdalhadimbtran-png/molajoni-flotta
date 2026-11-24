-- 0096 Requisito «email_inviata» (0095): conta solo le email registrate dopo l'ultimo passo (ordine per id, non per orario).
-- Già incluso nel testo di 0095 nel repo; applicato sul database come correzione separata.
do $m$
declare d text := pg_get_functiondef('privato.ct_mancanti'::regproc);
begin
  d := replace(d, $x$elsif not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at) and e.tipo = 'email_inviata') then$x$,
    $x$elsif not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.tipo = 'email_inviata'
                           and e.id > coalesce((select max(x.id) from public.pratiche_eventi x where x.pratica_id = p_id and x.tipo in ('creata', 'stato')), 0)) then$x$);
  if position('max(x.id)' in d) = 0 then return; end if;
  execute d;
end $m$;
