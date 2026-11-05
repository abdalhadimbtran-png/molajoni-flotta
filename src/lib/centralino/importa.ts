/**
 * Lettura dell'export clienti di Taylor / Ad Hoc: intestazioni riconosciute per nome (spazi, maiuscole e accenti non contano),
 * più telefoni / email nella stessa cella, PEC, «00186 ROMA (RM)» → CAP, comune, provincia; doppioni per Codice.
 */
export const normIntest = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

export type Campo = 'cod_cliente' | 'nome' | 'indirizzo' | 'cap' | 'comune' | 'prov' | 'localita' | 'telefono' | 'cellulare' | 'email' | 'pec' | 'referente' | 'sedi';
export const CAMPI: { k: Campo; l: string; obbl?: boolean; sinonimi: string[] }[] = [
  { k: 'cod_cliente', l: 'Codice', obbl: true, sinonimi: ['codice', 'cod cli', 'cod cliente', 'codice cliente', 'cod', 'cliente codice'] },
  { k: 'nome', l: 'Ragione sociale', obbl: true, sinonimi: ['ragione sociale', 'cliente', 'nome', 'denominazione', 'rag sociale'] },
  { k: 'localita', l: 'Località (CAP, comune, provincia)', sinonimi: ['localita', 'loc', 'loc imp', 'citta', 'comune'] },
  { k: 'indirizzo', l: 'Indirizzo', sinonimi: ['indirizzo', 'via', 'ubicazione'] },
  { k: 'cap', l: 'CAP', sinonimi: ['cap', 'c a p'] },
  { k: 'prov', l: 'Provincia', sinonimi: ['prov', 'provincia'] },
  { k: 'telefono', l: 'Telefono (anche più numeri)', sinonimi: ['telefono', 'tel', 'telefoni', 'telefono 1'] },
  { k: 'cellulare', l: 'Cellulare', sinonimi: ['cellulare', 'cell', 'mobile'] },
  { k: 'email', l: 'Email (anche più indirizzi)', sinonimi: ['email', 'e mail', 'mail', 'indirizzo email'] },
  { k: 'pec', l: 'PEC', sinonimi: ['pec', 'e mail pec', 'posta certificata'] },
  { k: 'referente', l: 'Referente', sinonimi: ['referente', 'contatto', 'persona di riferimento', 'amministratore'] },
  { k: 'sedi', l: 'Sedi / impianti', sinonimi: ['sedi', 'impianti', 'imp num/serie', 'impianto'] },
];

/** Colonna del file → campo (prima la mappa salvata, poi i sinonimi). Una colonna va su un solo campo. */
export function riconosci(intest: string[], salvata: Record<string, string> = {}): Record<Campo, string> {
  const usate = new Set<string>(); const m = {} as Record<Campo, string>;
  for (const c of CAMPI) {
    const s = salvata[c.k];
    const h = s && intest.includes(s) && !usate.has(s) ? s : intest.find(x => !usate.has(x) && c.sinonimi.includes(normIntest(x)));
    m[c.k] = h ?? ''; if (h) usate.add(h);
  }
  // «Comune» da solo senza «Località»: va nel comune
  if (!m.localita) { const h = intest.find(x => !usate.has(x) && ['comune', 'citta'].includes(normIntest(x))); if (h) m.comune = h; }
  return m;
}

const cifre = (s: string) => s.replace(/[^\d+]/g, '');
/** Più numeri in una cella («06 1234567 / 333 1234567; 06 7654321»): fissi → telefono, che iniziano con 3 → cellulare, il resto nelle note. */
export function dividiTelefoni(...celle: unknown[]): { telefono: string | null; cellulare: string | null; altri: string[] } {
  const tutti = celle.flatMap(c => String(c ?? '').split(/\s*[/;,|]\s*|\s+-\s+|\s{2,}/)).map(x => x.trim()).filter(x => cifre(x).replace(/^\+?(0039|39)?/, '').length >= 6);
  const pul = [...new Set(tutti.map(cifre))];
  const mobile = (n: string) => /^(\+39|0039)?3\d{8,9}$/.test(n);
  const cel = pul.find(mobile) ?? null, tel = pul.find(n => !mobile(n)) ?? null;
  return { telefono: tel, cellulare: cel, altri: pul.filter(n => n !== tel && n !== cel) };
}

