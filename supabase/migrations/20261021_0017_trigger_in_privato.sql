-- Advisor di sicurezza (21/10/2026): le funzioni trigger nuove stavano in `public` ed erano
-- elencate come chiamabili via /rest/v1/rpc (in realtà Postgres rifiuta la chiamata diretta di
-- una funzione trigger, ma è meglio non esporle). Si spostano nello schema `privato`, che non è
-- esposto dalle API: i trigger le richiamano per OID e continuano a funzionare.
alter function public.tg_richiesta_sincronizza() set schema privato;
alter function public.tg_richiesta_notifiche() set schema privato;
alter function public.tg_dipendente_categoria() set schema privato;
alter function public.tg_assenze_vista() set schema privato;
alter function public.tg_tipi_assenza_blocco() set schema privato;
