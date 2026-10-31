-- Dati di prova: 3 dipendenti non TEC (portale ferie). Codici e PIN in docs/PROVE_fase2-4.md.
do $$
declare r record;
begin
  for r in select * from (values
    ('ZUFF1', 'Prova', 'Ufficio', 'UFFICIO', 'Amministrazione', '616367'),
    ('ZMAG1', 'Prova', 'Magazzino', 'MAGAZZINO', 'Magazzino', '857709'),
    ('ZALT1', 'Prova', 'Altro', 'ALTRO', 'Servizi', '080216')) v(codice, nome, cognome, categoria, reparto, pin)
  loop
    perform privato.controlla_pin(r.pin);
    insert into public.dipendenti (codice, nome, cognome, ruolo, categoria, reparto, data_assunzione, contratto, attivo, pin_hash)
    values (r.codice, r.nome, r.cognome, '[PROVA] da disattivare', r.categoria, r.reparto, date '2024-01-08', 'full-time', true,
            extensions.crypt(r.pin, extensions.gen_salt('bf')))
    on conflict (codice) do nothing;
  end loop;
end $$;
