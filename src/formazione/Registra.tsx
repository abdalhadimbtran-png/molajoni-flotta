import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Caricamento, Errore, useLoad } from '../ui';
import { ModuloRegistra } from './ModaleRegistra';
import type { Corso, DipBase } from './comune';

/** Stesso corso, stessa data, più dipendenti insieme (dopo una sessione di gruppo). */
export default function Registra() {
  const { data, errore, reload } = useLoad(async () => {
    const [d, c] = await Promise.all([
      supabase.from('dipendenti').select('id,codice,nome,cognome,categoria,reparto,attivo').eq('attivo', true).order('cognome').order('nome'),
      supabase.from('corsi').select('*').order('ordine').order('nome'),
    ]);
    const e = d.error || c.error; if (e) throw e;
    return { dip: (d.data ?? []) as DipBase[], corsi: (c.data ?? []) as Corso[] };
  });
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [soloTec, setSoloTec] = useState(true);
  const [chiave, setChiave] = useState(0);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.dip.filter(d => !soloTec || d.categoria === 'TEC');
  const tocca = (id: number) => { const n = new Set(scelti); if (n.has(id)) n.delete(id); else n.add(id); setScelti(n); };
  return (
    <>
      <div className="page-hero"><div><h1>Registra un corso per più dipendenti</h1>
        <p className="sub">1. Spunta chi ha partecipato. 2. Scegli corso e data. 3. Premi «Registra».</p></div></div>
      <div className="rep-layout" style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section>
          <div className="row-flex" style={{ marginBottom: 10 }}>
            <button className={soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(true)}>Solo tecnici</button>
            <button className={!soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(false)}>Tutti</button>
            <button className="btn-ghost btn-sm" onClick={() => setScelti(new Set([...scelti, ...lista.map(d => d.id)]))}>Seleziona tutti</button>
            <button className="btn-ghost btn-sm" onClick={() => setScelti(new Set())}>Nessuno</button>
          </div>
          <p><b>{scelti.size}</b> {scelti.size === 1 ? 'dipendente scelto' : 'dipendenti scelti'}</p>
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            {lista.map(d => (
              <label key={d.id} className="row-flex" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={scelti.has(d.id)} onChange={() => tocca(d.id)} style={{ width: 20, height: 20 }} />
                <span><b>{d.cognome} {d.nome}</b> <span className="sub">{d.codice}</span></span>
              </label>))}
          </div>
        </section>
        <section>
          <ModuloRegistra key={chiave} corsi={data.corsi} dipendenti={[...scelti]} onFatto={() => { setScelti(new Set()); setChiave(chiave + 1); }} />
        </section>
      </div>
    </>
  );
}
