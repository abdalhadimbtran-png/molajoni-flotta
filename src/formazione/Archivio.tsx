import { useMemo, useState } from 'react';
import { fmtData } from '../lib/format';
import { Caricamento, Errore, toast, useLoad } from '../ui';
import { ModaleAggiungiAttestato } from './ModaleRegistra';
import { apriAttestato, caricaTutto, chiediAttestato, richiestaAperta } from './comune';

/** Archivio attestati: cerca per dipendente, corso, anno; elenco delle registrazioni senza attestato. */
export default function Archivio() {
  const { data, errore, reload } = useLoad(caricaTutto);
  const [cerca, setCerca] = useState('');
  const [corso, setCorso] = useState('');
  const [anno, setAnno] = useState('');
  const [vista, setVista] = useState<'con' | 'senza'>('con');
  const [allega, setAllega] = useState<{ id: number; t: string } | null>(null);
  const reg = useMemo(() => new Map((data?.registrazioni ?? []).map(r => [r.id, r])), [data]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const anni = [...new Set(data.registrazioni.map(r => r.data_conseguimento.slice(0, 4)))].sort().reverse();
  const ok = (r: { nome: string; corso_id: number; data_conseguimento: string }) =>
    (!cerca || r.nome.toLowerCase().includes(cerca.toLowerCase())) && (!corso || String(r.corso_id) === corso) && (!anno || r.data_conseguimento.startsWith(anno));
  const con = data.attestati.map(a => ({ a, r: reg.get(a.corso_dipendente_id) })).filter(x => x.r && ok(x.r));
  const senza = data.registrazioni.filter(r => r.attuale && r.attivo && r.n_attestati === 0 && ok(r)).sort((a, b) => a.nome.localeCompare(b.nome));
  const apri = (p: string) => apriAttestato(p).catch(e => toast(e.message));
  return (
    <>
      <div className="page-hero"><div><h1>Archivio attestati</h1><p className="sub">Tutti gli attestati caricati. In «Senza attestato» trovi i corsi da completare con il documento.</p></div></div>
      <div className="row-flex" style={{ marginBottom: 12 }}>
        <button className={vista === 'con' ? 'btn' : 'btn-ghost'} onClick={() => setVista('con')}>Attestati ({con.length})</button>
        <button className={vista === 'senza' ? 'btn' : 'btn-ghost'} onClick={() => setVista('senza')}>Senza attestato ({senza.length})</button>
        {vista === 'senza' && senza.some(r => !richiestaAperta(data, r.id)) && <button className="btn-ghost" onClick={() => chiediAttestato(senza.filter(r => !richiestaAperta(data, r.id)).map(r => r.id)).then(n => { toast(`Richiesta inviata a ${n}`); reload(); }).catch(e => toast(e.message))}>Chiedi a tutti quelli mostrati</button>}
      </div>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <input type="search" placeholder="Cerca dipendente" value={cerca} onChange={e => setCerca(e.target.value)} style={{ maxWidth: 240, fontSize: 16 }} />
        <select value={corso} onChange={e => setCorso(e.target.value)} aria-label="Corso"><option value="">Tutti i corsi</option>{data.corsi.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        <select value={anno} onChange={e => setAnno(e.target.value)} aria-label="Anno"><option value="">Tutti gli anni</option>{anni.map(a => <option key={a}>{a}</option>)}</select>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Dipendente</th><th>Corso</th><th>Fatto il</th><th>Scadenza</th><th></th></tr></thead>
        <tbody>
          {vista === 'con' && con.map(({ a, r }) => (
            <tr key={a.id}><td><b>{r!.nome}</b></td><td>{r!.corso}{!r!.attuale && <span className="sub"> (storico)</span>}</td>
              <td>{fmtData(r!.data_conseguimento)}</td><td>{fmtData(r!.data_scadenza)}</td>
              <td><button className="btn-ghost btn-sm" onClick={() => apri(a.path)}>Apri / scarica</button>{a.caricato_da_dipendente && <span className="sub"> · dal dipendente</span>}</td></tr>))}
          {vista === 'senza' && senza.map(r => (
            <tr key={r.id}><td><b>{r.nome}</b></td><td>{r.corso}</td><td>{fmtData(r.data_conseguimento)}</td><td>{fmtData(r.data_scadenza)}</td>
              <td><div className="row-flex"><button className="btn btn-sm" onClick={() => setAllega({ id: r.id, t: `${r.nome} · ${r.corso}` })}>Aggiungi attestato</button>
                {richiestaAperta(data, r.id) ? <span className="sub">{richiestaAperta(data, r.id)!.stato === 'da_verificare' ? 'Da verificare' : 'Chiesto al dipendente'}</span>
                  : <button className="btn-ghost btn-sm" onClick={() => chiediAttestato([r.id]).then(() => { toast('Richiesta inviata'); reload(); }).catch(e => toast(e.message))}>Chiedi al dipendente</button>}</div></td></tr>))}
          {(vista === 'con' ? con.length : senza.length) === 0 && <tr><td colSpan={5} className="sub">Niente da mostrare.</td></tr>}
        </tbody>
      </table></div>
      {allega && <ModaleAggiungiAttestato cdId={allega.id} titolo={allega.t} onClose={() => setAllega(null)} onFatto={() => { setAllega(null); reload(); }} />}
    </>
  );
}
