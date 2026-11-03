-- Il «rientro» mostrato è il primo giorno LAVORATIVO dopo l'ultimo giorno di assenza
-- (rispetta giorni_riposo del dipendente e festività attive). Prima era ultimo_giorno + 1 (es. sabato).
create or replace function privato.rientro_dopo(p_riposo text, p_ultimo date)
returns date language plpgsql stable set search_path to '' as $$
declare d date := p_ultimo + 1; i int := 0;
begin
  while i < 60 and not privato.e_lavorativo(coalesce(p_riposo, '0000011'), d) loop d := d + 1; i := i + 1; end loop;
  return d;
end $$;

do $do$
declare def text;
begin
  def := pg_get_functiondef('privato.richiesta_json(public.richieste_assenza, boolean)'::regprocedure);
  def := replace(def, '''rientro'', r.ultimo_giorno + 1',
    '''rientro'', privato.rientro_dopo((select dd.giorni_riposo from public.dipendenti dd where dd.id = r.dipendente_id), r.ultimo_giorno)');
  if position('rientro_dopo' in def) = 0 then raise exception 'richiesta_json: pattern non trovato'; end if;
  execute def;
end $do$;
