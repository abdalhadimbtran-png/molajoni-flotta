/**
 * Pulizia degli indirizzi esportati da Taylor (colonna "Ubicazione").
 * Logica pura, senza rete: testata in indirizzo.test.ts.
 * Esempi: "V.LE TIZIANO 19" → Viale Tiziano 19; "PIAZZA RONDANINI -Piano 2 interno 4a 45" → Piazza Rondanini 45 + "Accesso: Piano 2, interno 4a".
 */

export interface IndirizzoPulito {
  via: string;            // es. "Viale Tiziano"
  civico: string | null;  // come scritto, es. "25/B", "20-22"
  civicoGeo: string | null; // per la ricerca: primo numero + eventuale lettera, es. "25/B", "20"
  accesso: string[];      // es. ["Piano 2", "interno 4a", "scala B"]
  altro: string[];        // parti non riconosciute (secondo indirizzo, km, località…)
  normalizzato: string;   // "Viale Tiziano 19"
}

const ABBR: [RegExp, string][] = [
  [/^V\.?\s*LE\b\.?\s*/i, 'Viale '],
  [/^V\.le(?=[A-Z])/, 'Viale '],
  [/^V\.?\s*LO\b\.?\s*/i, 'Vicolo '],
  [/^P\.?\s*ZZ?A\b\.?\s*/i, 'Piazza '],
  [/^P\.?\s*ZZ?LE\b\.?\s*|^P\.?\s*LE\b\.?\s*/i, 'Piazzale '],
  [/^L\.?\s*GO\b\.?\s*/i, 'Largo '],
  [/^C\.?\s*SO\b\.?\s*/i, 'Corso '],
  [/^CIRC\.?\s*NE\b\.?\s*/i, 'Circonvallazione '],
  [/^L\.?\s*RE\b\.?\s*|^LUNGOT\.\s*/i, 'Lungotevere '],
  [/^STR\.\s*/i, 'Strada '],
  [/^SP\.?\s*(?=\d)/i, 'SP '],
  [/^V\.\s*/i, 'Via '],
  [/^VIA(?=[A-Z]\.)/i, 'Via '],
];

