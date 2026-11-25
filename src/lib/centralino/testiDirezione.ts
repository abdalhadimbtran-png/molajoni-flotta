/**
 * TUTTI i testi della pagina Direzione (offerte e chiamate) e della pagina «Offerte» di Jennifer, in un solo file.
 * Regole (richiesta del titolare, 25/11/2026): italiano semplice e diretto, frasi brevi, niente inglese, niente metafore.
 * Ogni numero ha sotto una riga che dice cosa conta. Le stesse parole sono usate nel Report Direzione (SQL 0100).
 * `ar` = significato in arabo, solo per la revisione di Hadi (non compare nelle pagine).
 * Esportati anche in Testi_Direzione_da_rivedere.md (script scripts/esporta-testi-direzione.ts).
 */
export interface Testo { it: string; def?: string; ar: string }

export const KPI_OFFERTE = {
  arrivate: { it: 'Offerte arrivate', def: 'Richieste di offerta arrivate nel periodo (telefono, email, WhatsApp…).', ar: 'طلبات عروض الأسعار التي وصلت خلال الفترة' },
  in_tempo: { it: 'Inviate in tempo', def: 'Inviate entro la scadenza: 60 minuti per Jennifer, 2 giorni lavorativi per i colleghi. % sulle offerte arrivate.', ar: 'عروض أُرسلت ضمن المهلة: 60 دقيقة لجنيفر، يوما عمل للزملاء. النسبة من العروض الواصلة' },
  in_ritardo: { it: 'Inviate in ritardo', def: 'Inviate dopo la scadenza. % sulle offerte arrivate.', ar: 'عروض أُرسلت بعد انتهاء المهلة. النسبة من العروض الواصلة' },
  da_inviare: { it: 'Ancora da inviare', def: 'Non ancora inviate al cliente. % sulle offerte arrivate.', ar: 'عروض لم تُرسل للزبون بعد' },
  accettate: { it: 'Accettate', def: 'Accettate dal cliente. % sulle offerte inviate.', ar: 'عروض قبلها الزبون. النسبة من العروض المرسلة' },
  non_accettate: { it: 'Non accettate', def: 'Non accettate dal cliente. % sulle offerte inviate.', ar: 'عروض لم يقبلها الزبون. النسبة من العروض المرسلة' },
} satisfies Record<string, Testo>;

export const STATI_OFFERTA = {
  da_inviare: { it: 'Da inviare', ar: 'لم تُرسل بعد' },
  in_ritardo: { it: 'In ritardo', ar: 'متأخرة (انتهت المهلة ولم تُرسل) — عروض جنيفر' },
  scaduta: { it: 'Scaduta', ar: 'انتهت المهلة (عروض الزملاء، للمعلومة فقط)' },
  in_attesa: { it: 'Inviata, in attesa', ar: 'أُرسلت، بانتظار رد الزبون' },
  accettata: { it: 'Accettata', ar: 'مقبولة' },
  non_accettata: { it: 'Non accettata', ar: 'غير مقبولة' },
  annullata: { it: 'Annullata', ar: 'ملغاة' },
} satisfies Record<string, Testo>;

export const MOTIVI = ['Prezzo', 'Tempi', 'Scelto un concorrente', 'Nessuna risposta del cliente', 'Non più necessario', 'Altro'] as const;
export type Motivo = typeof MOTIVI[number];
export const MOTIVI_AR: Record<Motivo, string> = {
  'Prezzo': 'السعر', 'Tempi': 'المواعيد / مدة التنفيذ', 'Scelto un concorrente': 'اختار منافساً', 'Nessuna risposta del cliente': 'الزبون لم يرد',
  'Non più necessario': 'لم يعد بحاجة', 'Altro': 'سبب آخر (مع ملاحظة)',
};

