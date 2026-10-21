import { fmtGiorno } from '../lib/format';
import { useT } from '../lib/i18n';
import { Pill } from '../ui';

/** Presenza di un tecnico in un giorno, come la vede il pannello flotta. Non contiene mai il tipo di assenza. */
export interface Presenza { tipo: 'intera' | 'mattina' | 'pomeriggio' | 'mezza' | 'ore'; dalle?: string; alle?: string; rientro?: string; possibile?: boolean }

/** Breve «mer 14» per il rientro. */
function giornoBreve(d: string, locale: string) {
  const [y, m, g] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, g, 12)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Pill sotto il nome del tecnico nel piano (UX § 3.4). */
export default function PillPresenza({ assenza }: { assenza: Presenza | null }) {
  const { t, locale } = useT();
  if (!assenza) return null;
  if (assenza.possibile) return (
    <div className="presenza"><Pill s="warn">{t('Possibile assenza')}</Pill><span className="sub">{t('in attesa di risposta')}</span></div>
  );
  if (assenza.tipo === 'ore') return (
    <div className="presenza"><Pill s="info">{assenza.dalle && assenza.alle ? t('Non disponibile {a}–{b}', { a: assenza.dalle, b: assenza.alle }) : t('Non disponibile per alcune ore')}</Pill></div>
  );
  if (assenza.tipo !== 'intera') return (
    <div className="presenza"><Pill s="na">{assenza.tipo === 'mattina' ? t('Assente la mattina') : assenza.tipo === 'pomeriggio' ? t('Assente il pomeriggio') : t('Assente mezza giornata')}</Pill></div>
  );
  return (
    <div className="presenza"><Pill s="na">{t('Assente')}</Pill>
      {assenza.rientro && <span className="sub" title={fmtGiorno(assenza.rientro, locale)}>{t('rientra {d}', { d: giornoBreve(assenza.rientro, locale) })}</span>}</div>
  );
}

/**
 * Dalle etichette che arrivano da piano_giorno (note_assenza: «Assente 14:00-18:00», «Assente (mezza giornata)»)
 * ricava la presenza da mostrare. Le etichette sono già senza tipo di assenza (migrazione 0014).
 */
export function presenzaDaNota(nota: string): Presenza {
  const m = nota.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (m) return { tipo: 'ore', dalle: m[1], alle: m[2] };
  if (/mattin/i.test(nota)) return { tipo: 'mattina' };
  if (/pomerig/i.test(nota)) return { tipo: 'pomeriggio' };
  return { tipo: 'mezza' };
}
