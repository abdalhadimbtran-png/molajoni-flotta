-- 0048 I tre commerciali delle offerte > 1.000 € vedono l'elenco disponibilità (per impostare il proprio stato da /centralino/trasferimenti).
create or replace function public.centralino_commerciali() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare mia text;
begin
  select lower(coalesce(nullif(r.email, ''), u.email)) into mia from public.responsabili r left join auth.users u on u.id = r.user_id where r.user_id = auth.uid() and r.attivo;
  if not (public.is_centralino_lettura() or (mia is not null and exists (
      select 1 from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x where i.chiave = 'commerciali_offerte_grandi' and lower(x->>'email') = mia))) then
    raise exception 'Accesso riservato al centralino' using errcode = '42501';
  end if;
  return privato.ct_commerciali();
end $$;
