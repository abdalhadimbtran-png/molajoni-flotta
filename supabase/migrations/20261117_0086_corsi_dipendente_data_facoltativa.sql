-- Corsi importati dall'elenco reale senza data: la data si completa dopo in Formazione.
alter table public.corsi_dipendente alter column data_conseguimento drop not null;
