import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { CATEGORIE, fmtEuro, fmtKm, fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Caricamento, Errore, Pill, useLoad } from '../../ui';

interface Mese { mese: string; km: number; segnalazioni: number; fermi: number; chiuse: number; ore_chiusura: number | null; carburante_eur: number; litri: number; multe: number; multe_eur: number; piani_confermati: number; avvisi: number; avvisi_letti: number }
interface V { targa: string; modello: string; km: number; giorni_uso: number; segnalazioni: number; fermi: number; carburante_eur: number; multe: number }
interface Tc { id: number; nome: string; codice: string; km: number; prese: number; segnalazioni: number; avvisi: number; avvisi_letti: number; minuti_lettura: number | null; multe: number; ultimo_accesso: string | null; sessioni_attive: number; dispositivi: number; bloccato: boolean; ha_pin: boolean }
interface Analisi { da: string; a: string; mesi: Mese[]; veicoli: V[]; tecnici: Tc[]; categorie: Record<string, number>;
  sistema: { veicoli: number; tecnici: number; senza_pin: number; bloccati: number; sessioni_attive: number; dispositivi_push: number; responsabili: number; segnalazioni_aperte: number; modifiche_30gg: number } }

const somma = (l: Mese[], k: keyof Mese) => l.reduce((s, m) => s + Number(m[k] ?? 0), 0);

