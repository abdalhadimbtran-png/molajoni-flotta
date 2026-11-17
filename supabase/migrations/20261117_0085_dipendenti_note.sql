-- Note libere sulla scheda dipendente (es. altre categorie di patente, "tel. personale"). Additiva, nullable.
alter table public.dipendenti add column if not exists note text;
alter table public.dipendenti drop constraint if exists dipendenti_note_len;
alter table public.dipendenti add constraint dipendenti_note_len check (note is null or length(note) <= 2000);
grant select (note), insert (note), update (note) on public.dipendenti to authenticated;
