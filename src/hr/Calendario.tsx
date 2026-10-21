import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { Caricamento, Errore, MenuAzioni, Modal, useLoad } from '../ui';
import {
  CATEGORIE, SEL_DIP, giornoLungo, giornoSett, letteraTipo, nomeCategoria, nomeMese, nomeTipo, periodo, piuGiorni, useHR,
  type AssenzaCal, type Categoria, type Dipendente,
} from './comune';
import { ModaleDettaglio, ModaleInserisci, PillStato } from './componenti';

const LETTERE_GS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const ultimoDelMese = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
const spostaMese = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** Calendario assenze: mese × dipendenti (computer) o elenco per giorno (telefono). */
export default function Calendario() {
  const { mioDipendente } = useHR();
  const [sp, setSp] = useSearchParams();
  const mese = /^\d{4}-\d{2}$/.test(sp.get('m') ?? '') ? sp.get('m')! : oggiISO().slice(0, 7);
  const evid = Number(sp.get('d')) || null;
  const [cat, setCat] = useState<Categoria | ''>('');
  const [reparto, setReparto] = useState('');
  const [vista, setVista] = useState<'mese' | 'elenco'>(() => (window.innerWidth < 900 ? 'elenco' : 'mese'));
  const [aperta, setAperta] = useState<AssenzaCal | null>(null);
  const [inserisci, setInserisci] = useState(false);
  const da = `${mese}-01`, a = ultimoDelMese(mese);
  const { data, errore, reload } = useLoad(async () => {
    const [c, d] = await Promise.all([
      rpc<{ festivita: { data: string; nome: string }[]; assenze: AssenzaCal[] }>('hr_calendario', { p_da: da, p_a: a, p_categoria: cat || null }),
      supabase.from('dipendenti').select(SEL_DIP).order('cognome'),
    ]);
    if (d.error) throw d.error;
    return { ...c, dipendenti: (d.data ?? []) as Dipendente[] };
  }, [da, a, cat]);
  const giorni = useMemo(() => { const l: string[] = []; for (let d = da; d <= a; d = piuGiorni(d, 1)) l.push(d); return l; }, [da, a]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const vaiMese = (m: string) => { const n = new URLSearchParams(sp); n.set('m', m); setSp(n, { replace: true }); };
  const fest = new Map((data?.festivita ?? []).map(f => [f.data, f.nome]));
  const reparti = [...new Set((data?.dipendenti ?? []).map(d => d.reparto).filter(Boolean) as string[])].sort();
  const persone = (data?.dipendenti ?? []).filter(d => (d.attivo || (d.data_cessazione ?? '') >= da) && (d.data_assunzione ?? '') <= a
    && (!cat || d.categoria === cat) && (!reparto || d.reparto === reparto));
  const assenze = (data?.assenze ?? []).filter(x => !reparto || x.reparto === reparto);
  const delGiorno = (idDip: number, g: string) => assenze.filter(x => x.dipendente_id === idDip && x.dal <= g && x.al >= g);
  const riposo = (d: Dipendente, g: string) => d.giorni_riposo[giornoSett(g) - 1] === '1';
  const oggi = oggiISO();

  return (
    <>
      <div className="page-hero">
        <div><h1>Calendario assenze</h1><p className="sub">Chi manca e quando. Le richieste in valutazione hanno il bordo tratteggiato.</p></div>
        <button className="btn" onClick={() => setInserisci(true)}>Inserisci un'assenza</button>
      </div>

      <div className="hr-barra no-print">
        <div className="row-flex">
          <button className="btn-ghost btn-sm" onClick={() => vaiMese(spostaMese(mese, -1))} aria-label="Mese precedente">‹</button>
          <b className="hr-mese">{nomeMese(Number(mese.slice(5)))} {mese.slice(0, 4)}</b>
          <button className="btn-ghost btn-sm" onClick={() => vaiMese(spostaMese(mese, 1))} aria-label="Mese successivo">›</button>
          <button className="btn-ghost btn-sm" onClick={() => vaiMese(oggi.slice(0, 7))}>Oggi</button>
        </div>
        <div className="segmented" role="group" aria-label="Categoria">
          <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>Tutti</button>
          {CATEGORIE.map(([k, l]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{k === 'TEC' ? 'Tecnici' : l}</button>)}
        </div>
        {reparti.length > 0 && <select aria-label="Reparto" value={reparto} onChange={e => setReparto(e.target.value)}><option value="">Tutti i reparti</option>{reparti.map(r => <option key={r}>{r}</option>)}</select>}
        <span className="spacer" />
        <div className="segmented hr-solo-pc" role="group" aria-label="Vista">
          <button className={vista === 'mese' ? 'on' : ''} onClick={() => setVista('mese')}>Mese</button>
          <button className={vista === 'elenco' ? 'on' : ''} onClick={() => setVista('elenco')}>Elenco</button>
        </div>
        <MenuAzioni label="Altro"><button onClick={() => window.print()}>Stampa</button></MenuAzioni>
      </div>

      {!data ? <Caricamento /> : vista === 'mese' ? <>
        <div className="table-wrap hr-cal-wrap"><table className="cal">
          <thead><tr><th className="cal-nome">Dipendente</th>{giorni.map(g => (
            <th key={g} className={`${fest.has(g) || giornoSett(g) >= 6 ? 'cal-off' : ''} ${g === oggi ? 'cal-oggi' : ''}`} title={fest.get(g)}>
              <span>{LETTERE_GS[giornoSett(g) - 1]}</span><b>{Number(g.slice(8))}</b></th>))}</tr></thead>
          <tbody>
            <tr className="cal-tot"><td className="cal-nome">Assenti</td>{giorni.map(g => {
              const n = persone.filter(p => !riposo(p, g) && !fest.has(g) && delGiorno(p.id, g).some(x => x.stato === 'approvata')).length;
              return <td key={g} className={fest.has(g) || giornoSett(g) >= 6 ? 'cal-off' : ''}>{n || ''}</td>;
            })}</tr>
            {CATEGORIE.map(([k]) => {
              const rr = persone.filter(p => p.categoria === k);
              if (!rr.length) return null;
              return [
                <tr key={`g${k}`} className="cal-gr"><td colSpan={giorni.length + 1}>{k === 'TEC' ? 'Tecnici' : nomeCategoria(k)} · {rr.length}</td></tr>,
                ...rr.map(p => (
                  <tr key={p.id} className={evid === p.id ? 'cal-evid' : ''}>
                    <td className="cal-nome"><span>{p.cognome} {p.nome}</span>{p.reparto && <span className="sub">{p.reparto}</span>}</td>
                    {giorni.map(g => {
                      const off = riposo(p, g) || fest.has(g);
                      const x = off ? undefined : delGiorno(p.id, g)[0];
                      if (!x) return <td key={g} className={off ? 'cal-off' : ''} title={fest.get(g)} />;
                      const parziale = x.mezza_giornata || !!x.ora_inizio;
                      const descr = `${p.nome} ${p.cognome} · ${x.origine === 'manuale' ? x.etichetta : nomeTipo(x.etichetta)} · ${periodo({ primo_giorno: x.dal, ultimo_giorno: x.al, ora_inizio: x.ora_inizio, ora_fine: x.ora_fine, mezza_giornata: x.mezza_giornata })}${x.stato === 'in_attesa' ? ' · in valutazione' : ''}`;
                      return (
                        <td key={g} className="cal-c">
                          <button className={`cal-x ${parziale ? 'cal-p' : 'cal-f'} ${x.stato === 'in_attesa' ? 'cal-v' : ''} ${x.tipo === 'MAL' ? 'cal-m' : ''}`}
                            title={descr} aria-label={descr} onClick={() => setAperta(x)}>{x.origine === 'manuale' ? 'A' : letteraTipo(x.tipo)}</button>
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
            {persone.length === 0 && <tr><td colSpan={giorni.length + 1} className="sub">Nessun dipendente con questi filtri.</td></tr>}
          </tbody>
        </table></div>
        <Legenda />
      </> : <Elenco giorni={giorni} assenze={assenze} persone={persone} fest={fest} onApri={setAperta} />}

      {aperta?.origine === 'richiesta' && aperta.richiesta_id && <ModaleDettaglio id={aperta.richiesta_id} mio={mioDipendente} onClose={() => setAperta(null)} onCambiato={() => { setAperta(null); reload(); }} />}
      {aperta?.origine === 'manuale' && <Modal titolo={`Assenza di ${aperta.nome}`} onClose={() => setAperta(null)}>
        <div className="form"><dl className="riepilogo"><dt>Motivo</dt><dd>{aperta.etichetta}</dd><dt>Dal</dt><dd>{giornoLungo(aperta.dal)}</dd><dt>Al</dt><dd>{giornoLungo(aperta.al)}</dd></dl>
          <p className="hint">Inserita a mano dal responsabile flotta prima del modulo ferie. Per correggerla contatta il responsabile flotta.</p></div>
      </Modal>}
      {inserisci && <ModaleInserisci preDipendente={evid ?? undefined} onClose={() => setInserisci(false)} onSalvato={() => { setInserisci(false); reload(); }} />}
    </>
  );
}

function Legenda() {
  return (
    <div className="cal-legenda" aria-label="Legenda">
      <span><i className="cal-x cal-f">F</i> Ferie</span><span><i className="cal-x cal-p">P</i> Permesso a ore o mezza giornata</span>
      <span><i className="cal-x cal-f cal-m">M</i> Malattia</span><span><i className="cal-x cal-f">A</i> Altra assenza</span>
      <span><i className="cal-x cal-f cal-v">F</i> In valutazione</span><span><i className="cal-x cal-off-i" /> Riposo o festività</span>
    </div>
  );
}

function Elenco({ giorni, assenze, persone, fest, onApri }: { giorni: string[]; assenze: AssenzaCal[]; persone: Dipendente[]; fest: Map<string, string>; onApri: (x: AssenzaCal) => void }) {
  const ids = new Set(persone.map(p => p.id));
  const righe = giorni.filter(g => !fest.has(g)).map(g => ({
    g, l: assenze.filter(x => ids.has(x.dipendente_id) && x.dal <= g && x.al >= g
      && persone.find(p => p.id === x.dipendente_id)!.giorni_riposo[giornoSett(g) - 1] !== '1'),
  })).filter(x => x.l.length);
  if (!righe.length) return <div className="panel"><p className="sub">Nessuna assenza in questo mese.</p></div>;
  return (
    <div className="hr-elenco">
      {righe.map(({ g, l }) => (
        <section key={g} className="panel">
          <h3>{giornoLungo(g)} · {l.length} {l.length === 1 ? 'assente' : 'assenti'}</h3>
          {l.map((x, i) => (
            <button key={i} className="hr-elenco-r" onClick={() => onApri(x)}>
              <span><b>{x.nome}</b> · {x.origine === 'manuale' ? x.etichetta : nomeTipo(x.etichetta)} · {x.ora_inizio ? `${x.ora_inizio}–${x.ora_fine}` : x.mezza_giornata ? 'mezza giornata' : `rientra ${periodo({ primo_giorno: x.dal, ultimo_giorno: x.al }).split('rientro ')[1]}`}</span>
              {x.stato === 'in_attesa' && <PillStato stato="in_attesa" />}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