const reEmail = /[^\s,;/<>()"']+@[^\s,;/<>()"']+\.[a-z]{2,}/gi;
/** Più indirizzi in una cella: il primo «normale» → email, quello PEC (pec. o @pec nel dominio) → pec, gli altri nelle note. */
export function dividiEmail(...celle: unknown[]): { email: string | null; pec: string | null; altri: string[] } {
  const l = [...new Set(celle.flatMap(c => String(c ?? '').match(reEmail) ?? []).map(x => x.toLowerCase().replace(/[.]+$/, '')))];
  const isPec = (e: string) => /@(pec\.|.*\.pec\.|legalmail\.|.*pec)/.test(e) || e.split('@')[1]?.startsWith('pec');
  const pec = l.find(isPec) ?? null, email = l.find(e => !isPec(e)) ?? null;
  return { email, pec, altri: l.filter(e => e !== email && e !== pec) };
}

/** «00186 ROMA (RM)», «Roma RM», «00040 Monte Porzio Catone» → CAP, comune, provincia. */
export function dividiLocalita(s: unknown): { cap: string | null; comune: string | null; prov: string | null } {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { cap: null, comune: null, prov: null };
  const cap = t.match(/\b(\d{5})\b/)?.[1] ?? null; if (cap) t = t.replace(cap, '').trim();
  let prov: string | null = null;
  const p = t.match(/\(([A-Za-z]{2})\)\s*$/) ?? t.match(/[\s-]+([A-Z]{2})\s*$/);
  if (p) { prov = p[1].toUpperCase(); t = t.slice(0, p.index).trim(); }
  t = t.replace(/^[-,\s]+|[-,\s]+$/g, '');
  const comune = t ? t.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, x => x.toUpperCase()) : null;
  return { cap, comune, prov };
}

export interface RigaCliente { cod_cliente: string; nome: string; indirizzo?: string; cap?: string | null; comune?: string | null; prov?: string | null; telefono?: string | null; cellulare?: string | null; email?: string | null; pec?: string | null; referente?: string; sedi?: string[] }
export interface Extra { cod_cliente: string; cliente_nome: string; telefono?: string; email?: string; note: string; ruolo: string }

/** Righe del file → righe per l'RPC + contatti in più (numeri ed email oltre il primo). Doppioni per Codice: vince l'ultima riga. */
export function preparaRighe(righe: Record<string, unknown>[], m: Record<Campo, string>) {
  const per = new Map<string, RigaCliente>(); const extra: Extra[] = []; let doppi = 0;
  const v = (r: Record<string, unknown>, k: Campo) => (m[k] ? String(r[m[k]] ?? '').trim() : '');
  for (const r of righe) {
    const cod = v(r, 'cod_cliente'); if (!cod && !v(r, 'nome')) continue;
    const loc = dividiLocalita(v(r, 'localita'));
    const tel = dividiTelefoni(v(r, 'telefono'), v(r, 'cellulare'));
    const em = dividiEmail(v(r, 'email'), v(r, 'pec'));
    if (per.has(cod)) doppi++;
    per.set(cod, {
      cod_cliente: cod, nome: v(r, 'nome'), indirizzo: v(r, 'indirizzo') || undefined,
      cap: v(r, 'cap') || loc.cap, comune: v(r, 'comune') || loc.comune, prov: v(r, 'prov') || loc.prov,
      telefono: tel.telefono, cellulare: tel.cellulare, email: em.email, pec: em.pec, referente: v(r, 'referente') || undefined,
      sedi: m.sedi ? v(r, 'sedi').split(/[;,|]/).map(x => x.trim()).filter(Boolean) : undefined,
    });
    for (const n of tel.altri) extra.push({ cod_cliente: cod, cliente_nome: v(r, 'nome'), telefono: n, note: 'Altro numero dal file Taylor', ruolo: 'altro numero' });
    for (const e of em.altri) extra.push({ cod_cliente: cod, cliente_nome: v(r, 'nome'), email: e, note: 'Altra email dal file Taylor', ruolo: 'altra email' });
  }
  return { righe: [...per.values()], extra, doppi };
}

export const aBlocchi = <T,>(l: T[], n = 500): T[][] => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
