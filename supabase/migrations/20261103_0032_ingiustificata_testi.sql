-- Testi della conversione: nome del tipo con le maiuscole originali (es. «Permesso ROL»).
create or replace function public.hr_converti_ingiustificata(p_id bigint, p_tipo text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.richieste_assenza; n public.richieste_assenza; c jsonb; t public.tipi_assenza;
begin
  perform public.richiedi_hr();
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  select * into r from public.richieste_assenza where id = p_id for update;
  if r.id is null or r.tipo <> 'ING' then raise exception 'Assenza ingiustificata non trovata.'; end if;
  perform privato.controlla_decisore(r.dipendente_id);
  perform 1 from public.dipendenti where id = r.dipendente_id for update;
  c := privato.calcolo_conversione(p_id, p_tipo);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  if (c->>'saldo_insufficiente')::boolean then raise exception '%', privato.errore_saldo_conversione(c); end if;
  select * into t from public.tipi_assenza where codice = c->>'tipo';

  -- niente notifiche intermedie (annullata + nuova): il dipendente riceve un solo messaggio alla fine
  perform set_config('portale.senza_notifiche', 'on', true);
  update public.richieste_assenza set stato = 'annullata', annullata_da = 'hr', annullata_da_utente = auth.uid(), annullata_il = now(),
         motivo_annullamento = 'Convertita in ' || privato.nome_tipo_breve(t.descrizione)
   where id = r.id;
  n := privato.salva_richiesta(c, coalesce(nullif(trim(coalesce(p_note, '')), ''), r.note), 'hr', auth.uid(), true);
  update public.richieste_assenza
     set meta = c->>'meta', convertita_da = r.id,
         motivo_decisione = 'Conversione dell''assenza ingiustificata ' || r.numero
   where id = n.id;
  update public.richieste_assenza
     set convertita_in = n.id, motivo_annullamento = 'Convertita in ' || privato.nome_tipo_breve(t.descrizione) || ' (' || n.numero || ')'
   where id = r.id;
  perform set_config('portale.senza_notifiche', '', true);

  perform privato.notifica_dipendente(r.dipendente_id, 'Assenza ingiustificata convertita',
    r.numero || ' → ' || n.numero || ' · ' || privato.periodo_testo(n.primo_giorno, n.ultimo_giorno, n.ora_inizio, n.ora_fine, n.mezza_giornata),
    jsonb_build_object('richiesta_id', n.id, 'numero', n.numero, 'evento', 'convertita', 'originale', r.numero), 'info');
  return jsonb_build_object('ok', true, 'id', n.id, 'numero', n.numero, 'originale', r.numero,
    'messaggio', r.numero || ' convertita in ' || privato.nome_tipo_breve(t.descrizione) || ' ' || n.numero || ': ' || privato.fmt_q(n.quantita, n.unita) || '.');
end $$;