/** Analisi del sistema per l'amministratore: andamento mensile, veicoli, tecnici, stato del sistema. */
export default function Panoramica() {
  const { t, locale } = useT();
  const [mesi, setMesi] = useState(6);
  const { data, errore, reload } = useLoad(() => rpc<Analisi>('analisi_admin', { p_mesi: mesi }), [mesi]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const M = data.mesi, S = data.sistema;
  const nomeMese = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: 'short' });
  const km = somma(M, 'km'), carb = somma(M, 'carburante_eur'), segn = somma(M, 'segnalazioni'), chiuse = somma(M, 'chiuse');
  const avv = somma(M, 'avvisi'), avvLetti = somma(M, 'avvisi_letti');
  const oreMedie = (() => { const l = M.filter(m => m.ore_chiusura != null); return l.length ? Math.round(l.reduce((s, m) => s + Number(m.ore_chiusura), 0) / l.length) : null; })();
  const eurKm = km > 0 && carb > 0 ? carb / km : null;

  // Punti di attenzione calcolati dai dati, non opinioni
  const attenzione: { s: 'ko' | 'warn'; t: string; to: string }[] = [];
  if (S.senza_pin) attenzione.push({ s: 'warn', t: t('{n} tecnici senza PIN: non possono usare l\'app', { n: S.senza_pin }), to: '/admin/tecnici' });
  if (S.bloccati) attenzione.push({ s: 'ko', t: t('{n} tecnici bloccati per PIN errati', { n: S.bloccati }), to: '/admin/sicurezza' });
  data.tecnici.filter(x => x.ha_pin && x.dispositivi === 0).forEach(x => attenzione.push({ s: 'warn', t: t('{n}: notifiche non attive sul telefono', { n: x.nome }), to: '/admin/sicurezza' }));
  data.tecnici.filter(x => x.avvisi - x.avvisi_letti >= 2).forEach(x => attenzione.push({ s: 'warn', t: t('{n}: {k} avvisi non letti', { n: x.nome, k: x.avvisi - x.avvisi_letti }), to: '/avvisi' }));
  data.veicoli.filter(v => v.fermi >= 2).forEach(v => attenzione.push({ s: 'ko', t: t('{v}: fermo {n} volte nel periodo', { v: v.targa, n: v.fermi }), to: '/flotta' }));
  const cat = Object.entries(data.categorie).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cat.map(c => c[1]));

  return (
    <>
      <div className="page-hero">
        <div><h1>{t('Panoramica del sistema')}</h1>
          <p className="sub">{t('Dal {a} al {b}', { a: new Date(data.da).toLocaleDateString(locale), b: new Date(data.a).toLocaleDateString(locale) })}</p></div>
        <div className="segmented" role="group" aria-label={t('Periodo')}>
          {[3, 6, 12].map(n => <button key={n} className={mesi === n ? 'on' : ''} onClick={() => setMesi(n)}>{t('{n} mesi', { n })}</button>)}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="lbl">{t('Km percorsi')}</div><div className="num">{fmtKm(km)}</div></div>
        <div className="kpi"><div className="lbl">{t('Costo carburante')}</div><div className="num num-sm">{fmtEuro(carb)}</div><div className="sub">{eurKm ? t('{x} €/km', { x: eurKm.toFixed(2) }) : t('nessun dato carta carburante')}</div></div>
        <div className="kpi"><div className="lbl">{t('Segnalazioni')}</div><div className="num">{segn}</div><div className="sub">{t('{n} risolte', { n: chiuse })}</div></div>
        <div className="kpi"><div className="lbl">{t('Tempo medio di risoluzione')}</div><div className="num">{oreMedie == null ? '—' : oreMedie < 48 ? t('{n} h', { n: oreMedie }) : t('{n} gg', { n: Math.round(oreMedie / 24) })}</div></div>
        <div className="kpi"><div className="lbl">{t('Avvisi letti')}</div><div className="num">{avv ? `${Math.round((avvLetti / avv) * 100)}%` : '—'}</div><div className="sub">{t('{a} di {b}', { a: avvLetti, b: avv })}</div></div>
        <div className="kpi"><div className="lbl">{t('Piani confermati')}</div><div className="num">{somma(M, 'piani_confermati')}</div><div className="sub">{t('giorni nel periodo')}</div></div>
      </div>

      <div className="grafici">
        <Barre titolo={t('Km percorsi al mese')} valori={M.map(m => ({ x: nomeMese(m.mese), v: Number(m.km), testo: `${fmtKm(Number(m.km))} km`, breve: fmtKm(Number(m.km)) }))} />
        <Barre titolo={t('Segnalazioni al mese')} valori={M.map(m => ({ x: nomeMese(m.mese), v: Number(m.segnalazioni), testo: t('{n} segnalazioni ({f} fermi)', { n: m.segnalazioni, f: m.fermi }), breve: String(m.segnalazioni) }))} />
        <Barre titolo={t('Carburante al mese (€)')} valori={M.map(m => ({ x: nomeMese(m.mese), v: Number(m.carburante_eur), testo: fmtEuro(Number(m.carburante_eur)), breve: `${Math.round(Number(m.carburante_eur)).toLocaleString('it-IT')} €` }))} />
      </div>

      <div className="two-col">
        <div>
          <div className="section-title">{t('Punti di attenzione')} <span className="meta">{attenzione.length}</span></div>
          {attenzione.length ? <div className="exc-list">{attenzione.map((e, i) => (
            <div key={i} className={`exc ${e.s}`}><div className="stripe" /><div className="t">{e.t}</div><Link className="btn-ghost btn-sm" to={e.to}>{t('Apri')}</Link></div>))}</div>
            : <div className="banner ok">{t('Nessun punto di attenzione.')}</div>}
        </div>
        <div>
          <div className="section-title">{t('Problemi per tipo')}</div>
          <div className="panel">{cat.length ? cat.map(([k, n]) => (
            <div key={k} className="hbar"><span>{t(CATEGORIE[k] ?? k)}</span><div className="hbar-track"><div className="hbar-fill" style={{ width: `${(n / maxCat) * 100}%` }} /></div><b className="mono">{n}</b></div>))
            : <p className="sub">{t('Nessuna segnalazione nel periodo')}</p>}</div>
          <div className="section-title">{t('Sistema')}</div>
          <div className="mini-stat">
            <span>{t('Veicoli attivi')}<b>{S.veicoli}</b></span><span>{t('Tecnici attivi')}<b>{S.tecnici}</b></span>
            <span>{t('Account pannello')}<b>{S.responsabili}</b></span><span>{t('Telefoni connessi')}<b>{S.sessioni_attive}</b></span>
            <span>{t('Dispositivi con notifiche')}<b>{S.dispositivi_push}</b></span><span>{t('Modifiche registrate (30 gg)')}<b>{S.modifiche_30gg}</b></span>
          </div>
        </div>
      </div>

      <div className="section-title">{t('Veicoli nel periodo')}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Veicolo')}</th><th className="num-c">{t('Km')}</th><th className="num-c">{t('Giorni con movimenti')}</th><th className="num-c">{t('Segnalazioni')}</th><th className="num-c">{t('Fermi')}</th><th className="num-c">{t('Carburante')}</th><th className="num-c">{t('Multe')}</th></tr></thead>
        <tbody>{data.veicoli.map(v => (
          <tr key={v.targa}><td><b>{v.targa}</b><div className="sub">{v.modello}</div></td><td className="mono num-c">{fmtKm(Number(v.km))}</td><td className="mono num-c">{v.giorni_uso}</td>
            <td className="mono num-c">{v.segnalazioni}</td><td className="num-c">{v.fermi ? <Pill s="ko">{v.fermi}</Pill> : <span className="mono">0</span>}</td>
            <td className="mono num-c">{fmtEuro(Number(v.carburante_eur))}</td><td className="mono num-c">{v.multe}</td></tr>))}</tbody>
      </table></div>

      <div className="section-title">{t('Tecnici nel periodo')}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Tecnico')}</th><th className="num-c">{t('Km guidati')}</th><th className="num-c">{t('Prese veicolo')}</th><th className="num-c">{t('Segnalazioni')}</th><th className="num-c">{t('Avvisi letti')}</th><th className="num-c">{t('Tempo di lettura')}</th><th className="num-c">{t('Multe')}</th><th>{t('Ultimo accesso')}</th></tr></thead>
        <tbody>{data.tecnici.map(x => (
          <tr key={x.id}><td><b>{x.nome}</b><div className="sub mono">{x.codice}</div></td><td className="mono num-c">{fmtKm(Number(x.km))}</td><td className="mono num-c">{x.prese}</td>
            <td className="mono num-c">{x.segnalazioni}</td><td className="mono num-c">{x.avvisi ? `${x.avvisi_letti}/${x.avvisi}` : '—'}</td>
            <td className="mono num-c">{x.minuti_lettura == null ? '—' : x.minuti_lettura < 60 ? t('{n} min', { n: x.minuti_lettura }) : t('{n} h', { n: Math.round(x.minuti_lettura / 60) })}</td>
            <td className="mono num-c">{x.multe}</td><td className="mono">{x.ultimo_accesso ? fmtOra(x.ultimo_accesso, locale) : '—'}</td></tr>))}</tbody>
      </table></div>
      <p className="hint">{t('Km dai movimenti registrati con il QR (le rettifiche del responsabile non contano). Tempo di lettura: mediana tra invio e apertura di piani e avvisi.')}</p>
    </>
  );
}

