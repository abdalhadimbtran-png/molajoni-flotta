import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { TIPI_MOV, fmtKm, fmtOra, lblCarb } from '../lib/format';
import { useT } from '../lib/i18n';
import { Caricamento, Errore, Pill, Targa, useLoad } from '../ui';

interface Mov {
  id: number; tipo: string; km: number; km_precedenti: number; carburante: string | null; note: string | null;
  danni_dichiarati: boolean; registrato_da: string; creato_il: string;
  veicoli: { targa: string } | null; tecnici: { nome: string; cognome: string } | null;
}

export default function Registro() {
  const { t, locale } = useT();
  const [veicolo, setVeicolo] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    let q = supabase.from('movimenti').select('id,tipo,km,km_precedenti,carburante,note,danni_dichiarati,registrato_da,creato_il,veicoli(targa),tecnici(nome,cognome)')
      .order('creato_il', { ascending: false }).limit(500);
    if (veicolo) q = q.eq('veicolo_id', Number(veicolo));
    const [v, m] = await Promise.all([supabase.from('veicoli').select('id,targa').order('targa'), q]);
    if (v.error) throw v.error; if (m.error) throw m.error;
    return { veicoli: v.data as { id: number; targa: string }[], mov: m.data as unknown as Mov[] };
  }, [veicolo]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="section-title">{t('Registro movimenti')} <span className="meta">{t('non modificabile: ogni correzione è una nuova riga')}</span><span className="spacer" />
        <select aria-label={t('Filtra per veicolo')} value={veicolo} onChange={e => setVeicolo(e.target.value)}>
          <option value="">{t('Tutti i veicoli')}</option>{data.veicoli.map(v => <option key={v.id} value={v.id}>{v.targa}</option>)}</select></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Data e ora')}</th><th>{t('Veicolo')}</th><th>{t('Tecnico')}</th><th>{t('Operazione')}</th><th>{t('Km')}</th><th>{t('Δ km')}</th><th>{t('Carburante')}</th><th>{t('Note')}</th></tr></thead>
        <tbody>{data.mov.length ? data.mov.map(m => {
          const [s, l] = TIPI_MOV[m.tipo] ?? ['na', m.tipo];
          const d = m.km - m.km_precedenti;
          return (
            <tr key={m.id}>
              <td className="mono">{fmtOra(m.creato_il, locale)}</td>
              <td><Targa t={m.veicoli?.targa} /></td>
              <td>{m.tecnici ? `${m.tecnici.nome} ${m.tecnici.cognome}` : '—'}{m.registrato_da === 'responsabile' && <div className="sub">{t('registrato dal responsabile')}</div>}</td>
              <td><Pill s={s}>{t(l)}</Pill></td>
              <td className="mono">{fmtKm(m.km)}</td>
              <td className="mono" dir="ltr">{d === 0 ? '0' : (d > 0 ? '+' : '−') + fmtKm(Math.abs(d))}</td>
              <td className="mono">{t(lblCarb(m.carburante))}</td>
              <td className="wrap-cell sub">{[m.danni_dichiarati ? t('Dichiarati danni') : '', m.note ?? ''].filter(Boolean).join(' · ')}</td>
            </tr>
          );
        }) : <tr><td colSpan={8} className="sub">{t('Nessun movimento')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Il registro indica chi aveva quale veicolo in ogni momento: serve per le multe (comunicazione del conducente), per i danni e per i chilometri per tecnico. Mostra gli ultimi 500 movimenti.')}</p>
    </>
  );
}
