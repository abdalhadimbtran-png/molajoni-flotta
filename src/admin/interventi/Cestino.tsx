import { useState } from 'react';
import { rpc, supabase, testoErrore } from '../../lib/supabase';
import { useT } from '../../lib/i18n';
import { Banner, Caricamento, Errore, Modal, toast, useLoad } from '../../ui';

export const MOTIVI = ['File sbagliato', 'Duplicato', 'Mese errato', 'Altro'];

export interface SceltaElimina { motivo: string; posizioni: boolean; anchePianificati: boolean }

/** Conferma di eliminazione con motivo obbligatorio (cestino: ripristinabile per 30 giorni). */
export function ModaleElimina({ titolo, testo, pianificati = 0, onConferma, onClose }: {
  titolo: string; testo: string; pianificati?: number; onConferma: (s: SceltaElimina) => Promise<void>; onClose: () => void;
}) {
  const { t } = useT();
  const [motivo, setMotivo] = useState('');
  const [altro, setAltro] = useState('');
  const [posizioni, setPosizioni] = useState(false);
  const [anche, setAnche] = useState(false);
  const [occ, setOcc] = useState(false);
  const finale = motivo === 'Altro' ? (altro.trim() ? `Altro: ${altro.trim()}` : '') : motivo;
  async function vai() {
    if (!finale) return;
    setOcc(true);
    try { await onConferma({ motivo: finale, posizioni, anchePianificati: anche }); onClose(); }
    catch (e) { toast(testoErrore(e)); } finally { setOcc(false); }
  }
  return (
    <Modal titolo={titolo} onClose={onClose}>
      <p>{testo}</p>
      {pianificati > 0 && <div className="field">
        <label>{t('{n} sono già pianificati (assegnati a un giorno o con percorso)', { n: pianificati })}</label>
        <label className="row-flex" style={{ gap: 6 }}><input type="radio" name="el-pian" checked={!anche} onChange={() => setAnche(false)} />{t('Elimina solo quelli non pianificati')}</label>
        <label className="row-flex" style={{ gap: 6 }}><input type="radio" name="el-pian" checked={anche} onChange={() => setAnche(true)} />{t('Elimina anche quelli pianificati')}</label>
      </div>}
      <div className="field"><label htmlFor="el-mot">{t('Motivo')} *</label>
        <select id="el-mot" value={motivo} onChange={e => setMotivo(e.target.value)} required>
          <option value="">{t('— scegli —')}</option>{MOTIVI.map(m => <option key={m} value={m}>{t(m)}</option>)}</select></div>
      {motivo === 'Altro' && <div className="field"><label htmlFor="el-alt">{t('Specifica')}</label><input id="el-alt" value={altro} onChange={e => setAltro(e.target.value)} /></div>}
      <label className="row-flex" style={{ gap: 6 }}><input type="checkbox" checked={posizioni} onChange={e => setPosizioni(e.target.checked)} />{t('Elimina anche le posizioni salvate degli impianti')}</label>
      <p className="hint">{t('Gli eliminati vanno nel Cestino e si possono ripristinare per 30 giorni. Le posizioni salvate restano, salvo la casella sopra.')}</p>
      <div className="row-flex"><button className="btn brand" disabled={!finale || occ} onClick={vai}>{occ ? t('Eliminazione…') : t('Elimina')}</button>
        <button className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
    </Modal>
  );
}

export async function eliminaInterventi(ids: number[], s: SceltaElimina): Promise<number> {
  const r = await rpc<{ eliminati: number }>('elimina_interventi', { p_ids: ids, p_motivo: s.motivo, p_posizioni: s.posizioni });
  return r.eliminati;
}

interface Elim { id: number; numero: string | null; cliente: string | null; impianto: string | null; comune: string | null; importazione_id: number | null; eliminato_at: string; motivo_eliminazione: string | null }
interface ImpElim { id: number; file_nome: string; mese: string | null; eliminato_at: string; motivo_eliminazione: string | null }

