-- 0042 Indici per clienti con molte sedi (es. 500+). Non distruttiva.
create index if not exists interventi_importati_cliente on public.interventi_importati (cod_cliente);
create index if not exists interventi_importati_cliente_imp on public.interventi_importati (cod_cliente, impianto);
create index if not exists interventi_importati_tecnico on public.interventi_importati (tecnico_sigla);
create index if not exists interventi_importati_stato on public.interventi_importati (stato);
create index if not exists impianti_posizione_cliente on public.impianti_posizione (cod_cliente);
