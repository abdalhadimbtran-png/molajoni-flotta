import { useEffect, useMemo, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { Banner, toast } from '../ui';
import { CATALOGO, GRUPPI_REPORT, numerica, testoCella, type Report, type Riga } from './report/catalogo';

/** Centro report: scegli il report e il periodo, guarda l'anteprima, esporta in Excel o PDF. */
const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
function oggiRoma() { const [y, m, d] = iso(new Date()).split('-').map(Number); return new Date(y, m - 1, d); }
const piu = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const lunedi = (d: Date) => piu(d, -((d.getDay() + 6) % 7));
type Preset = 'settimana' | 'settimana_scorsa' | 'mese' | 'mese_scorso' | '30' | 'anno' | 'personalizzato';
const PRESET: [Preset, string][] = [['settimana', 'Questa settimana'], ['settimana_scorsa', 'Settimana scorsa'], ['mese', 'Questo mese'], ['mese_scorso', 'Mese scorso'], ['30', 'Ultimi 30 giorni'], ['anno', "Quest'anno"], ['personalizzato', 'Personalizzato']];
function intervallo(p: Preset): [string, string] {
  const o = oggiRoma();
  switch (p) {
    case 'settimana': return [iso(lunedi(o)), iso(piu(lunedi(o), 6))];
    case 'settimana_scorsa': return [iso(piu(lunedi(o), -7)), iso(piu(lunedi(o), -1))];
    case 'mese': return [iso(new Date(o.getFullYear(), o.getMonth(), 1)), iso(new Date(o.getFullYear(), o.getMonth() + 1, 0))];
    case 'mese_scorso': return [iso(new Date(o.getFullYear(), o.getMonth() - 1, 1)), iso(new Date(o.getFullYear(), o.getMonth(), 0))];
    case '30': return [iso(piu(o, -29)), iso(o)];
    case 'anno': return [iso(new Date(o.getFullYear(), 0, 1)), iso(new Date(o.getFullYear(), 11, 31))];
    default: return [iso(new Date(o.getFullYear(), o.getMonth(), 1)), iso(o)];
  }
}
const it = (d: string) => testoCella(d, 'data');
const PROPRIETA: Record<string, string> = { proprieta: 'Di proprietà', noleggio: 'Noleggio', leasing: 'Leasing' };
const normalizza = (r: Riga): Riga => ('proprieta' in r ? { ...r, proprieta: PROPRIETA[String(r.proprieta)] ?? r.proprieta } : r);

export default function Report() {
  const { t, tm } = useT();
  const [sel, setSel] = useState<Report>(CATALOGO[0]);
  const [preset, setPreset] = useState<Preset>('mese');
  const [da, setDa] = useState(() => intervallo('mese')[0]);
  const [a, setA] = useState(() => intervallo('mese')[1]);
  const [entro, setEntro] = useState(() => iso(piu(oggiRoma(), 60)));
  const [veicolo, setVeicolo] = useState(''); const [tecnico, setTecnico] = useState('');
  const [opz, setOpz] = useState<{ veicoli: { id: number; targa: string; marca_modello: string }[]; tecnici: { id: number; nome: string; cognome: string }[] }>({ veicoli: [], tecnici: [] });
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [esporto, setEsporto] = useState<'' | 'xlsx' | 'pdf'>('');
  const [autore, setAutore] = useState('');

  useEffect(() => {
    Promise.all([
      supabase.from('veicoli').select('id,targa,marca_modello').eq('dismesso', false).order('targa'),
      supabase.from('tecnici').select('id,nome,cognome').eq('attivo', true).order('cognome'),
      supabase.auth.getUser(),
    ]).then(async ([v, tc, u]) => {
      setOpz({ veicoli: v.data ?? [], tecnici: tc.data ?? [] });
      if (u.data.user) { const r = await supabase.from('responsabili').select('nome').eq('user_id', u.data.user.id).maybeSingle(); setAutore(r.data?.nome || u.data.user.email || ''); }
    });
  }, []);

  const [pDa, pA] = sel.periodo === 'intervallo' ? [da, a] : sel.periodo === 'scadenza' ? [iso(oggiRoma()), entro] : [iso(oggiRoma()), iso(oggiRoma())];
  const fV = sel.filtri.veicolo && veicolo ? Number(veicolo) : null;
  const fT = sel.filtri.tecnico && tecnico ? Number(tecnico) : null;
  useEffect(() => {
    let attivo = true; setRighe(null); setErr(null);
    rpc<{ righe: Riga[] }>('report_dati', { p_tipo: sel.id, p_da: pDa, p_a: pA, p_veicolo: fV, p_tecnico: fT })
      .then(r => { if (attivo) setRighe(r.righe.map(normalizza)); }).catch(e => { if (attivo) setErr(testoErrore(e)); });
    return () => { attivo = false; };
  }, [sel.id, pDa, pA, fV, fT]);

  function scegliPreset(p: Preset) { setPreset(p); if (p !== 'personalizzato') { const [x, y] = intervallo(p); setDa(x); setA(y); } }
  const testoPeriodo = sel.periodo === 'intervallo' ? `${it(pDa)} – ${it(pA)}` : sel.periodo === 'scadenza' ? `scadenze fino al ${it(pA)}` : `situazione al ${it(pA)}`;
  const testoFiltri = [fV && `Veicolo ${opz.veicoli.find(x => x.id === fV)?.targa ?? ''}`, fT && `Tecnico ${(o => o ? `${o.nome} ${o.cognome}` : '')(opz.tecnici.find(x => x.id === fT))}`].filter(Boolean).join(' · ');

  async function esporta(tipo: 'xlsx' | 'pdf') {
    if (!righe) return;
    setEsporto(tipo);
    try {
      const m = await import('./report/esporta');
      const ctx = { periodo: testoPeriodo, filtri: testoFiltri, autore: autore || 'responsabile flotta', generato: new Date() };
      await (tipo === 'xlsx' ? m.esportaExcel(sel, righe, ctx) : m.esportaPdf(sel, righe, ctx));
      toast(tipo === 'xlsx' ? t('File Excel pronto') : t('File PDF pronto'));
    } catch (e) { toast(tm(testoErrore(e))); }
    finally { setEsporto(''); }
  }

  const riepilogo = useMemo(() => (righe && sel.riepilogo && righe.length ? sel.riepilogo(righe) : []), [righe, sel]);
  const MAX = 300;

  return (
    <div className="rep">
      <div className="page-hero">
        <div><h1>{t('Report')}</h1><p className="sub">{t('Scegli un report e il periodo. Guarda l\'anteprima e scaricalo in Excel o PDF, già impaginato.')}</p></div>
      </div>

      <div className="rep-layout">
        <nav className="rep-catalogo" aria-label={t('Tipi di report')}>
          {GRUPPI_REPORT.map(g => (
            <div key={g} className="rep-gruppo">
              <div className="rep-gtit">{t(g)}</div>
              {CATALOGO.filter(r => r.gruppo === g).map(r => (
                <button key={r.id} className={`rep-voce ${sel.id === r.id ? 'on' : ''}`} onClick={() => setSel(r)} aria-pressed={sel.id === r.id}>
                  <b>{t(r.titolo)}</b><span>{t(r.descrizione)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section className="rep-main">
          <div className="panel rep-filtri">
            <div className="rep-titolo"><h2>{t(sel.titolo)}</h2><span className="sub">{t(sel.descrizione)}</span></div>
            {sel.periodo === 'intervallo' && <>
              <div className="segmented rep-preset" role="group" aria-label={t('Periodo')}>
                {PRESET.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => scegliPreset(k)}>{t(l)}</button>)}
              </div>
            </>}
            <div className="row-flex wrap-end">
              {sel.periodo === 'intervallo' && <>
                <div className="field"><label htmlFor="r-da">{t('Dal')}</label><input id="r-da" type="date" value={da} max={a} onChange={e => { if (e.target.value) { setDa(e.target.value); setPreset('personalizzato'); } }} /></div>
                <div className="field"><label htmlFor="r-a">{t('Al')}</label><input id="r-a" type="date" value={a} min={da} onChange={e => { if (e.target.value) { setA(e.target.value); setPreset('personalizzato'); } }} /></div>
              </>}
              {sel.periodo === 'scadenza' && <div className="field"><label htmlFor="r-entro">{t('Scadenze fino al')}</label><input id="r-entro" type="date" value={entro} onChange={e => e.target.value && setEntro(e.target.value)} /></div>}
              {sel.filtri.veicolo && <div className="field"><label htmlFor="r-v">{t('Veicolo')}</label>
                <select id="r-v" value={veicolo} onChange={e => setVeicolo(e.target.value)}><option value="">{t('Tutti i veicoli')}</option>
                  {opz.veicoli.map(v => <option key={v.id} value={v.id}>{v.targa} · {v.marca_modello}</option>)}</select></div>}
              {sel.filtri.tecnico && <div className="field"><label htmlFor="r-t">{t('Tecnico')}</label>
                <select id="r-t" value={tecnico} onChange={e => setTecnico(e.target.value)}><option value="">{t('Tutti i tecnici')}</option>
                  {opz.tecnici.map(x => <option key={x.id} value={x.id}>{x.cognome} {x.nome}</option>)}</select></div>}
              <span className="spacer" />
              <button className="btn-ghost" onClick={() => esporta('xlsx')} disabled={!righe || !!esporto}>{esporto === 'xlsx' ? t('Preparo…') : t('Scarica Excel')}</button>
              <button className="btn" onClick={() => esporta('pdf')} disabled={!righe || !!esporto}>{esporto === 'pdf' ? t('Preparo…') : t('Scarica PDF')}</button>
            </div>
          </div>

          {err && <Banner s="ko">{tm(err)}</Banner>}
          {!righe && !err && <p className="sub" style={{ padding: '20px 4px' }}>{t('Caricamento…')}</p>}
          {righe && <>
            <div className="rep-meta"><span dir="ltr">{testoPeriodo}{testoFiltri ? ` · ${testoFiltri}` : ''}</span><span>{t('{n} righe', { n: righe.length })}</span></div>
            {riepilogo.length > 0 && <div className="rep-riepilogo">{riepilogo.map(x => <div key={x.l}><span>{t(x.l)}</span><b>{x.v}</b></div>)}</div>}
            <div className="table-wrap"><table className="rep-tab">
              <thead><tr>{sel.colonne.map(c => <th key={c.k} className={numerica(c.t) ? 'num-c' : ''}>{t(c.l)}</th>)}</tr></thead>
              <tbody>{righe.length ? <Corpo rep={sel} righe={righe.slice(0, MAX)} />
                : <tr><td colSpan={sel.colonne.length} className="sub">{t('Nessun dato nel periodo selezionato.')}</td></tr>}</tbody>
            </table></div>
            {righe.length > MAX && <p className="hint">{t('Anteprima delle prime {n} righe: i file Excel e PDF contengono tutte le {m} righe.', { n: MAX, m: righe.length })}</p>}
          </>}
        </section>
      </div>
    </div>
  );
}

function Corpo({ rep, righe }: { rep: Report; righe: Riga[] }) {
  const out: JSX.Element[] = [];
  let gruppo: string | null = null;
  righe.forEach((r, i) => {
    if (rep.raggruppa) {
      const g = String(r[rep.raggruppa.k]);
      if (g !== gruppo) { gruppo = g; out.push(<tr key={`g${i}`} className="rep-gr"><td colSpan={rep.colonne.length}>{rep.raggruppa.etichetta(r)}</td></tr>); }
    }
    out.push(<tr key={i}>{rep.colonne.map(c => <td key={c.k} className={`${numerica(c.t) ? 'num-c mono' : ''} ${c.t === 'targa' ? 'rep-targa' : ''} ${c.t === 'testo' && (c.w ?? 0) > 30 ? 'wrap-cell' : ''}`}>{testoCella(r[c.k], c.t)}</td>)}</tr>);
  });
  return <>{out}</>;
}
