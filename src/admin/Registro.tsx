import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { TIPI_MOV, fmtKm, fmtOra, lblCarb } from '../lib/format';
import { Caricamento, Errore, Pill, useLoad } from '../ui';

interface Mov {
  id: number; tipo: string; km: number; km_precedenti: number; carburante: string | null; note: string | null;
  danni_dichiarati: boolean; registrato_da: string; creato_il: string;
  veicoli: { targa: string } | null; tecnici: { nome: string; cognome: string } | null;
}

export default function Registro() {
  const [veicolo, setVeicolo] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    const [v, m] = await Promise.all([
      supabase.from('veicoli').select('id,targa').order('targa'),
      (() => {
        let q = supabase.from('movimenti').select('id,tipo,km,km_precedenti,carburante,note,danni_dichiarati,registrato_da,creato_il,veicoli(targa),tecnici(nome,cognome)')
          .order('creato_il', { ascending: false }).limit(500);
        if (veicolo) q = q.eq('veicolo_id', Number(veicolo));
        return q;
      })(),
    ]);
    if (v.error) throw v.error; if (m.error) throw m.error;
    return { veicoli: v.data as { id: number; targa: string }[], mov: m.data as unknown as Mov[] };
  }, [veicolo]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="section-title">Registro movimenti <span className="meta">non modificabile: ogni correzione è una nuova riga</span><span className="spacer" />
        <select aria-label="Filtra per veicolo" value={veicolo} onChange={e => setVeicolo(e.target.value)}>
          <option value="">Tutti i veicoli</option>{data.veicoli.map(v => <option key={v.id} value={v.id}>{v.targa}</option>)}</select></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Data e ora</th><th>Veicolo</th><th>Tecnico</th><th>Operazione</th><th>Km</th><th>Δ km</th><th>Carburante</th><th>Note</th></tr></thead>
        <tbody>{data.mov.length ? data.mov.map(m => {
          const [s, l] = TIPI_MOV[m.tipo] ?? ['na', m.tipo];
          const d = m.km - m.km_precedenti;
          return (
            <tr key={m.id}>
              <td className="mono">{fmtOra(m.creato_il)}</td>
              <td><span className="targa">{m.veicoli?.targa}</span></td>
              <td>{m.tecnici ? `${m.tecnici.nome} ${m.tecnici.cognome}` : '—'}{m.registrato_da === 'responsabile' && <div className="sub">registrato dal responsabile</div>}</td>
              <td><Pill s={s}>{l}</Pill></td>
              <td className="mono">{fmtKm(m.km)}</td>
              <td className="mono">{d === 0 ? '0' : (d > 0 ? '+' : '−') + fmtKm(Math.abs(d))}</td>
              <td className="mono">{lblCarb(m.carburante)}</td>
              <td className="wrap-cell sub">{[m.danni_dichiarati ? 'Dichiarati danni' : '', m.note ?? ''].filter(Boolean).join(' · ')}</td>
            </tr>
          );
        }) : <tr><td colSpan={8} className="sub">Nessun movimento</td></tr>}</tbody>
      </table></div>
      <p className="hint">Il registro indica chi aveva quale veicolo in ogni momento: serve per le multe (comunicazione del conducente), per i danni e per i chilometri per tecnico. Mostra gli ultimi 500 movimenti.</p>
    </>
  );
}
