import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtData } from '../lib/format';
import { Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { ModaleAggiungiAttestato, ModaleAssegna } from './ModaleRegistra';
import { COLORE, STATO_CORSO, apriAttestato, caricaTutto, chiediAttestato, iniziali, richiestaAperta, type DipBase, type StatoCorso, type Tutto } from './comune';

/** Corsi di un dipendente: riga attuale per corso (+ obbligatori mancanti). */
export function corsiDi(t: Tutto, id: number) {
  return t.righe.filter(r => r.dipendente_id === id).map(r => ({
    ...r, reg: t.registrazioni.find(g => g.attuale && g.dipendente_id === id && g.corso_id === r.corso_id) ?? null,
  })).sort((a, b) => a.corso.localeCompare(b.corso));
}

export default function Dipendenti() {
  const [qs, setQs] = useSearchParams();
  const [soloTec, setSoloTec] = useState(true);
  const [cerca, setCerca] = useState('');
  const { data, errore, reload } = useLoad(caricaTutto);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const aperto = data.dip.find(x => x.id === Number(qs.get('d'))) ?? null;
  const lista = data.dip.filter(x => (!soloTec || x.categoria === 'TEC') && (!cerca || `${x.nome} ${x.cognome} ${x.codice}`.toLowerCase().includes(cerca.toLowerCase())));
  return (
    <>
      <div className="page-hero"><div><h1>Dipendenti</h1><p className="sub">Tocca una persona per vedere i suoi corsi.</p></div></div>
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <button className={soloTec ? 'btn' : 'btn-ghost'} onClick={() => setSoloTec(true)}>Tecnici</button>
        <button className={!soloTec ? 'btn' : 'btn-ghost'} onClick={() => setSoloTec(false)}>Tutti</button>
        <input type="search" placeholder="Cerca…" value={cerca} onChange={e => setCerca(e.target.value)} style={{ maxWidth: 260, fontSize: 16 }} />
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {lista.map(d => {
          const c = corsiDi(data, d.id);
          return (
            <button key={d.id} onClick={() => setQs({ d: String(d.id) })}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'start', font: 'inherit', color: 'inherit' }}>
              <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 17, flex: 'none' }}>{iniziali(d.nome, d.cognome)}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: 16 }}>{d.cognome} {d.nome}</b>
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }} aria-label={`${c.length} corsi`}>
                  {c.length === 0 && <span className="sub">Nessun corso</span>}
                  {c.map(r => <span key={r.corso_id} title={`${r.corso}: ${STATO_CORSO[r.stato].join(' ')}`}
                    style={{ width: 11, height: 11, borderRadius: '50%', background: COLORE[r.stato], opacity: r.stato === 'mancante' ? 0.45 : 1 }} />)}
                </span>
              </span>
            </button>);
        })}
      </div>
      <p className="sub" style={{ marginTop: 12 }}>Pallini: <span style={{ color: 'var(--ok)' }}>●</span> valido · <span style={{ color: 'var(--warn)' }}>●</span> in scadenza · <span style={{ color: 'var(--ko)' }}>●</span> scaduto · <span style={{ color: 'var(--ko)', opacity: .45 }}>●</span> mancante</p>
      {aperto && <Scheda d={aperto} t={data} corsoIniziale={Number(qs.get('c')) || undefined} onClose={() => setQs({})} onCambiato={reload} />}
    </>
  );
}

function Scheda({ d, t, corsoIniziale, onClose, onCambiato }: { d: DipBase; t: Tutto; corsoIniziale?: number; onClose: () => void; onCambiato: () => void }) {
  const [assegna, setAssegna] = useState<number | 'nuovo' | null>(corsoIniziale ?? null);
  const [allega, setAllega] = useState<{ id: number; corso: string } | null>(null);
  const [vedi, setVedi] = useState<number | null>(null);
  const righe = corsiDi(t, d.id);
  const apri = (p: string) => apriAttestato(p).catch(e => toast(e.message));
  if (assegna != null) return <ModaleAssegna corsi={t.corsi} dipendenti={t.dip} scelti={[d.id]} corso={typeof assegna === 'number' ? assegna : undefined}
    titolo={`${d.cognome} ${d.nome}`} onClose={() => setAssegna(null)} onFatto={() => { setAssegna(null); onCambiato(); }} />;
  if (allega) return <ModaleAggiungiAttestato cdId={allega.id} titolo={`Attestato · ${allega.corso}`} onClose={() => setAllega(null)} onFatto={() => { setAllega(null); onCambiato(); }} />;
  return (
    <Modal titolo={`${d.cognome} ${d.nome}`} onClose={onClose}>
      <div className="form">
        <button className="btn" style={{ fontSize: 17 }} onClick={() => setAssegna('nuovo')}>+ Aggiungi corso</button>
        {righe.length === 0 && <p className="sub">Nessun corso.</p>}
        {righe.map(r => {
          const att = r.reg ? t.attestati.filter(a => a.corso_dipendente_id === r.reg!.id) : [];
          const s = r.stato as StatoCorso;
          return (
            <div key={r.corso_id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 16 }}>{r.corso}</b><Pill s={STATO_CORSO[s][0]}>{STATO_CORSO[s][1]}</Pill></div>
              <div className="sub" style={{ margin: '4px 0 8px' }}>{r.reg ? (r.data_scadenza ? `Scade il ${fmtData(r.data_scadenza)}` : 'Non scade') + ` · fatto il ${fmtData(r.data_conseguimento)}` : 'Obbligatorio: da fare'}</div>
              <div className="row-flex">
                {att.length > 0 && <button className="btn-ghost btn-sm" onClick={() => att.length === 1 ? apri(att[0].path) : setVedi(vedi === r.corso_id ? null : r.corso_id)}>Vedi attestato{att.length > 1 ? ` (${att.length})` : ''}</button>}
                <button className="btn btn-sm" onClick={() => setAssegna(r.corso_id)}>{r.reg ? 'Rinnova' : 'Registra'}</button>
                {r.reg && <button className="btn-ghost btn-sm" onClick={() => setAllega({ id: r.reg!.id, corso: r.corso })}>Aggiungi attestato</button>}
                {r.reg && att.length === 0 && (() => {
                  const q = richiestaAperta(t, r.reg!.id);
                  if (q) return <Pill s={q.stato === 'da_verificare' ? 'warn' : 'info'}>{q.stato === 'da_verificare' ? 'Da verificare' : 'Chiesto al dipendente'}</Pill>;
                  return <button className="btn-ghost btn-sm" onClick={() => chiediAttestato([r.reg!.id]).then(() => { toast('Richiesta inviata al dipendente'); onCambiato(); }).catch(e => toast(e.message))}>Chiedi attestato al dipendente</button>;
                })()}
              </div>
              {vedi === r.corso_id && <div className="row-flex" style={{ marginTop: 6 }}>{att.map((a, i) => <button key={a.id} className="btn-ghost btn-sm" onClick={() => apri(a.path)}>File {i + 1}</button>)}</div>}
            </div>);
        })}
      </div>
    </Modal>
  );
}
