import { useEffect, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { toast } from '../ui';
import { REPORT } from '../lib/centralino/testiDirezione';

type Stato = { attivo: boolean; email: string | null; ultimo_settimana: string | null; ultimo_mese: string | null; admin: boolean };

/** Nome del file scaricato: quello inviato dalla funzione (Content-Disposition non è leggibile con invoke), ricostruito qui. */
export function nomeFile(tipo: 'settimana' | 'mese', oggi = new Date()): string {
  const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const g = new Date(Date.UTC(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()));
  if (tipo === 'mese') { const m = new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1)); return `Report_Direzione_${MESI[m.getUTCMonth()]}_${m.getUTCFullYear()}.pdf`; }
  // lunedì della settimana in corso → settimana ISO
  const dow = (g.getUTCDay() + 6) % 7; const lun = new Date(g); lun.setUTCDate(g.getUTCDate() - dow);
  const gio = new Date(lun); gio.setUTCDate(lun.getUTCDate() + 3);
  const anno = gio.getUTCFullYear(), w1 = new Date(Date.UTC(anno, 0, 4));
  const sett = 1 + Math.round(((gio.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
  return `Report_Direzione_Settimana_${anno}-W${String(sett).padStart(2, '0')}.pdf`;
}

/**
 * Report Direzione settimanale e mensile (PDF): iscrizione all'invio automatico (venerdì 16:00, giovedì se festivo;
 * ultimo giorno lavorativo del mese 16:00), download su richiesta del periodo in corso fino ad adesso
 * e, solo per l'admin, «Invia report di prova» (settimana in corso).
 * Sostituisce il riepilogo giornaliero delle 18:00.
 */
export default function Digest() {
  const [s, setS] = useState<Stato | null | 'non_attivo'>(null);
  const [lav, setLav] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc('report_direzione_stato').then(({ data, error }) => setS(error ? 'non_attivo' : (data as Stato)));
  }, []);
  if (s === null) return null;
  if (s === 'non_attivo') return <span className="dz-digest off" title={REPORT.non_attivo_def.it}>{REPORT.non_attivo.it}</span>;
  const st = s;

  async function cambia() {
    const n = !st.attivo;
    const { error } = await supabase.rpc('report_direzione_imposta', { p_attivo: n });
    if (error) { toast(testoErrore(error)); return; }
    setS({ ...st, attivo: n }); toast(n ? `Report settimanale e mensile a ${st.email ?? 'te'}` : 'Report automatico disattivato');
  }
  async function scarica(tipo: 'settimana' | 'mese') {
    setLav(tipo);
    try {
      const { data, error } = await supabase.functions.invoke('report-direzione', { body: { azione: 'scarica', tipo } });
      if (error || !(data instanceof Blob)) { toast(error ? testoErrore(error) : 'Report non disponibile'); return; }
      const url = URL.createObjectURL(data), a = document.createElement('a');
      a.href = url; a.download = nomeFile(tipo); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setLav(null); }
  }
  async function prova() {
    setLav('prova');
    try {
      const { data, error } = await supabase.functions.invoke('report-direzione', { body: { azione: 'prova', tipo: 'settimana' } });
      const d = data as { ok?: boolean; esito?: { errore?: string } } | null;
      if (error || !d?.ok) { toast(error ? testoErrore(error) : `Invio non riuscito: ${d?.esito?.errore ?? 'errore sconosciuto'}`); return; }
      toast(`Report di prova inviato a ${st.email}`);
    } finally { setLav(null); }
  }
  return (
    <>
      <label className="dz-digest" title={REPORT.auto_def.it}>
        <input type="checkbox" role="switch" checked={st.attivo} onChange={cambia} /> {REPORT.auto.it}
      </label>
      <button className="btn-ghost btn-sm" disabled={!!lav} onClick={() => scarica('settimana')}>{lav === 'settimana' ? 'Preparo…' : REPORT.scarica_sett.it}</button>
      <button className="btn-ghost btn-sm" disabled={!!lav} onClick={() => scarica('mese')}>{lav === 'mese' ? 'Preparo…' : REPORT.scarica_mese.it}</button>
      {st.admin && <button className="btn-ghost btn-sm" disabled={!!lav} onClick={prova} title={`Invia subito il report della settimana in corso a ${st.email ?? 'te'}`}>{lav === 'prova' ? 'Invio…' : REPORT.prova.it}</button>}
    </>
  );
}
