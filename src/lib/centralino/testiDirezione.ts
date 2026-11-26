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
  da_inviare: { it: 'Da inviare', def: 'Non ancora inviata al cliente, scadenza non superata.', ar: 'لم تُرسل بعد' },
  in_ritardo: { it: 'In ritardo', def: 'Non ancora inviata e la scadenza è passata.', ar: 'متأخرة (انتهت المهلة ولم تُرسل) — عروض جنيفر' },
  scaduta: { it: 'Scaduta', def: 'Offerta di un collega non inviata entro 2 giorni lavorativi.', ar: 'انتهت المهلة (عروض الزملاء، للمعلومة فقط)' },
  in_attesa: { it: 'Inviata', def: 'Inviata al cliente, in attesa della sua risposta.', ar: 'أُرسلت، بانتظار رد الزبون' },
  accettata: { it: 'Accettata', def: 'Il cliente ha detto sì.', ar: 'مقبولة' },
  non_accettata: { it: 'Non accettata', def: 'Il cliente ha detto no.', ar: 'غير مقبولة' },
  annullata: { it: 'Annullata', def: 'Richiesta ritirata o inserita per errore.', ar: 'ملغاة' },
} satisfies Record<string, Testo>;

export const MOTIVI = ['Prezzo', 'Tempi', 'Scelto un concorrente', 'Nessuna risposta del cliente', 'Non più necessario', 'Altro'] as const;
export type Motivo = typeof MOTIVI[number];
export const MOTIVI_AR: Record<Motivo, string> = {
  'Prezzo': 'السعر', 'Tempi': 'المواعيد / مدة التنفيذ', 'Scelto un concorrente': 'اختار منافساً', 'Nessuna risposta del cliente': 'الزبون لم يرد',
  'Non più necessario': 'لم يعد بحاجة', 'Altro': 'سبب آخر (مع ملاحظة)',
};

