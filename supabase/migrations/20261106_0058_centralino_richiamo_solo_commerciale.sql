-- Offerte da 1.000 €: il richiamo di 2 ore è del Tecnico Commerciale (campanella) e della Direzione (KPI/ritardi),
-- non del centralino. Non distruttiva: colonna + trigger + funzioni ridefinite.
alter table public.chiamate_trasferite add column if not exists solo_commerciale boolean not null default false;
comment on column public.chiamate_trasferite.solo_commerciale is 'Richiamo del commerciale (offerta da 1.000 €): fuori dalle code e dalle escalation del centralino.';

create or replace function privato.tg_trasf_solo_commerciale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pratica_id is not null and exists (select 1 from public.pratiche p where p.id = new.pratica_id and p.tipo = 'offerta_grande') then
    new.solo_commerciale := true;
  end if;
  return new;
end $$;
create or replace trigger trasf_solo_commerciale before insert on public.chiamate_trasferite for each row execute function privato.tg_trasf_solo_commerciale();

update public.chiamate_trasferite t set solo_commerciale = true
  from public.pratiche p where p.id = t.pratica_id and p.tipo = 'offerta_grande' and not t.solo_commerciale;

create or replace function privato.ct_notifica_direzione(p_titolo text, p_testo text, p_link text, p_livello text default 'warn') returns void
language sql set search_path = '' as $$
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'avviso', jsonb_build_object('categoria', 'centralino', 'livello', p_livello, 'titolo', p_titolo, 'testo', p_testo), p_link
    from public.responsabili r where r.attivo and r.direzione and not r.centralino and r.user_id is not null;
$$;

create or replace function privato.centralino_controlla_sla() returns int
language plpgsql security definer set search_path = '' as $$
declare p record; n int := 0; nomest text;
begin
  for p in select * from public.pratiche where esito = 'aperta' and sla_scadenza < now() and sla_notificato is distinct from sla_stadio for update skip locked loop
    select s->>'nome' into nomest from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p.sla_stadio;
    insert into public.pratiche_eventi (pratica_id, tipo, da_stato, a_stato, testo, dati, autore, autore_nome)
    values (p.id, 'sla_scaduto', p.stato_corrente, p.stato_corrente, 'Tempo scaduto per «' || coalesce(nomest, p.sla_stadio) || '»',
            jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza), null, 'Sistema');
    update public.pratiche set sla_notificato = sla_stadio, sla_rispettato = false where id = p.id;
    perform privato.ct_notifica('SLA scaduto · ' || p.numero, p.cliente_nome || ' — ' || coalesce(nomest, p.sla_stadio), '/centralino/pratica/' || p.id, 'ko');
    n := n + 1;
  end loop;
  for p in select * from public.chiamate_trasferite where richiamato_at is null and not promemoria_inviato and richiamo_scadenza > now()
            and richiamo_scadenza <= now() + interval '15 minutes' for update skip locked loop
    update public.chiamate_trasferite set promemoria_inviato = true where id = p.id;
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'warn', 'titolo', 'Tra poco: richiamare ' || coalesce(p.cliente_nome, p.telefono, 'il cliente'),
          'testo', concat_ws(' · ', p.argomento, p.telefono, 'entro ' || to_char(p.richiamo_scadenza at time zone 'Europe/Rome', 'HH24:MI'))), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  for p in select * from public.chiamate_trasferite where richiamato_at is null and richiamo_scadenza < now() and not richiamo_notificato for update skip locked loop
    update public.chiamate_trasferite set richiamo_notificato = true where id = p.id;
    if p.solo_commerciale then
      perform privato.ct_notifica_direzione('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
        p.destinatario_nome || ' non ha ancora richiamato (offerta da 1.000 €)' || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    else
      perform privato.ct_notifica('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
        p.destinatario_nome || ' non ha ancora richiamato' || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    end if;
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'ko', 'titolo', 'Richiamo scaduto: ' || coalesce(p.cliente_nome, p.telefono, 'cliente'), 'testo', p.argomento), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
