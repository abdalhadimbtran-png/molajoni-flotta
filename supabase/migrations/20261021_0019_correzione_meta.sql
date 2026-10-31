-- Correzione 0018: nella funzione di calcolo la variabile `meta` era ambigua con la colonna
-- richieste_assenza.meta (errore 42702). Rinominata v_meta; nessun altro cambiamento.
create or replace function privato.calcola_richiesta(
  p_dip bigint, p_tipo text, p_primo date, p_rientro date,
  p_ora_inizio time, p_ora_fine time, p_mezza boolean, p_da_dipendente boolean, p_meta text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  c jsonb; err text[]; conf text; soglia time := privato.ora_meta();
  mezza boolean := coalesce(p_mezza, false); v_meta text := nullif(lower(trim(coalesce(p_meta, ''))), '');
begin
  c := privato.calcola_richiesta(p_dip, p_tipo, p_primo, p_rientro, p_ora_inizio, p_ora_fine, p_mezza, p_da_dipendente);
  err := array(select jsonb_array_elements_text(c->'errori'));
  if mezza then
    if v_meta is null then err := err || 'Scegli se sei assente la mattina o il pomeriggio.'::text;
    elsif v_meta not in ('mattina', 'pomeriggio') then err := err || 'Mezza giornata: indica mattina o pomeriggio.'::text; end if;
  elsif v_meta is not null then
    err := err || 'Mattina o pomeriggio si sceglie solo per la mezza giornata.'::text;
  end if;
  if cardinality(err) = 0 and (mezza or p_ora_inizio is not null) then
    select string_agg(distinct r.numero || ' (' || replace(r.stato, '_', ' ') || ')', ', ') into conf
      from public.richieste_assenza r join public.richieste_assenza_giorni g on g.richiesta_id = r.id
     where r.dipendente_id = p_dip and r.stato in ('in_attesa', 'approvata') and g.giorno = p_primo
       and ((mezza and r.mezza_giornata and r.meta = v_meta)
            or (mezza and r.ora_inizio is not null
                and case v_meta when 'mattina' then r.ora_inizio < soglia else r.ora_fine > soglia end)
            or (p_ora_inizio is not null and r.mezza_giornata and r.meta is not null
                and case r.meta when 'mattina' then p_ora_inizio < soglia else p_ora_fine > soglia end));
    if conf is not null then
      err := err || ('Per questa parte della giornata c''è già una richiesta: ' || conf || '. Scegli un altro orario o annulla quella richiesta.');
    end if;
  end if;
  return c || jsonb_build_object('meta', case when mezza then v_meta end, 'errori', to_jsonb(err), 'ok', cardinality(err) = 0);
end $$;
