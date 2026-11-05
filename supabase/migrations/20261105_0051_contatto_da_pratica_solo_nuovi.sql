-- 0051 Dalla pratica si aggiunge in rubrica solo un contatto NUOVO; le modifiche a un contatto esistente
-- passano da «Aggiorna anche nell'anagrafica del cliente?» (centralino_salva_contatto con id, storia e motivo).
create or replace function privato.tg_pratica_contatto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tel text; em text := nullif(lower(btrim(coalesce(new.email, ''))), '');
begin
  if coalesce(new.telefono, new.email) is null then return null; end if;
  begin tel := privato.ct_tel(new.telefono); exception when others then tel := null; end;
  if exists (select 1 from public.clienti_contatti c
              where c.attivo and (c.cod_cliente = new.cliente_codice or (c.cod_cliente is null and lower(c.cliente_nome) = lower(new.cliente_nome)))
                and ((tel is not null and (c.telefono = tel or c.cellulare = tel)) or (em is not null and c.email = em))) then
    return null;
  end if;
  begin
    insert into public.clienti_contatti (cod_cliente, cliente_nome, sede, contatto_nome, telefono, email, fonte, aggiornato_da)
    values (new.cliente_codice, new.cliente_nome, new.sede, new.contatto_nome, tel, case when em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em end, 'centralino', privato.ct_autore());
    insert into public.clienti_contatti_storia (contatto_id, campo, a, motivo, pratica_id, autore_nome)
    values (currval(pg_get_serial_sequence('public.clienti_contatti', 'id')), 'nuovo', concat_ws(' · ', new.contatto_nome, tel, em), 'Dalla pratica ' || new.numero, new.id, privato.ct_autore());
  exception when others then null;
  end;
  return null;
end $$;