/** Barre verticali di una sola serie, con valore al passaggio del mouse e tabella per chi non vede il grafico. */
function Barre({ titolo, valori }: { titolo: string; valori: { x: string; v: number; testo: string; breve: string }[] }) {
  const max = Math.max(1, ...valori.map(d => d.v));
  const W = 320, H = 150, base = 128, gap = 6, bw = (W - gap * (valori.length - 1)) / Math.max(1, valori.length);
  const ultimo = valori.length - 1;
  return (
    <figure className="grafico">
      <figcaption>{titolo}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${titolo}: ${valori.map(d => `${d.x} ${d.testo}`).join(', ')}`}>
        <line x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} className="asse" />
        {valori.map((d, i) => {
          const h = d.v > 0 ? Math.max(2, (d.v / max) * (base - 18)) : 0;
          const x = i * (bw + gap);
          return (
            <g key={i} className="barra">
              <rect x={x} y={0} width={bw} height={base} className="hit"><title>{`${d.x}: ${d.testo}`}</title></rect>
              {h > 0 && <path d={`M${x},${base} v${-(h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${h - 3} z`} className={i === ultimo ? 'fill-ora' : 'fill'} />}
              {(i === ultimo || d.v === max) && d.v > 0 && <text x={x + bw / 2} y={base - h - 5} textAnchor="middle" className="val">{d.breve}</text>}
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" className="ax">{d.x}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
