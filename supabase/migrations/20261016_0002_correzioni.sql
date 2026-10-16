-- La conferma del piano scrive in "piani", che non è scrivibile direttamente: la funzione lo fa per conto del responsabile.
alter function public.conferma_piano(date) security definer;
-- Chiarezza nella risposta all'app tecnico: false invece di null quando il veicolo è in sede.
create or replace function public.tecnico_veicolo(p_token text, p_qr text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli;
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso;
  if not found then raise exception 'Codice QR non riconosciuto. Avvisa il responsabile flotta.'; end if;
  return jsonb_build_object(
    'targa', v.targa, 'modello', v.marca_modello, 'km', v.km_attuali,
    'in_carico_a', (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico),
    'in_carico_a_me', coalesce(v.tecnico_in_carico = tid, false),
    'utilizzabile', not exists (select 1 from public.controlli_veicolo(v.id) c where c.livello = 'ko'),
    'controlli', coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_veicolo(v.id) c), '[]'));
end $$;
revoke execute on function public.tecnico_veicolo(text, text) from public;
grant execute on function public.tecnico_veicolo(text, text) to anon, authenticated;