/** Pagina Direzione. */
export const DIR = {
  titolo: { it: 'Centralino e offerte', ar: 'العروض والسنترال' },
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
  richieste_chiuse: { it: 'Richieste chiuse', def: 'Richieste completate e chiuse nel periodo.', ar: 'طلبات اكتملت وأُغلقت خلال الفترة' },
  per_giorno: { it: 'Richieste al giorno', def: 'Quante richieste sono arrivate ogni giorno. Clic su un giorno per l\'elenco.', ar: 'عدد الطلبات كل يوم — اضغط على اليوم لرؤية القائمة' },
  clic_numero: { it: 'Clic su qualunque numero per vedere l\'elenco.', ar: 'اضغط على أي رقم لرؤية القائمة' },
  per_tipo: { it: 'Cosa ha chiesto il cliente', def: 'Numero di richieste per tipo (vedi «Legenda» in alto).', ar: 'ماذا طلب الزبون: عدد الطلبات حسب النوع' },
  per_canale: { it: 'Come è arrivata la richiesta', def: 'Telefono, WhatsApp, email, tablet del tecnico o altro.', ar: 'كيف وصل الطلب (القناة)' },
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

/**
 * NOMI DEI TIPI DI RICHIESTA — fonte unica per centralino, Direzione e Report (SQL 0100 usa le stesse parole).
 * Il titolare non deve mai vedere le chiavi interne (manutenzione, offerta_grande…).
 */
export const TIPI_RICHIESTA = {
  manutenzione: { it: 'Intervento tecnico', def: 'Il cliente chiede un tecnico: guasto, allarme o manutenzione da fare.', ar: 'تدخل فني: الزبون يطلب فنياً (عطل، إنذار أو صيانة)' },
  sopralluogo: { it: 'Sopralluogo', def: 'Visita per valutare un lavoro prima dell\'offerta.', ar: 'زيارة معاينة لتقييم العمل قبل عرض السعر' },
  offerta: { it: 'Offerta', def: 'Il cliente chiede un preventivo.', ar: 'عرض سعر: الزبون يطلب عرض سعر' },
  modifica: { it: 'Modifica dati o disdetta', def: 'Cambio dati del cliente, del calendario o disdetta del contratto.', ar: 'تعديل بيانات الزبون أو المواعيد أو إلغاء العقد' },
  informazione: { it: 'Informazione', def: 'Il cliente chiede solo un\'informazione.', ar: 'استفسار: الزبون يطلب معلومة فقط' },
} satisfies Record<string, Testo>;
export const SOTTOTIPI_OFFERTA = {
  offerta_piccola: { it: 'Offerta fatta da Jennifer', def: 'Jennifer prepara e invia l\'offerta (entro 60 minuti).', ar: 'عرض تعدّه جنيفر وترسله (خلال 60 دقيقة)' },
  offerta_grande: { it: 'Offerta passata a un collega', def: 'Offerta preparata da un collega (entro 2 giorni lavorativi).', ar: 'عرض محوّل لزميل (خلال يومي عمل)' },
  offerta_tablet: { it: 'Offerta da tablet del tecnico', def: 'Richiesta di offerta fatta dal tecnico sul tablet, dal cliente.', ar: 'طلب عرض من جهاز الفني اللوحي عند الزبون' },
} satisfies Record<string, Testo>;
/** Tipi non più usati: restano leggibili sui dati vecchi. */
export const TIPI_ALTRI = {
  amministrazione: { it: 'Fatture e pagamenti', ar: 'الفواتير والدفعات' },
  fornitori: { it: 'Fornitori', ar: 'الموردون' },
  trasferta: { it: 'Trasferta (alloggio)', ar: 'سفر عمل (سكن)' },
  abbigliamento: { it: 'Abbigliamento da lavoro', ar: 'ملابس العمل' },
} satisfies Record<string, Testo>;
/** Nome di un tipo interno (es. «offerta_grande» → «Offerta passata a un collega»). Mai la chiave. */
export function nomeTipo(k: string | null | undefined): string {
  const x = (TIPI_RICHIESTA as Record<string, Testo>)[k ?? ''] ?? (SOTTOTIPI_OFFERTA as Record<string, Testo>)[k ?? ''] ?? (TIPI_ALTRI as Record<string, Testo>)[k ?? ''];
  return x?.it ?? 'Altro';
}
/** Gruppo per la Direzione: le tre offerte contano come «Offerta». */
export const gruppoTipo = (k: string) => (k.startsWith('offerta') ? 'offerta' : k);

export const CANALI_NOMI = {
  telefono: { it: 'Telefono', ar: 'الهاتف' },
  whatsapp: { it: 'WhatsApp', ar: 'واتساب' },
  email: { it: 'Email', ar: 'البريد الإلكتروني' },
  tablet_tmq: { it: 'Tablet del tecnico', ar: 'الجهاز اللوحي للفني' },
  collega: { it: 'Collega o tecnico', ar: 'زميل أو فني' },
  altro: { it: 'Altro', ar: 'غير ذلك' },
} satisfies Record<string, Testo>;

export const ESITI_NOMI = {
  aperta: { it: 'Aperta', def: 'Ancora da completare.', ar: 'مفتوحة' },
  chiusa_ok: { it: 'Chiusa', def: 'Completata.', ar: 'مغلقة' },
  chiusa_ko: { it: 'Chiusa senza esito positivo', def: 'Completata, ma il cliente non ha confermato.', ar: 'مغلقة دون نتيجة إيجابية' },
  annullata: { it: 'Annullata', def: 'Ritirata o inserita per errore.', ar: 'ملغاة' },
} satisfies Record<string, Testo>;

/** Legenda in alto nella pagina Direzione. */
export const LEGENDA = {
  titolo: { it: 'Legenda: cosa chiede il cliente', ar: 'دليل: ماذا يطلب الزبون' },
  sotto: { it: 'Ogni richiesta registrata al centralino è di uno di questi tipi.', ar: 'كل طلب مسجل في السنترال من أحد هذه الأنواع' },
} satisfies Record<string, Testo>;

/** Pagina Panoramica (/direzione). */
export const PAN = {
  titolo: { it: 'Panoramica', ar: 'نظرة عامة' },
  sotto: { it: 'Sola lettura. Si aggiorna da solo.', ar: 'للقراءة فقط، تتحدث تلقائياً' },
  oggi: { it: 'Oggi', def: 'I numeri di oggi. Sotto ogni numero c\'è cosa conta.', ar: 'أرقام اليوم' },
  da_inviare: { it: 'Offerte ancora da inviare', def: 'Tutte le offerte non ancora inviate al cliente, di qualunque giorno.', ar: 'كل العروض التي لم تُرسل بعد، من أي يوم' },
  in_attesa: { it: 'Offerte in attesa di risposta', def: 'Offerte inviate: il cliente non ha ancora detto sì o no.', ar: 'عروض أُرسلت والزبون لم يرد بعد' },
  movimenti: { it: 'Ultimi movimenti', def: 'Cosa è stato fatto oggi, da chi e a che ora.', ar: 'آخر الحركات: ماذا حصل اليوم ومن ومتى' },
  tutti_mov: { it: 'Tutti i movimenti →', ar: 'كل الحركات' },
  prossimamente: { it: 'Prossimamente', ar: 'قريباً' },
  aggiornato: { it: 'Aggiornato alle', ar: 'آخر تحديث الساعة' },
} satisfies Record<string, Testo>;

/** Movimenti (storia delle richieste). */
export const MOVIMENTI = {
  creata: { it: 'ha registrato la richiesta', ar: 'سجّل الطلب' },
  nota: { it: 'ha aggiunto una nota', ar: 'أضاف ملاحظة' },
  email_inviata: { it: 'ha inviato un\'email', ar: 'أرسل بريداً' },
  chiamata: { it: 'ha registrato una chiamata', ar: 'سجّل مكالمة' },
  assegnata: { it: 'ha passato la richiesta a un collega', ar: 'حوّل الطلب لزميل' },
  appuntamento: { it: 'ha fissato l\'appuntamento', ar: 'حدد موعداً' },
  allegato: { it: 'ha allegato un file', ar: 'أرفق ملفاً' },
  sla_scaduto: { it: 'tempo superato', ar: 'تجاوز الوقت المحدد' },
  chiusa: { it: 'ha chiuso o annullato la richiesta', ar: 'أغلق أو ألغى الطلب' },
  modifica: { it: 'ha modificato i dati', ar: 'عدّل البيانات' },
  altro: { it: 'ha aggiornato la richiesta', ar: 'حدّث الطلب' },
  sistema: { it: 'Sistema', ar: 'النظام (تلقائي)' },
  nessuno: { it: 'Nessun movimento nel periodo.', ar: 'لا حركات في الفترة' },
} satisfies Record<string, Testo>;

/** Report PDF / Excel (pulsanti in alto). */
export const REPORT = {
  bottone: { it: 'Report direzione', ar: 'تقرير الإدارة' },
  settimana: { it: 'Settimana (da lunedì)', ar: 'الأسبوع (من الاثنين)' },
  mese: { it: 'Mese corrente', ar: 'الشهر الحالي' },
  corrente: { it: 'Periodo mostrato', ar: 'الفترة المعروضة' },
  titolo: { it: 'Report direzione – Centralino', ar: 'تقرير الإدارة – السنترال' },
  descr: { it: 'Riepilogo dei numeri del centralino, con il confronto col periodo prima.', ar: 'ملخص أرقام السنترال مع المقارنة بالفترة السابقة' },
  col_sezione: { it: 'Sezione', ar: 'القسم' },
  col_voce: { it: 'Voce', ar: 'البند' },
  col_valore: { it: 'Valore', ar: 'القيمة' },
  col_conteggio: { it: 'Quanti su quanti', def: 'Es. «8 / 10» = 8 su 10.', ar: 'كم من كم' },
  col_prec: { it: 'Periodo prima', ar: 'الفترة السابقة' },
  col_var: { it: 'Differenza', def: '▲ aumento, ▼ calo rispetto al periodo prima.', ar: 'الفرق' },
  col_def: { it: 'Cosa conta', ar: 'ماذا يحسب' },
  adesso: { it: 'situazione di adesso', ar: 'الوضع الحالي' },
  val_jen: { it: 'Valore offerte fatte da Jennifer', def: 'Somma degli importi stimati.', ar: 'قيمة العروض التي أعدّتها جنيفر' },
  val_col: { it: 'Valore offerte passate a un collega', def: 'Somma degli importi stimati.', ar: 'قيمة العروض المحوّلة للزملاء' },
  sez_volumi: { it: 'Quante richieste', ar: 'عدد الطلبات' },
  sez_offerte: { it: 'Offerte', ar: 'العروض' },
  sez_seguire: { it: 'Da seguire', ar: 'للمتابعة' },
  sez_qualita: { it: 'Qualità del lavoro', ar: 'جودة العمل' },
  auto: { it: 'Report settimanale e mensile (PDF)', ar: 'تقرير أسبوعي وشهري (PDF)' },
  auto_def: { it: 'Arriva per email ogni venerdì alle 16:00 (giovedì se il venerdì è festivo) e l\'ultimo giorno lavorativo del mese alle 16:00.', ar: 'يصل بالبريد كل جمعة 16:00 وآخر يوم عمل من الشهر' },
  non_attivo: { it: 'Report PDF: non ancora attivo', ar: 'تقرير PDF غير مفعّل بعد' },
  non_attivo_def: { it: 'Il report automatico non è ancora stato attivato.', ar: 'التقرير التلقائي لم يُفعّل بعد' },
  scarica_sett: { it: 'Scarica report settimana', ar: 'تنزيل تقرير الأسبوع' },
  scarica_mese: { it: 'Scarica report mese', ar: 'تنزيل تقرير الشهر' },
  prova: { it: 'Invia report di prova', ar: 'إرسال تقرير تجريبي' },
} satisfies Record<string, Testo>;

/** Elenco di un numero della Direzione (/direzione/centralino/elenco): titolo = etichetta del numero, sotto la definizione. */
export const DRILL = {
  of_arrivate: { it: 'Offerte arrivate', def: 'Richieste di offerta arrivate nel periodo (telefono, email, WhatsApp…).', ar: 'طلبات عروض الأسعار التي وصلت خلال الفترة' },
  of_in_tempo: { it: 'Offerte inviate in tempo', def: 'Inviate entro la scadenza: 60 minuti per Jennifer, 2 giorni lavorativi per i colleghi.', ar: 'عروض أُرسلت ضمن المهلة' },
  of_in_ritardo: { it: 'Offerte inviate in ritardo', def: 'Inviate dopo la scadenza.', ar: 'عروض أُرسلت بعد انتهاء المهلة' },
  of_da_inviare: { it: 'Offerte ancora da inviare', def: 'Arrivate nel periodo e non ancora inviate al cliente.', ar: 'عروض الفترة التي لم تُرسل بعد' },
  of_da_inviare_scadute: { it: 'Offerte da inviare oltre la scadenza', def: 'Arrivate nel periodo, non ancora inviate e con la scadenza già passata.', ar: 'عروض الفترة التي لم تُرسل وتجاوزت المهلة' },
  of_inviate: { it: 'Offerte inviate', def: 'Arrivate nel periodo e già inviate al cliente (base del tempo medio di invio).', ar: 'عروض الفترة التي أُرسلت (أساس متوسط وقت الإرسال)' },
  of_accettate: { it: 'Offerte accettate', def: 'Accettate dal cliente.', ar: 'عروض قبلها الزبون' },
  of_non_accettate: { it: 'Offerte non accettate', def: 'Non accettate dal cliente, con il motivo.', ar: 'عروض لم يقبلها الزبون مع السبب' },
  of_aperte_da_inviare: { it: 'Offerte ancora da inviare', def: 'Tutte le offerte non ancora inviate al cliente, di qualunque giorno.', ar: 'كل العروض التي لم تُرسل بعد، من أي يوم' },
  of_aperte_scadute: { it: 'Offerte da inviare oltre la scadenza', def: 'Tutte le offerte non ancora inviate con la scadenza già passata, di qualunque giorno.', ar: 'كل العروض التي لم تُرسل وتجاوزت المهلة، من أي يوم' },
  of_aperte_in_attesa: { it: 'Offerte in attesa di risposta', def: 'Offerte inviate: il cliente non ha ancora detto sì o no.', ar: 'عروض أُرسلت والزبون لم يرد بعد' },
  pr_richieste: { it: 'Richieste ricevute', def: 'Chiamate, email e messaggi registrati al centralino nel periodo.', ar: 'كل المكالمات والإيميلات والرسائل المسجلة' },
  pr_chiuse: { it: 'Richieste chiuse', def: 'Richieste completate e chiuse nel periodo.', ar: 'طلبات اكتملت وأُغلقت خلال الفترة' },
} satisfies Record<string, Testo>;
export const ELENCO = {
  periodo: { it: 'Periodo', ar: 'الفترة' },
  tutte_le_date: { it: 'Di qualunque giorno', ar: 'من أي يوم' },
  col_arrivo: { it: 'Data/ora arrivo', ar: 'تاريخ/وقت الوصول' },
  col_cosa: { it: 'Cosa chiede', ar: 'ماذا يطلب' },
  col_canale: { it: 'Canale', ar: 'القناة' },
  col_tipo: { it: 'Tipo', ar: 'النوع' },
  col_esito: { it: 'Esito', ar: 'النتيجة' },
  quanti: { it: 'elementi in elenco', ar: 'عناصر في القائمة' },
  excel: { it: 'Scarica Excel', ar: 'تنزيل إكسل' },
  preparo: { it: 'Preparo…', ar: 'جارٍ التحضير' },
  pronto: { it: 'File Excel pronto', ar: 'ملف إكسل جاهز' },
  vuoto: { it: 'Nessun elemento.', ar: 'لا عناصر' },
  apri: { it: 'Clic su una riga per aprire la pratica completa (storia, email, note, offerta).', ar: 'اضغط على السطر لفتح الملف كاملاً (السجل، الإيميلات، الملاحظات، العرض)' },
  filtro_persona: { it: 'Persona', ar: 'الشخص' },
  filtro_motivo: { it: 'Motivo', ar: 'السبب' },
  filtro_motivo_rit: { it: 'Motivo del ritardo', ar: 'سبب التأخير' },
  filtro_giorno: { it: 'Giorno', ar: 'اليوم' },
  filtro_chi: { it: 'Gestite da', ar: 'يتابعها' },
  scheda: { it: 'Pratica', ar: 'الملف' },
} satisfies Record<string, Testo>;

/** Pagina di dettaglio di un numero (Analisi). */
export const ANALISI = {
  indietro: { it: '← Indietro', ar: 'رجوع' },
  elementi: { it: 'Quanti', ar: 'العدد' },
  conteggio: { it: 'Contati (elenco qui sotto)', ar: 'المحسوبة (القائمة بالأسفل)' },
  su: { it: 'Su quanti', ar: 'من أصل' },
  tempo_richiamo: { it: 'Tempo medio per richiamare', ar: 'متوسط وقت معاودة الاتصال' },
  valore: { it: 'Valore stimato', ar: 'القيمة التقديرية' },
  vuoto: { it: 'Nessun elemento con questi filtri. Prova ad allargare il periodo.', ar: 'لا عناصر بهذه المرشحات' },
  piu_1000: { it: 'Mostrate le prime 1000 righe; il file scaricato le contiene tutte.', ar: 'تظهر أول 1000 سطر فقط' },
  stesso_calcolo: { it: 'Il numero sulla pagina e questo elenco usano lo stesso calcolo.', ar: 'الرقم والقائمة بنفس الحساب' },
  tutti_canali: { it: 'Tutti i canali', ar: 'كل القنوات' },
  tutti_tipi: { it: 'Tutti i tipi', ar: 'كل الأنواع' },
  tutti_dest: { it: 'Tutti i destinatari', ar: 'كل المستلمين' },
  tutti_arg: { it: 'Tutti gli argomenti', ar: 'كل المواضيع' },
  tutti_clienti: { it: 'Tutti i clienti', ar: 'كل الزبائن' },
} satisfies Record<string, Testo>;
export const FILTRI_NOMI: Record<string, string> = { canale: 'Canale', tipo: 'Tipo', stato: 'Cliente', chi: 'Chi chiama', dest: 'Destinatario', arg: 'Argomento', giorno: 'Giorno', ora: 'Ora', dow: 'Giorno della settimana', passo: 'Passo' };

/** Da dove viene un numero (riga «Fonte» sotto la definizione). */
export const FONTI = {
  pratiche: { it: 'richieste registrate nel periodo', ar: 'الطلبات المسجلة في الفترة' },
  aperte: { it: 'richieste ancora aperte adesso, di qualunque giorno', ar: 'الطلبات المفتوحة الآن من أي يوم' },
  chiuse: { it: 'richieste chiuse nel periodo', ar: 'الطلبات المغلقة في الفترة' },
  trasferimenti: { it: 'chiamate passate a un collega nel periodo', ar: 'المكالمات المحوّلة لزميل في الفترة' },
  contatti: { it: 'richieste del periodo + contatti solo informativi', ar: 'طلبات الفترة + اتصالات استفسار فقط' },
  anagrafica: { it: 'richieste «Modifica dati o disdetta» + modifiche alla rubrica clienti', ar: 'طلبات تعديل البيانات + تعديلات دفتر الزبائن' },
} satisfies Record<string, Testo>;

/**
 * Titoli e definizioni dei numeri del registro (src/lib/centralino/registro.ts), in parole semplici.
 * Sostituiscono quelli del registro su tutte le pagine (centralino, Direzione, dettaglio, report).
 */
export const KPI_TESTI: Record<string, Testo> = {
  pratiche: { it: 'Richieste ricevute', def: 'Tutte le richieste registrate nel periodo.', ar: 'كل الطلبات المسجلة في الفترة' },
  aperte_periodo: { it: 'Ancora aperte', def: 'Richieste del periodo non ancora chiuse né annullate.', ar: 'طلبات الفترة غير المغلقة' },
  chiuse: { it: 'Chiuse', def: 'Richieste del periodo completate (annullate escluse).', ar: 'طلبات الفترة المكتملة' },
  sla: { it: 'Tempi rispettati', def: 'Richieste gestite entro il tempo previsto, su quelle già controllabili (chiuse o con il tempo già scaduto).', ar: 'طلبات عولجت ضمن الوقت المحدد' },
  sla_mancati: { it: 'Tempi non rispettati', def: 'Richieste del periodo con almeno un passo fatto oltre il tempo previsto.', ar: 'طلبات تجاوزت الوقت المحدد في خطوة واحدة على الأقل' },
  offerte60: { it: 'Offerte di Jennifer inviate entro 60 minuti', def: 'Offerte fatte da Jennifer e inviate entro 60 minuti dalla richiesta, su quelle già inviate.', ar: 'عروض جنيفر المرسلة خلال 60 دقيقة' },
  interventi1h: { it: 'Interventi tecnici: cliente richiamato entro 1 ora', def: 'Interventi tecnici in cui il cliente è stato informato entro 60 minuti dalla chiamata, su quelli già informati.', ar: 'التدخلات الفنية: إبلاغ الزبون خلال ساعة' },
  sopralluoghi1h: { it: 'Sopralluoghi: cliente richiamato entro 1 ora', def: 'Sopralluoghi in cui il cliente è stato informato entro 60 minuti, su quelli già informati.', ar: 'المعاينات: إبلاغ الزبون خلال ساعة' },
  urgenti: { it: 'Richieste urgenti', def: 'Interventi tecnici e sopralluoghi da fare in giornata.', ar: 'طلبات عاجلة لنفس اليوم' },
  off_richieste: { it: 'Offerte richieste', def: 'Richieste di offerta del periodo (di Jennifer e passate a un collega).', ar: 'طلبات العروض في الفترة' },
  off_inviate: { it: 'Offerte inviate', def: 'Offerte di Jennifer inviate al cliente e offerte passate a un collega con l\'email al cliente fatta.', ar: 'العروض المرسلة' },
  cliente1h: { it: 'Cliente richiamato entro 1 ora', def: 'Interventi tecnici e sopralluoghi in cui il cliente è stato informato entro 60 minuti, su quelli già informati.', ar: 'إبلاغ الزبون خلال ساعة' },
  sla_passo: { it: 'Passo fatto in tempo', def: 'Richieste in cui il passo scelto è stato fatto entro il tempo previsto, su quelle con quel passo già fatto.', ar: 'الخطوة أُنجزت في وقتها' },
  urgenti_giornata: { it: 'Urgenze gestite in giornata', def: 'Richieste urgenti con il cliente informato lo stesso giorno, su tutte le urgenti (annullate escluse).', ar: 'الطلبات العاجلة المعالجة في نفس اليوم' },
  off_piccole: { it: 'Offerte fatte da Jennifer', def: 'Richieste di offerta preparate da Jennifer nel periodo.', ar: 'عروض أعدّتها جنيفر' },
  off_piccole_inviate: { it: 'Offerte di Jennifer inviate', def: 'Offerte fatte da Jennifer già inviate al cliente.', ar: 'عروض جنيفر المرسلة' },
  off_grandi: { it: 'Offerte passate a un collega', def: 'Richieste di offerta passate a un collega nel periodo.', ar: 'عروض محوّلة لزميل' },
  off_grandi_passate: { it: 'Collega avvisato', def: 'Offerte passate a un collega con l\'email o la telefonata al collega fatta, su quelle non annullate.', ar: 'تم إبلاغ الزميل' },
  qual_email: { it: 'Richieste con email al cliente', def: 'Richieste con almeno un\'email inviata al cliente, su tutte (annullate escluse).', ar: 'طلبات أُرسل فيها بريد للزبون' },
  richieste_chiuse: { it: 'Richieste chiuse', def: 'Richieste completate e chiuse nel periodo.', ar: 'طلبات اكتملت وأُغلقت خلال الفترة' },
  annullate: { it: 'Annullate', def: 'Richieste del periodo annullate.', ar: 'طلبات ملغاة' },
  annullate_motivo: { it: 'Annullate con il motivo scritto', def: 'Richieste annullate in cui è scritto il perché, su tutte le annullate.', ar: 'ملغاة مع ذكر السبب' },
  senza_contatti: { it: 'Senza nome o telefono', def: 'Richieste senza il nome di chi chiama oppure senza numero di telefono.', ar: 'طلبات بلا اسم أو هاتف' },
  in_ritardo: { it: 'In ritardo adesso', def: 'Richieste aperte (di qualunque giorno) con il tempo del prossimo passo già scaduto.', ar: 'متأخرة الآن' },
  in_scadenza: { it: 'Scadono entro 1 ora', def: 'Richieste aperte con il tempo del prossimo passo che scade entro 60 minuti.', ar: 'تنتهي مهلتها خلال ساعة' },
  da_seguire: { it: 'Da seguire, ancora aperte', def: 'Interventi tecnici, sopralluoghi, modifiche e informazioni ancora da chiudere.', ar: 'طلبات للمتابعة لم تُغلق بعد' },
  aperte: { it: 'Richieste aperte', def: 'Tutte le richieste ancora aperte in questo momento.', ar: 'كل الطلبات المفتوحة الآن' },
  reg_telefonate: { it: 'Telefonate ricevute', def: 'Richieste arrivate per telefono + telefonate solo informative.', ar: 'المكالمات الهاتفية الواردة' },
  reg_whatsapp: { it: 'Messaggi WhatsApp', def: 'Richieste arrivate su WhatsApp + messaggi solo informativi.', ar: 'رسائل واتساب' },
  reg_email: { it: 'Email ricevute', def: 'Richieste arrivate per email + email solo informative.', ar: 'الرسائل الإلكترونية' },
  reg_tablet: { it: 'Offerte da tablet del tecnico', def: 'Offerte richieste dal tecnico sul tablet, dal cliente.', ar: 'عروض من جهاز الفني' },
  reg_wa_offerte: { it: 'Offerte da WhatsApp', def: 'Offerte richieste su WhatsApp.', ar: 'عروض عبر واتساب' },
  reg_cliente: { it: 'Offerte chieste dal cliente', def: 'Offerte richieste per telefono, email o altro.', ar: 'عروض طلبها الزبون مباشرة' },
  reg_anagrafica: { it: 'Dati clienti aggiornati', def: 'Richieste «Modifica dati o disdetta» + contatti modificati in rubrica (uno al giorno per contatto).', ar: 'تحديث بيانات الزبائن' },
  reg_info: { it: 'Solo informazioni', def: 'Contatti in cui il cliente ha chiesto solo un\'informazione.', ar: 'استفسارات فقط' },
  reg_chiuse: { it: 'Chiuse', def: 'Richieste chiuse nel periodo (annullate escluse).', ar: 'مغلقة' },
  trasferite: { it: 'Chiamate passate a un collega', def: 'Chiamate passate a un responsabile, subito o da richiamare.', ar: 'مكالمات حُوّلت لزميل' },
  trasf_in_tempo: { it: 'Richiamati in tempo', def: 'Clienti richiamati entro l\'ora promessa, su quelli già richiamati o con l\'ora già passata.', ar: 'معاودة الاتصال في الوقت' },
  trasf_da_richiamare: { it: 'Ancora da richiamare', def: 'Clienti da richiamare, non ancora richiamati.', ar: 'لم يُعاد الاتصال بهم بعد' },
  richiami_dovuti: { it: 'Da richiamare adesso', def: 'Clienti da richiamare con l\'ora già passata o entro 60 minuti (esclusi quelli dei colleghi per le offerte).', ar: 'يجب الاتصال بهم الآن' },
  trasf_scadute: { it: 'Non richiamati in tempo', def: 'Clienti non richiamati con l\'ora promessa già passata.', ar: 'لم يُعاد الاتصال في الوقت' },
  trasf_email_ref: { it: 'Con email al collega', def: 'Chiamate passate con l\'email inviata al collega, su tutte.', ar: 'مع بريد للزميل' },
  trasf_email_cli: { it: 'Con email al cliente', def: 'Chiamate passate con l\'email di riepilogo al cliente, su tutte.', ar: 'مع بريد للزبون' },
  comm_in_tempo: { it: 'Offerte: cliente richiamato entro 2 ore', def: 'Clienti richiamati dal collega per un\'offerta entro 2 ore, su quelli già richiamati o con il tempo passato.', ar: 'العروض: الاتصال بالزبون خلال ساعتين' },
  comm_scaduti: { it: 'Offerte: richiami oltre 2 ore', def: 'Clienti non ancora richiamati dal collega per un\'offerta, con le 2 ore già passate.', ar: 'العروض: تجاوز الساعتين' },
  trasf_senza_email: { it: 'Email mancanti', def: 'Chiamate passate senza email al collega, oppure senza email al cliente e senza motivo.', ar: 'رسائل بريد ناقصة' },
};

export const t = (x: Testo) => x.it;
