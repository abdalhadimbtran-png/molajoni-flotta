import { useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { CATEGORIE, GRAVITA, STATI_SEGN, fmtOra } from '../lib/format';
import type { Segnalazione } from '../lib/tipi';
import { Caricamento, Errore, Pill, toast, useLoad } from '../ui';

export default function Segnalazioni() {
  const [tutte, setTutte] = useState(false);
  const { data, errore, reload } = useLoad(async () => {
    let q = supabase.from('segnalazioni').select('*, veicoli(targa), tecnici(nome,cognome)').order('creato_il', { ascending: false }).limit(300);
    if (!tutte) q = q.neq('stato', 'chiusa');
    const { data, error } = await q;
    if (error) throw error;
    return data as Segnalazione[];
  }, [tutte]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const ord: Record<string, number> = { aperta: 0, in_lavorazione: 1, chiusa: 2 };
  const lista = [...data].sort((a, b) => ord[a.stato] - ord[b.stato]);
  return (
    <>
      <div className="section-title">Segnalazioni dai tecnici <span className="meta">{data.filter(s => s.stato !== 'chiusa').length} non chiuse</span><span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={tutte} onChange={e => setTutte(e.target.checked)} /> Mostra anche le chiuse</label></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Data</th><th>Veicolo</th><th>Problema</th><th>Segnalata da</th><th>Gravità</th><th>Stato</th></tr></thead>
        <tbody>{lista.length ? lista.map(s => <Riga key={s.id} s={s} onSalvato={reload} />) : <tr><td colSpan={6} className="sub">Nessuna segnalazione</td></tr>}</tbody>
      </table></div>
      <p className="hint">Una segnalazione "veicolo fermo" blocca il mezzo finché non viene chiusa. La chiusura richiede una nota (es. riparato in officina, fattura n.) e resta nello storico.</p>
    </>
  );
}

function Riga({ s, onSalvato }: { s: Segnalazione; onSalvato: () => void }) {
  const [chiusura, setChiusura] = useState(false);
  const [nota, setNota] = useState('');
  const [g, gl] = GRAVITA[s.gravita];
  async function aggiorna(stato: string, nota_chiusura?: string) {
    const { error } = await supabase.from('segnalazioni').update(nota_chiusura ? { stato, nota_chiusura } : { stato }).eq('id', s.id);
    if (error) { toast(testoErrore(error)); return; }
    toast(stato === 'chiusa' ? 'Segnalazione chiusa' : 'Stato aggiornato'); setChiusura(false); onSalvato();
  }
  return (
    <tr>
      <td className="mono">{fmtOra(s.creato_il)}</td>
      <td><span className="targa">{s.veicoli?.targa}</span></td>
      <td className="wrap-cell">{CATEGORIE[s.categoria]}<div className="sub">{s.descrizione}</div>
        {s.stato === 'chiusa' && <div className="sub">Chiusa il {fmtOra(s.chiusa_il)}: {s.nota_chiusura}</div>}</td>
      <td>{s.tecnici ? `${s.tecnici.nome} ${s.tecnici.cognome}` : '—'}</td>
      <td><Pill s={g}>{gl}</Pill></td>
      <td className="nowrap">
        {s.stato === 'chiusa' ? <Pill s={STATI_SEGN.chiusa[0]}>Chiusa</Pill> : chiusura ? (
          <div className="mini-form">
            <input aria-label="Nota di chiusura" placeholder="Cosa è stato fatto" value={nota} onChange={e => setNota(e.target.value)} />
            <div className="row-flex"><button className="btn btn-sm" disabled={nota.trim().length < 3} onClick={() => aggiorna('chiusa', nota.trim())}>Chiudi</button>
              <button className="btn-ghost btn-sm" onClick={() => setChiusura(false)}>Annulla</button></div>
          </div>
        ) : (
          <div className="row-flex">
            <select aria-label="Stato" value={s.stato} onChange={e => aggiorna(e.target.value)}>
              <option value="aperta">Aperta</option><option value="in_lavorazione">In lavorazione</option></select>
            <button className="btn-ghost btn-sm" onClick={() => setChiusura(true)}>Chiudi…</button>
          </div>
        )}
      </td>
    </tr>
  );
}
