-- Piano: con l'etichetta generica il messaggio diventava "Assente: Assente". Ora: "Assente"
-- (le assenze manuali restano "Assente: Formazione", ecc.). Sostituzione puntuale.
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.piano_giorno(date)'::regprocedure);
  nuovo := replace(src, $a$msgs := msgs || jsonb_build_object('l','info','m','Assente: ' || ass);$a$,
    $a$msgs := msgs || jsonb_build_object('l','info','m', case when ass = 'Assente' then 'Assente' else 'Assente: ' || ass end);$a$);
  if nuovo = src then raise exception 'piano_giorno: testo atteso non trovato'; end if;
  execute nuovo;
end $$;