const MINUSCOLE = new Set(['di', 'de', 'del', 'della', 'dei', 'degli', 'delle', 'dello', 'da', 'dal', 'dalla', 'e', 'in', 'a', 'al', 'alla', 'ai', 'agli', 'sul', 'sulla']);
const ROMANI = /^(?=[IVXLC]+$)C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/** "VIA DELLA CROCE" → "Via della Croce"; numeri romani in maiuscolo; apostrofi gestiti. */
export function maiuscoleItaliane(s: string): string {
  return s.toLowerCase().split(/(\s+|-|\/)/).map((w, i) => {
    if (!w.trim() || w === '-' || w === '/') return w;
    if (ROMANI.test(w.toUpperCase()) && w.length <= 5 && !/^(di|mi|vi|li|ci|dic|mix)$/i.test(w)) return w.toUpperCase();
    if (i > 0 && MINUSCOLE.has(w)) return w;
    if (i > 0 && /^(dell|dall|nell|sull|all|d)'/.test(w)) return w.replace(/'(\p{L})/u, (_m, c: string) => "'" + c.toUpperCase());
    return w.replace(/(^|['.])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  }).join('');
}

const pulisciSpazi = (s: string) => s.replace(/,(?=[^\s\d])|,(?=\d)(?<=[a-z],)/gi, ', ').replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').trim();

/** Toglie e raccoglie piano / interno / scala / palazzina / stanza / ufficio / c/o / parentesi. */
function estraiAccesso(s0: string): { resto: string; accesso: string[]; altro: string[] } {
  let s = ' ' + s0 + ' ';
  const accesso: string[] = [];
  const altro: string[] = [];
  const prendi = (re: RegExp, f: (m: RegExpExecArray) => string | null, dove: string[] = accesso) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const v = f(m); if (v) dove.push(v);
      s = s.slice(0, m.index) + ' - ' + s.slice(m.index + m[0].length);
      re.lastIndex = 0;
    }
  };
  // c/o qualcuno (fino alla virgola)
  prendi(/\bc\/o\s+[^,]+/gi, m => m[0].trim().replace(/^c\/o/i, 'c/o'), altro);
  // parentesi: (LOC. CALA NEVE), (Z.I.), (PEDONALE)
  prendi(/\(([^)]*)\)?/g, m => pulisciSpazi(m[1] ?? '') || null, altro);
  // "4^PIANO", "II PIANO", "I^ PIANO", "5^ p."
  prendi(/[\s\-](\d{1,2}|[IVX]{1,4})\s*\^?\s*(?:piano|p\.)(?=[\s,\-]|$)/gi, m => `Piano ${m[1].toUpperCase()}`);
  // "piano 2", "PIANO3^", "p.t.", "p.4", "piano terra"
  prendi(/\b(?:piano|p\.)\s*(terra|t\b\.?|\d{1,2}(?!\d)|[IVX]{1,4}\b)\s*\^?/gi, m => `Piano ${/^t/i.test(m[1]) ? 'terra' : m[1].toUpperCase()}`);
  // "interno 4a", "int.3", "INT  2", "int. 14-5", "INT 11", "int.9 e"
  prendi(/\b(?:interno|int)\b\.?\s*([0-9]+[a-z]?(?:-\d+(?!\s*\^))?|[a-z]\b)?/gi, m => m[1] ? `interno ${m[1].replace(/\s+/g, '')}` : 'interno');
  // "SCALA D", "Sc C", "SC.E", "SCALE E-F", "scala B/", "SCA" (scala A)
  prendi(/\bscal[ae]\s*([a-z](?:\s*-\s*[a-z])?)?\b|\bsc\.?\s*([a-z])\b|\bsc([a-h])\b/gi, m => {
    const v = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, '').toUpperCase();
    return v ? `scala ${v}` : 'scala';
  });
  // "PAL. SX", "PAL. EPUA1", "palazzina B"
  prendi(/\b(?:pal\.|palazzina)\s*([a-z0-9]+)?/gi, m => `palazzina ${m[1] ?? ''}`.trim());
  // "ST. 521", "STANZA 535"
  prendi(/\b(?:stanza|st\.)\s*([a-z0-9]+)/gi, m => `stanza ${m[1].toUpperCase()}`);
  // "UFF" / "UFFICIO"
  prendi(/\buff(?:icio|\.)?(?=[\s,\-]|$)/gi, () => 'ufficio');
  return { resto: s, accesso, altro };
}

/**
 * Pulisce un indirizzo di Taylor. Il civico può essere in fondo, dopo le parti d'accesso
 * ("VIA DEI LEUTARI - piano 1 interno 1 28" → Via dei Leutari 28).
 */
export function pulisciIndirizzo(grezzo: string | null | undefined): IndirizzoPulito {
  let s = String(grezzo ?? '').replace(/\u00a0/g, ' ').replace(/[?*;"]/g, ' ').trim();
  // suffisso CAP "-00034" o "-00040 0N9"
  s = s.replace(/\s*-\s*\d{5}(?:\s+\w{1,4})?\s*$/, '').replace(/\s-\s*\d{5}\b/g, ' ');
  const { resto, accesso, altro } = estraiAccesso(s);
  s = resto;
  // km di strade extraurbane
  s = s.replace(/\bkm\.?\s*(\d+(?:[.,]\d+)?)/gi, (_m, k: string) => { altro.push(`km ${k}`); return ' - '; });
  // snc = senza numero civico
  s = s.replace(/\bsnc\b/gi, ' ').replace(/\^/g, ' ');
  // n. / nr. davanti al civico
  s = s.replace(/\b(?:n|nr|num)\.\s*(?=\d)|\bnr\s+(?=\d)|\bN\.(?=\d)/gi, ' ');
  s = pulisciSpazi(s.replace(/\s*-\s*/g, ' - ')).replace(/^[\s,\-]+|[\s,\-/]+$/g, '');
  // abbreviazioni del tipo di strada
  for (const [re, sost] of ABBR) if (re.test(s)) { s = s.replace(re, sost); break; }
  // "G.AMENDOLA" → "G. AMENDOLA"
  s = s.replace(/\b([A-Z])\.(?=[A-Z]{2})/gi, '$1. ');

  // secondo indirizzo dopo " - " o "/" con un tipo di strada: "VIA BECHI 1 - VIA CARONCINI ,6"
  const sec = s.match(/\s(?:-|\/)\s*((?:via|v\.|viale|v\.le|piazza|p\.zza|largo|l\.go|corso|vicolo)\b.*)$/i);
  if (sec && sec.index! > 3) { altro.push(pulisciSpazi(sec[1])); s = s.slice(0, sec.index).trim(); }

  // civico: primo numero non seguito da una parola (≥3 lettere) che continua il nome ("VIA XXI APRILE", "VIA 4 NOVEMBRE 12")
  const reNum = /(\d+)(\s*\/\s*[A-Z0-9]{1,3}\b|\s?[A-Z]\b(?!\.)(?!\s*\d)|)((?:\s*[-/,]\s*\d+[A-Z]?(?:\s*\/\s*[A-Z])?)*)/gi;
  let m: RegExpExecArray | null;
  let civ: RegExpExecArray | null = null;
  while ((m = reNum.exec(s))) {
    const prima = s.slice(0, m.index);
    const dopo = s.slice(m.index + m[0].length);
    if (!/[a-z]{2}/i.test(prima)) continue;                 // il numero è il nome (es. "SP 156")
    if (/^\s+[a-z]{3,}/i.test(dopo) && !/^\s+(e|ed)\b/i.test(dopo)) {
      // numero dentro il nome ("4 NOVEMBRE") salvo che il resto sia solo "di qualcosa" senza altri numeri
      if (/\d/.test(dopo)) continue;
    }
    civ = m; break;
  }
  let via = s, civico: string | null = null, civicoGeo: string | null = null;
  if (civ) {
    via = s.slice(0, civ.index);
    const dopo = s.slice(civ.index + civ[0].length);
    const lettera = civ[2].replace(/\s+/g, '').replace(/^\//, '').toUpperCase();
    civicoGeo = civ[1] + (lettera ? `/${lettera}` : '');
    civico = pulisciSpazi(civ[0]).replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ', ').replace(/\s([A-Z])$/i, '/$1').toUpperCase();
    const r = pulisciSpazi(dopo.replace(/^[\s,\-/.]+|[\s,\-/.]+$/g, ''));
    if (r && /[a-z0-9]/i.test(r)) altro.push(r);
  }
  via = pulisciSpazi(via.replace(/[\s,\-/.]+$/g, '').replace(/^[\s,\-]+/, ''));
  via = maiuscoleItaliane(via).replace(/\bS\.\s*/g, 'S. ');
  const pulitoAltro = altro.map(pulisciSpazi).filter(x => x && /[a-z0-9]/i.test(x)).map(x => maiuscoleItaliane(x));
  const acc = accesso.map(pulisciSpazi).filter(Boolean);
  return { via, civico, civicoGeo, accesso: acc, altro: pulitoAltro, normalizzato: civico ? `${via} ${civico}` : via };
}

/** Testo per il campo note: "Accesso: Piano 2, interno 4a · Altro: Via Caroncini 6". */
export function noteIndirizzo(p: IndirizzoPulito): string | null {
  const parti: string[] = [];
  if (p.accesso.length) parti.push(`Accesso: ${p.accesso.join(', ')}`);
  if (p.altro.length) parti.push(`Altro: ${p.altro.join(', ')}`);
  return parti.length ? parti.join(' · ') : null;
}

/** Variante senza iniziali puntate ("Via G. Amendola" → "Via Amendola") per un secondo tentativo. */
export function senzaIniziali(via: string): string {
  return pulisciSpazi(via.replace(/(^|\s)(?:[A-Z]\.\s*)+(?=[A-Z][a-z])/g, '$1'));
}

/** Chiave di confronto per comuni/città: minuscole, senza accenti né punteggiatura. */
export function chiaveLuogo(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
