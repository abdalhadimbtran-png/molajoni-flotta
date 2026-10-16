import { useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { CATEGORIE, GRAVITA, fmtOra } from '../lib/format';
import { useT } from '../lib/i18n';
import type { Segnalazione } from '../lib/tipi';
import { Caricamento, Errore, Pill, Targa, toast, useLoad } from '../ui';

export default function Segnalazioni() {
  const { t } = useT();
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
      <div className="section-title">{t('Segnalazioni dai tecnici')} <span className="meta">{t('{n} non chiuse', { n: data.filter(s => s.stato !== 'chiusa').length })}</span><span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={tutte} onChange={e => setTutte(e.target.checked)} /> {t('Mostra anche le chiuse')}</label></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Data')}</th><th>{t('Veicolo')}</th><th>{t('Problema')}</th><th>{t('Segnalata da')}</th><th>{t('Gravità')}</th><th>{t('Stato')}</th></tr></thead>
        <tbody>{lista.length ? lista.map(s => <Riga key={s.id} s={s} onSalvato={reload} />) : <tr><td colSpan={6} className="sub">{t('Nessuna segnalazione')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Una segnalazione "veicolo fermo" blocca il mezzo finché non viene chiusa. La chiusura richiede una nota (es. riparato in officina, fattura n.) e resta nello storico.')}</p>
    </>
  );
}

function Riga({ s, onSalvato }: { s: Segnalazione; onSalvato: () => void }) {
  const { t, tm, locale } = useT();
  const [chiusura, setChiusura] = useState(false);
  const [nota, setNota] = useState('');
  const [g, gl] = GRAVITA[s.gravita];
  async function aggiorna(stato: string, nota_chiusura?: string) {
    const { error } = await supabase.from('segnalazioni').update(nota_chiusura ? { stato, nota_chiusura } : { stato }).eq('id', s.id);
    if (error) { toast(tm(testoErrore(error))); return; }
    toast(stato === 'chiusa' ? t('Segnalazione chiusa') : t('Stato aggiornato')); setChiusura(false); onSalvato();
  }
  return (
    <tr>
      <td className="mono">{fmtOra(s.creato_il, locale)}</td>
      <td><Targa t={s.veicoli?.targa} /></td>
      <td className="wrap-cell"><b style={{ fontWeight: 600 }}>{t(CATEGORIE[s.categoria])}</b><div className="sub">{s.descrizione}</div>
        {s.stato === 'chiusa' && <div className="sub">{t('Chiusa il {d}: {n}', { d: fmtOra(s.chiusa_il, locale), n: s.nota_chiusura ?? '' })}</div>}</td>
      <td>{s.tecnici ? `${s.tecnici.nome} ${s.tecnici.cognome}` : '—'}</td>
      <td><Pill s={g}>{t(gl)}</Pill></td>
      <td className="nowrap">
        {s.stato === 'chiusa' ? <Pill s="na">{t('Chiusa')}</Pill> : chiusura ? (
          <div className="mini-form">
            <input aria-label={t('Nota di chiusura')} placeholder={t('Cosa è stato fatto')} value={nota} onChange={e => setNota(e.target.value)} />
            <div className="row-flex"><button className="btn btn-sm" disabled={nota.trim().length < 3} onClick={() => aggiorna('chiusa', nota.trim())}>{t('Chiudi')}</button>
              <button className="btn-ghost btn-sm" onClick={() => setChiusura(false)}>{t('Annulla')}</button></div>
          </div>
        ) : (
          <div className="row-flex">
            <select aria-label={t('Stato')} value={s.stato} onChange={e => aggiorna(e.target.value)}>
              <option value="aperta">{t('Aperta')}</option><option value="in_lavorazione">{t('In lavorazione')}</option></select>
            <button className="btn-ghost btn-sm" onClick={() => setChiusura(true)}>{t('Chiudi…')}</button>
          </div>
        )}
      </td>
    </tr>
  );
}