/** Cestino: importazioni e interventi eliminati negli ultimi 30 giorni, con ripristino. */
export default function Cestino({ admin, onCambiato }: { admin: boolean; onCambiato: () => void }) {
  const { t } = useT();
  const [occ, setOcc] = useState(false);
  const limite = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, errore, reload } = useLoad(async () => {
    const [i, m] = await Promise.all([
      supabase.from('interventi_importati').select('id,numero,cliente,impianto,comune,importazione_id,eliminato_at,motivo_eliminazione').not('eliminato_at', 'is', null).gte('eliminato_at', limite).order('eliminato_at', { ascending: false }).limit(1000),
      supabase.from('importazioni').select('id,file_nome,mese,eliminato_at,motivo_eliminazione').not('eliminato_at', 'is', null).order('eliminato_at', { ascending: false }).limit(100),
    ]);
    if (i.error) throw i.error; if (m.error) throw m.error;
    return { interventi: i.data as Elim[], importazioni: m.data as ImpElim[] };
  }, []);
  async function ripristina(imp: number | null, ids: number[] | null) {
    setOcc(true);
    try { const r = await rpc<{ ripristinati: number }>('ripristina_interventi', { p_importazione: imp, p_ids: ids }); toast(t('{n} ripristinati', { n: r.ripristinati })); reload(); onCambiato(); }
    catch (e) { toast(testoErrore(e)); } finally { setOcc(false); }
  }
  async function svuota() {
    if (!confirm(t('Cancellare DEFINITIVAMENTE tutti gli elementi nel cestino? Non si può annullare.'))) return;
    setOcc(true);
    try { const r = await rpc<{ interventi: number }>('svuota_cestino', { p_giorni: 0 }); toast(t('{n} interventi cancellati definitivamente', { n: r.interventi })); reload(); }
    catch (e) { const m = testoErrore(e); toast(/svuota_cestino|function/i.test(m) ? t('Svuota cestino non ancora attivato sul database.') : m); } finally { setOcc(false); }
  }
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const perImp = new Map<number | null, Elim[]>();
  data.interventi.forEach(x => perImp.set(x.importazione_id, [...(perImp.get(x.importazione_id) ?? []), x]));
  return (<>
    <div className="section-title">{t('Cestino')} <span className="meta">{t('{n} interventi eliminati negli ultimi 30 giorni', { n: data.interventi.length })}</span><span className="spacer" />
      {admin && <button className="btn-ghost btn-sm" disabled={occ || !data.interventi.length} onClick={svuota}>{t('Svuota cestino')}</button>}</div>
    {!data.interventi.length && !data.importazioni.length && <Banner s="ok">{t('Il cestino è vuoto.')}</Banner>}
    {data.importazioni.length > 0 && <div className="table-wrap"><table><thead><tr><th>{t('Importazione eliminata')}</th><th>{t('Eliminata il')}</th><th>{t('Motivo')}</th><th /></tr></thead>
      <tbody>{data.importazioni.map(m => <tr key={m.id}><td>{m.file_nome}{m.mese ? ` · ${m.mese.slice(0, 7)}` : ''}</td><td className="mono">{new Date(m.eliminato_at).toLocaleString('it-IT')}</td><td>{m.motivo_eliminazione}</td>
        <td><button className="btn btn-sm" disabled={occ || new Date(m.eliminato_at) < new Date(limite)} onClick={() => ripristina(m.id, null)}>{t('Ripristina')}</button></td></tr>)}</tbody></table></div>}
    {[...perImp].map(([imp, l]) => <div key={imp ?? 'x'} style={{ marginTop: 16 }}>
      <div className="section-title" style={{ fontSize: 15 }}>{t('Importazione n. {n}', { n: imp ?? '—' })} <span className="meta">{l.length}</span><span className="spacer" />
        <button className="btn-ghost btn-sm" disabled={occ} onClick={() => ripristina(null, l.map(x => x.id))}>{t('Ripristina tutti')}</button></div>
      <div className="table-wrap"><table><thead><tr><th>{t('N.')}</th><th>{t('Sede')}</th><th>{t('Eliminato il')}</th><th>{t('Motivo')}</th><th /></tr></thead>
        <tbody>{l.slice(0, 200).map(x => <tr key={x.id}><td className="mono">{x.numero}</td><td>{x.cliente} – {t('sede/impianto')} {x.impianto ?? '—'}<div className="sub">{x.comune}</div></td>
          <td className="mono">{new Date(x.eliminato_at).toLocaleString('it-IT')}</td><td>{x.motivo_eliminazione}</td>
          <td><button className="btn-ghost btn-sm" disabled={occ} onClick={() => ripristina(null, [x.id])}>{t('Ripristina')}</button></td></tr>)}</tbody></table></div>
      {l.length > 200 && <p className="hint">{t('Mostrati 200 di {n}: «Ripristina tutti» li ripristina tutti.', { n: l.length })}</p>}
    </div>)}
  </>);
}
