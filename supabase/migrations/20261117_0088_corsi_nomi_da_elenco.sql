-- Nomi corsi esattamente come nell'elenco tecnici (Jennifer); descrizione estesa in "descrizione".
update public.corsi c set nome=v.nome, descrizione=v.descr from (values
 (1,'FORM.GEN.+SPEC','Formazione generale + specifica dei lavoratori (D.Lgs. 81/08, Accordo Stato-Regioni): aggiornamento ogni 5 anni.'),
 (3,'ALTO RISCHIO','Addetto antincendio – livello 3 / rischio elevato (D.M. 02/09/2021).'),
 (4,'PRIMO SOCCORSO','Addetto primo soccorso (D.M. 388/2003): aggiornamento ogni 3 anni.'),
 (5,'LAVORI IN QUOTA','Lavori in quota e uso DPI anticaduta di III categoria.'),
 (6,'PLE','Conduzione piattaforme di lavoro mobili elevabili (Accordo Stato-Regioni 22/02/2012).'),
 (8,'LAVORI CONFINATI','Lavori in ambienti sospetti di inquinamento o confinati (D.P.R. 177/2011).'),
 (9,'ESTINTORI','Abilitazione manutenzione estintori (UNI 9994-1/-2).'),
 (11,'MEDIO RISCHIO','Addetto antincendio – livello 2 / rischio medio (D.M. 02/09/2021).'),
 (12,'PES/PEI/PAV','Persona esperta / idonea / avvertita per lavori elettrici (CEI 11-27, CEI EN 50110).'),
 (13,'PREPOSTO','Formazione preposto (art. 37 D.Lgs. 81/08): aggiornamento biennale.'),
 (14,'RLS','Rappresentante dei lavoratori per la sicurezza: aggiornamento annuale.'),
 (15,'FGAS','Certificazione persone F-Gas – gas fluorurati (Reg. UE 2024/573, D.P.R. 146/2018).'),
 (16,'IDONEITA'' VVF','Attestato di idoneità tecnica VVF per addetto antincendio.'),
 (17,'PORTE','Abilitazione manutenzione porte tagliafuoco / resistenti al fuoco (UNI 11473).'),
 (18,'SPRINKLER','Abilitazione manutenzione impianti sprinkler (UNI EN 12845).'),
 (19,'IDRANTI','Abilitazione manutenzione reti idranti (UNI 10779, UNI EN 671-3).')
) v(id,nome,descr) where c.id=v.id;
update public.corsi_dipendente set note='Data da completare' where data_conseguimento is null and coalesce(note,'')<>'Data da completare';
