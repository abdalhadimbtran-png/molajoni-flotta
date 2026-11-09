-- Centralino: «Chi chiama» (tipo di contatto) e anagrafica fornitori.
-- Non distruttiva: solo ADD COLUMN / CREATE. I campi cliente_* restano per nome/telefono/email di chiunque chiami.

alter table public.pratiche add column if not exists tipo_contatto text not null default 'cliente';
alter table public.chiamate_trasferite add column if not exists tipo_contatto text not null default 'cliente';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pratiche_tipo_contatto_check') then
    alter table public.pratiche add constraint pratiche_tipo_contatto_check check (tipo_contatto in ('cliente', 'fornitore', 'collega', 'altro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chiamate_trasferite_tipo_contatto_check') then
    alter table public.chiamate_trasferite add constraint chiamate_trasferite_tipo_contatto_check check (tipo_contatto in ('cliente', 'fornitore', 'collega', 'altro'));
  end if;
end $$;
create index if not exists pratiche_tipo_contatto_idx on public.pratiche (tipo_contatto);

-- Trasferimento legato a una pratica: eredita il tipo di contatto della pratica.
create or replace function privato.ct_trasf_tipo_contatto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pratica_id is not null and new.tipo_contatto = 'cliente' then
    select p.tipo_contatto into new.tipo_contatto from public.pratiche p where p.id = new.pratica_id;
    new.tipo_contatto := coalesce(new.tipo_contatto, 'cliente');
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ct_trasf_tipo_contatto') then
    create trigger ct_trasf_tipo_contatto before insert on public.chiamate_trasferite for each row execute function privato.ct_trasf_tipo_contatto();
  end if;
end $$;

-- Imposta il tipo di contatto (dopo centralino_crea / centralino_trasferisci, o per correggerlo dalla scheda).
create or replace function public.centralino_tipo_contatto(p_pratica_id bigint, p_trasf_id bigint, p_tipo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  if p_tipo is null or p_tipo not in ('cliente', 'fornitore', 'collega', 'altro') then raise exception 'Tipo di contatto non valido'; end if;
  if p_pratica_id is not null then
    update public.pratiche set tipo_contatto = p_tipo,
      stato_cliente = case when p_tipo = 'cliente' then stato_cliente else null end
    where id = p_pratica_id;
    update public.chiamate_trasferite set tipo_contatto = p_tipo where pratica_id = p_pratica_id;
  end if;
  if p_trasf_id is not null then update public.chiamate_trasferite set tipo_contatto = p_tipo where id = p_trasf_id; end if;
end $$;
grant execute on function public.centralino_tipo_contatto(bigint, bigint, text) to authenticated;

-- Anagrafica fornitori (semplice).
create table if not exists public.fornitori (
  id bigint generated always as identity primary key,
  nome text not null check (btrim(nome) <> ''),
  piva text, telefono text, email text, referente text, note text,
  attivo boolean not null default true,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create unique index if not exists fornitori_nome_uq on public.fornitori (lower(btrim(nome)));
alter table public.fornitori enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'fornitori' and policyname = 'fornitori_leggi') then
    create policy fornitori_leggi on public.fornitori for select to authenticated using ((select public.is_centralino_lettura()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fornitori' and policyname = 'fornitori_scrivi') then
    create policy fornitori_scrivi on public.fornitori for insert to authenticated with check ((select public.is_centralino()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fornitori' and policyname = 'fornitori_modifica') then
    create policy fornitori_modifica on public.fornitori for update to authenticated using ((select public.is_centralino())) with check ((select public.is_centralino()));
  end if;
end $$;
grant select, insert, update on public.fornitori to authenticated;

create or replace function public.centralino_fornitori(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(f) order by f.nome) from (
    select id, nome, piva, telefono, email, referente from public.fornitori
    where attivo and (coalesce(btrim(p_q), '') = '' or nome ilike '%' || btrim(p_q) || '%' or piva ilike btrim(p_q) || '%'
      or regexp_replace(coalesce(telefono, ''), '\D', '', 'g') like '%' || nullif(regexp_replace(p_q, '\D', '', 'g'), '') || '%')
    order by nome limit 12) f), '[]'::jsonb);
end $$;
grant execute on function public.centralino_fornitori(text) to authenticated;

-- Nuovo fornitore al volo (nome + telefono): se esiste già con lo stesso nome lo restituisce.
create or replace function public.centralino_fornitore_salva(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.fornitori; v_nome text := nullif(btrim(coalesce(p->>'nome', '')), '');
begin
  perform privato.richiedi_centralino();
  if v_nome is null then raise exception 'Indica il nome del fornitore'; end if;
  select * into r from public.fornitori where lower(btrim(nome)) = lower(v_nome);
  if r.id is null then
    insert into public.fornitori (nome, piva, telefono, email, referente, note)
    values (v_nome, nullif(btrim(coalesce(p->>'piva', '')), ''), nullif(btrim(coalesce(p->>'telefono', '')), ''),
      nullif(lower(btrim(coalesce(p->>'email', ''))), ''), nullif(btrim(coalesce(p->>'referente', '')), ''), nullif(btrim(coalesce(p->>'note', '')), ''))
    returning * into r;
  else
    update public.fornitori set telefono = coalesce(telefono, nullif(btrim(coalesce(p->>'telefono', '')), '')),
      email = coalesce(email, nullif(lower(btrim(coalesce(p->>'email', ''))), '')), attivo = true
    where id = r.id returning * into r;
  end if;
  return to_jsonb(r);
end $$;
grant execute on function public.centralino_fornitore_salva(jsonb) to authenticated;
