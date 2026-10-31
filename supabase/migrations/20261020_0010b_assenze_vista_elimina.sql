-- Compatibilità con il pannello attuale (src/admin/Tecnici.tsx): il pulsante "Elimina"
-- di un'assenza manuale lavora sulla vista `assenze`. Il trigger INSTEAD OF non cancella:
-- segna la riga di assenze_manuali come annullata (le righe non si cancellano mai).
-- Le righe che vengono da richieste HR (id negativo) restano protette (errore in italiano).
create or replace trigger assenze_vista_scrittura instead of insert or update or delete on public.assenze
  for each row execute function public.tg_assenze_vista();
grant delete on public.assenze to authenticated;
