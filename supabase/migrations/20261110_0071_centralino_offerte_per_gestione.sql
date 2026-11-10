-- 0071 · Offerte instradate per «chi la gestisce» (non più per importo).
-- offerta_piccola = Gestita da Jennifer (centralino) · offerta_grande = Passata al Tecnico Commerciale.

-- 1) centralino_crea: instrada con p->>'gestione' ('centralino' | 'commerciale'); importo solo informativo.
do $m$
declare d text := pg_get_functiondef('public.centralino_crea(jsonb)'::regprocedure);
begin
  d := replace(d,
$a$  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') and imp is not null then
    v_tipo := case when imp > 1000 then 'offerta_grande' else 'offerta_piccola' end;
  elsif v_tipo = 'offerta' then v_tipo := 'offerta_piccola';
  end if;$a$,
$b$  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') then
    case coalesce(nullif(p->>'gestione', ''), case when v_tipo = 'offerta_grande' then 'commerciale' when v_tipo = 'offerta_piccola' then 'centralino' end)
      when 'centralino' then v_tipo := 'offerta_piccola';
      when 'commerciale' then v_tipo := 'offerta_grande';
      else raise exception 'Scegli chi gestisce l''offerta';
    end case;
  end if;$b$);
  d := replace(d, 'Offerta oltre 1.000 €: scegli il Tecnico Commerciale', 'Offerta passata al Tecnico Commerciale: scegli il Tecnico Commerciale');
  d := replace(d, '''tipo_argomento'', ''Offerta oltre 1.000 €''', '''tipo_argomento'', ''Offerta del Tecnico Commerciale''');
  if d ~ '1\.000|imp > 1000' then raise exception 'centralino_crea: sostituzione non riuscita'; end if;
  execute d;

  d := pg_get_functiondef('privato.centralino_controlla_sla()'::regprocedure);
  d := replace(d, '(offerta da 1.000 €)', '(offerta del Tecnico Commerciale)'); execute d;
  d := pg_get_functiondef('privato.ct_deriva_referenti'::regproc);
  d := replace(replace(d, 'offerte oltre 1.000 €', 'offerte del Tecnico Commerciale'), 'offerte fino a 1.000 €', 'offerte gestite dal centralino'); execute d;
  d := pg_get_functiondef('privato.ct_mancanti'::regproc);
  d := replace(d, 'delle offerte da 1.000 €', 'per le offerte'); execute d;
end $m$;

-- 2) etichette: flussi, modelli email, argomenti dei richiami
update public.pratiche_flussi set nome = 'Offerta gestita dal centralino' where tipo = 'offerta_piccola';
update public.pratiche_flussi set nome = 'Offerta passata al Tecnico Commerciale' where tipo = 'offerta_grande';
update public.email_template set nome = 'Al cliente – preventivo passato al Tecnico Commerciale' where codice = 'presa_offerta_grande';
update public.email_template set nome = 'Al Tecnico Commerciale – riepilogo preventivo da gestire',
  oggetto = '[Centralino] Preventivo da gestire – {cliente} – richiamare entro le {scadenza_richiamo}',
  titolo = 'Preventivo da gestire' where codice = 'riepilogo_commerciale';
update public.email_template set nome = replace(replace(nome, 'fino a 1.000 €', 'gestito dal centralino'), 'oltre 1.000 €', 'del Tecnico Commerciale') where nome ~ '1\.000';
update public.chiamate_trasferite set tipo_argomento = 'Offerta del Tecnico Commerciale' where tipo_argomento in ('Offerta oltre 1.000 €', 'Offerta > 1.000 €');
update public.chiamate_trasferite set tipo_argomento = 'Offerta gestita dal centralino' where tipo_argomento in ('Offerta fino a 1.000 €', 'Offerta ≤ 1.000 €');

-- 3) Passa al Tecnico Commerciale un'offerta aperta gestita da Jennifer
create or replace function public.centralino_passa_commerciale(p_id bigint, p_commerciale text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.pratiche; com jsonb; v_com text := nullif(btrim(coalesce(p_commerciale, '')), '');
begin
  perform privato.richiedi_centralino();
  select * into r from public.pratiche where id = p_id for update;
  if r.id is null then raise exception 'Pratica non trovata'; end if;
  if r.tipo <> 'offerta_piccola' then raise exception 'Solo le offerte gestite da Jennifer si possono passare al Tecnico Commerciale'; end if;
  if r.esito <> 'aperta' then raise exception 'La pratica non è aperta'; end if;
  select x into com from jsonb_array_elements(privato.ct_commerciali()) x where x->>'nome' = v_com;
  if com is null then raise exception 'Scegli il Tecnico Commerciale (vedi Referenti)'; end if;
  update public.pratiche set tipo = 'offerta_grande', stato_corrente = 'ricevuta', assegnato_ruolo = 'tecnico_commerciale', assegnato_nome = v_com,
    commerciale_nome = v_com, commerciale_email = nullif(lower(com->>'email'), ''), updated_at = now()
   where id = p_id;
  perform privato.ct_evento(p_id, 'modifica', r.stato_corrente, 'ricevuta', 'Passata al Tecnico Commerciale ' || v_com,
    jsonb_build_object('da_tipo', 'offerta_piccola', 'a_tipo', 'offerta_grande', 'da_stato', r.stato_corrente, 'commerciale', v_com));
  perform privato.ct_prossimo_sla(p_id, 1);
  perform public.centralino_trasferisci(jsonb_build_object('pratica_id', p_id, 'destinatario_nome', v_com, 'destinatario_email', com->>'email',
    'destinatario_ruolo', 'tecnico_commerciale', 'modalita', 'richiamo', 'tipo_argomento', 'Offerta del Tecnico Commerciale', 'argomento', r.descrizione,
    'scadenza', privato.ct_sla(now(), '{"tipo":"ore","valore":2}'), 'entro_testo', 'entro 2 ore'));
  return jsonb_build_object('id', p_id, 'tipo', 'offerta_grande');
end $$;
revoke all on function public.centralino_passa_commerciale(bigint, text) from public, anon;
grant execute on function public.centralino_passa_commerciale(bigint, text) to authenticated;
