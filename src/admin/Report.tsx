import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { fmtEuro, fmtKm, oggiISO } from '../lib/format';
import { useT } from '../lib/i18n';
import { Caricamento, Errore, Targa, useLoad } from '../ui';

interface Riga { veicolo_id: number; targa: string; modello: string; km: number; giorni_assegnato: number; giorni_fermo: number; segnalazioni: number; carburante_eur: number; litri: number; multe: number; multe_eur: number }

export default function Report() {
  const { t, locale } = useT();
  const [mese, setMese] = useState(oggiISO().slice(0, 7));
  const [a, m] = mese.split('-').map(Number);
  const { data, errore, reload } = useLoad(() => rpc<{ righe: Riga[] }>('report_mese', { p_anno: a, p_mese: m }), [a, m]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const righe = data?.righe ?? [];
  const tot = righe.reduce((s, r) => ({ km: s.km + r.km, carb: s.carb + Number(r.carburante_eur), fermo: s.fermo + Number(r.giorni_fermo), segn: s.segn + r.segnalazioni, multe: s.multe + r.multe, multeEur: s.multeEur + Number(r.multe_eur) }),
    { km: 0, carb: 0, fermo: 0, segn: 0, multe: 0, multeEur: 0 });
  const eurKm = (e: number, k: number) => (k > 0 && e > 0 ? (e / k).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3 }) : '—');
  const nomeMese = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  function esporta() {
    const sep = ';';
    const testa = ['Targa', 'Modello', 'Km percorsi', 'Giorni assegnato', 'Giorni fermo', 'Segnalazioni', 'Carburante EUR', 'Litri', 'EUR/km', 'Multe', 'Multe EUR'];
    const corpo = righe.map(r => [r.targa, r.modello, r.km, r.giorni_assegnato, String(r.giorni_fermo).replace('.', ','), r.segnalazioni, String(r.carburante_eur).replace('.', ','),
      String(r.litri).replace('.', ','), r.km > 0 && r.carburante_eur > 0 ? (r.carburante_eur / r.km).toFixed(3).replace('.', ',') : '', r.multe, String(r.multe_eur).replace('.', ',')].join(sep));
    const blob = new Blob(['﻿' + [testa.join(sep), ...corpo].join('\n')], { type: 'text/csv;charset=utf-8' });
    const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `report-flotta-${mese}.csv`; l.click(); URL.revokeObjectURL(u);
  }

  return (
    <>
      <div className="page-head">
        <div><h1 className="report-title">{t('Report flotta')} · {nomeMese}</h1><div className="sub">{t('Dati dal registro movimenti, segnalazioni, carburante importato e multe.')}</div></div>
        <div className="row-flex no-print">
          <div className="field"><label htmlFor="mese">{t('Mese')}</label><input id="mese" type="month" value={mese} onChange={e => e.target.value && setMese(e.target.value)} /></div>
          <button className="btn-ghost" onClick={esporta} disabled={!righe.length}>{t('Esporta CSV')}</button>
          <button className="btn" onClick={() => window.print()}>{t('Stampa')}</button>
        </div>
      </div>
      {!data ? <Caricamento /> : <>
        <div className="kpis">
          <div className="kpi"><div className="num">{fmtKm(tot.km)}</div><div className="lbl">{t('Km percorsi')}</div></div>
          <div className="kpi"><div className="num">{fmtEuro(tot.carb)}</div><div className="lbl">{t('Carburante')} · {eurKm(tot.carb, tot.km)}/km</div></div>
          <div className={`kpi ${tot.fermo > 0 ? 'ko' : 'ok'}`}><div className="num">{tot.fermo.toLocaleString('it-IT')}</div><div className="lbl">{t('Giorni veicolo fermo')}</div></div>
          <div className="kpi warn"><div className="num">{tot.segn}</div><div className="lbl">{t('Segnalazioni')}</div></div>
          <div className={`kpi ${tot.multe ? 'ko' : 'ok'}`}><div className="num">{tot.multe}</div><div className="lbl">{t('Multe')} · {fmtEuro(tot.multeEur)}</div></div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Veicolo')}</th><th>{t('Km percorsi')}</th><th>{t('Giorni assegnato')}</th><th>{t('Giorni fermo')}</th><th>{t('Segnalazioni')}</th><th>{t('Carburante')}</th><th>{t('€/km')}</th><th>{t('Multe')}</th></tr></thead>
          <tbody>{righe.map(r => (
            <tr key={r.veicolo_id}>
              <td><Targa t={r.targa} /><div className="sub" style={{ marginTop: 3 }}>{r.modello}</div></td>
              <td className="mono">{fmtKm(r.km)}</td><td className="mono">{r.giorni_assegnato}</td>
              <td className="mono">{Number(r.giorni_fermo).toLocaleString('it-IT')}</td><td className="mono">{r.segnalazioni}</td>
              <td className="mono">{fmtEuro(r.carburante_eur)}{r.litri > 0 && <div className="sub">{Number(r.litri).toLocaleString('it-IT')} l</div>}</td>
              <td className="mono">{eurKm(Number(r.carburante_eur), r.km)}</td>
              <td className="mono">{r.multe}{r.multe > 0 && <div className="sub">{fmtEuro(r.multe_eur)}</div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="hint">{t('Km percorsi = ultima lettura del mese meno ultima lettura del mese precedente. Giorni fermo = durata delle segnalazioni "veicolo fermo" nel mese.')}</p>
      </>}
    </>
  );
}