/** Pagina Direzione. */
export const DIR = {
  titolo: { it: 'Offerte e centralino', ar: 'العروض والسنترال' },
  sottotitolo: { it: 'Sola lettura. Dati aggiornati in tempo reale.', ar: 'للقراءة فقط. البيانات محدثة مباشرة' },
  periodo: { it: 'Periodo', ar: 'الفترة' },
  sez_offerte: { it: 'Offerte', def: 'Dalla richiesta del cliente all\'invio dell\'offerta, poi la risposta del cliente.', ar: 'العروض: من طلب الزبون حتى إرسال العرض ثم رد الزبون' },
  jennifer: { it: 'Jennifer', ar: 'جنيفر' },
  colleghi: { it: 'Colleghi', ar: 'الزملاء' },
  tutte: { it: 'Tutte', ar: 'الكل' },
  di_cui: { it: 'di cui', ar: 'منها' },
  oltre_scadenza: { it: 'oltre la scadenza', ar: 'تجاوزت المهلة' },
  per_persona: { it: 'Offerte per persona', def: 'Chi ha gestito le offerte arrivate nel periodo.', ar: 'العروض حسب الشخص المسؤول' },
  col_persona: { it: 'Persona', ar: 'الشخص' },
  col_arrivate: { it: 'Arrivate', ar: 'وصلت' },
  col_in_tempo: { it: 'Inviate in tempo', ar: 'أُرسلت ضمن المهلة' },
  col_accettate: { it: 'Accettate', ar: 'مقبولة' },
  col_tempo_medio: { it: 'Tempo medio di invio', def: 'Tempo medio tra l\'arrivo della richiesta e l\'invio dell\'offerta.', ar: 'متوسط الوقت بين وصول الطلب وإرسال العرض' },
  motivi_non: { it: 'Perché non accettate', def: 'Motivo scelto quando l\'offerta non è stata accettata.', ar: 'أسباب عدم القبول' },
  motivi_rit: { it: 'Perché in ritardo', def: 'Motivo scritto quando l\'offerta è stata inviata dopo la scadenza.', ar: 'أسباب التأخير' },
  canale: { it: 'Da dove arrivano', def: 'Come è arrivata la richiesta di offerta.', ar: 'من أين وصلت الطلبات (القناة)' },
  tabella: { it: 'Tutte le offerte', def: 'Clic su una riga per aprire la pratica.', ar: 'كل العروض — اضغط على السطر لفتح الملف' },
  col_cliente: { it: 'Cliente', ar: 'الزبون' },
  col_richiesta: { it: 'Richiesta', ar: 'الطلب' },
  col_arrivata: { it: 'Arrivata il', ar: 'وصلت في' },
  col_gestita: { it: 'Gestita da', ar: 'يتابعها' },
  col_inviata: { it: 'Inviata il', ar: 'أُرسلت في' },
  col_stato: { it: 'Stato', ar: 'الحالة' },
  col_motivo: { it: 'Motivo', ar: 'السبب' },
  nessuna: { it: 'Nessuna offerta nel periodo.', ar: 'لا توجد عروض في هذه الفترة' },
  sez_chiamate: { it: 'Chiamate e richieste', def: 'Tutti i contatti registrati al centralino nel periodo.', ar: 'المكالمات والطلبات' },
  richieste: { it: 'Richieste ricevute', def: 'Chiamate, email e messaggi registrati al centralino nel periodo.', ar: 'كل المكالمات والإيميلات والرسائل المسجلة' },
  registrate_dopo: { it: 'Registrate dopo', def: 'Chiamate inserite più tardi, non durante la telefonata.', ar: 'مكالمات سُجلت لاحقاً وليس أثناء المكالمة' },
  per_tipo: { it: 'Per tipo', ar: 'حسب النوع' },
  per_canale: { it: 'Per canale', ar: 'حسب القناة' },
  db_mancante: { it: 'Il registro delle offerte non è ancora attivo: manca l\'aggiornamento del database.', ar: 'سجل العروض غير مفعّل بعد: ينقص تحديث قاعدة البيانات' },
} satisfies Record<string, Testo>;

/** Pagina «Offerte» di Jennifer. */
export const JEN = {
  titolo: { it: 'Offerte', ar: 'العروض' },
  tab_colleghi: { it: 'Passate ai colleghi', ar: 'محولة للزملاء' },
  tab_mie: { it: 'Mie offerte', ar: 'عروضي' },
  regola: { it: 'Aggiorna ogni giorno tutte le offerte aperte.', ar: 'حدّثي كل يوم كل العروض المفتوحة' },
  facoltativo: { it: 'Quando un collega ti dice qualcosa, segnalo qui.', ar: 'عندما يخبرك زميل بشيء، سجّليه هنا (اختياري)' },
  da_aggiornare: { it: 'Da aggiornare oggi', ar: 'يجب تحديثها اليوم' },
  banner_oggi: { it: 'offerte da aggiornare oggi', ar: 'عروض يجب تحديثها اليوم' },
  chip_oggi: { it: 'Offerte da aggiornare', ar: 'عروض للتحديث' },
  col_scadenza: { it: 'Scadenza invio', ar: 'آخر موعد للإرسال' },
  col_ultimo: { it: 'Ultimo aggiornamento', ar: 'آخر تحديث' },
  az_inviata: { it: 'Inviata', ar: 'أُرسلت' },
  az_accettata: { it: 'Accettata', ar: 'مقبولة' },
  az_non: { it: 'Non accettata', ar: 'غير مقبولة' },
  az_annullata: { it: 'Annullata', ar: 'ملغاة' },
  az_nota: { it: 'Nota', ar: 'ملاحظة' },
  quando_inviata: { it: 'Quando è stata inviata', ar: 'متى أُرسلت' },
  motivo: { it: 'Motivo', ar: 'السبب' },
  nota_motivo: { it: 'Nota (obbligatoria con «Altro»)', ar: 'ملاحظة (إلزامية مع «سبب آخر»)' },
  motivo_ritardo: { it: 'Perché in ritardo', ar: 'لماذا تأخر' },
  nota_seguito: { it: 'Aggiornamento (es. «Sentito Luca: la manda domani»)', ar: 'تحديث (مثلاً: «تكلمت مع لوكا: يرسلها غداً»)' },
  arrivata_il: { it: 'Arrivata il', ar: 'وصلت في' },
  numero_adhoc: { it: 'N. offerta Ad Hoc', ar: 'رقم العرض في Ad Hoc' },
  importo: { it: 'Importo €', ar: 'المبلغ €' },
  salva: { it: 'Salva', ar: 'حفظ' },
  nessuna: { it: 'Nessuna offerta aperta.', ar: 'لا توجد عروض مفتوحة' },
  chiuse: { it: 'Mostra anche chiuse', ar: 'إظهار المغلقة أيضاً' },
} satisfies Record<string, Testo>;

export const t = (x: Testo) => x.it;
