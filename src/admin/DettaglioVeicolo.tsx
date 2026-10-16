import { FormEvent, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { TIPI_DOC, TIPI_DOTAZIONE, fmtData, giorniA } from '../lib/format';
import { useT } from '../lib/i18n';
import type { Veicolo } from '../lib/tipi';
import { Banner, Caricamento, Modal, Pill, toast, useLoad } from '../ui';

interface Dot { id: number; tipo: string; descrizione: string | null; matricola: string | null; scadenza: string | null; attiva: boolean }
interface Doc { id: number; tipo: string; titolo: string; path: string; caricato_il: string }

/** Dotazioni di bordo e documenti di un veicolo. */
export default function DettaglioVeicolo({ v, onClose }: { v: Veicolo; onClose: () => void }) {
  const { t, tm } = useT();
  const { data, reload } = useLoad(async () => {
    const [d, c] = await Promise.all([
      supabase.from('dotazioni').select('*').eq('veicolo_id', v.id).eq('attiva', true).order('tipo'),
      supabase.from('documenti').select('id,tipo,titolo,path,caricato_il').eq('veicolo_id', v.id).order('tipo'),
    ]);
    if (d.error) throw d.error; if (c.error) throw c.error;
    return { dot: d.data as Dot[], doc: c.data as Doc[] };
  }, [v.id]);
  const [nd, setNd] = useState({ tipo: 'estintore', descrizione: '', matricola: '', scadenza: '' });
  const [ndoc, setNdoc] = useState<{ tipo: string; titolo: string; file: File | null }>({ tipo: 'libretto', titolo: '', file: null });
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  async function aggiungiDot(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('dotazioni').insert({ veicolo_id: v.id, tipo: nd.tipo, descrizione: nd.descrizione || null, matricola: nd.matricola || null, scadenza: nd.scadenza || null });
    if (error) { setErr(tm(testoErrore(error))); return; }
    setNd({ ...nd, descrizione: '', matricola: '', scadenza: '' }); reload();
  }
  async function togliDot(id: number) {
    const { error } = await supabase.from('dotazioni').update({ attiva: false }).eq('id', id);
    if (error) toast(tm(testoErrore(error))); else reload();
  }
  async function caricaDoc(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!ndoc.file) return;
    setInvio(true);
    try {
      const est = ndoc.file.name.split('.').pop()?.toLowerCase() ?? 'pdf';
      const path = `veicoli/${v.id}/${ndoc.tipo}-${crypto.randomUUID()}.${est}`;
      const up = await supabase.storage.from('documenti').upload(path, ndoc.file, { contentType: ndoc.file.type, upsert: false });
      if (up.error) throw up.error;
      const { data: u } = await supabase.auth.getUser();
      const ins = await supabase.from('documenti').insert({ veicolo_id: v.id, tipo: ndoc.tipo, titolo: ndoc.titolo.trim() || ndoc.file.name, path, mime: ndoc.file.type, dimensione: ndoc.file.size, caricato_da: u.user?.id });
      if (ins.error) throw ins.error;
      setNdoc({ tipo: 'libretto', titolo: '', file: null }); toast(t('Documento caricato')); reload();
    } catch (x) { setErr(tm(testoErrore(x))); }
    finally { setInvio(false); }
  }
  async function apriDoc(d: Doc) {
    const s = await supabase.storage.from('documenti').createSignedUrl(d.path, 300);
    if (s.error) toast(tm(testoErrore(s.error))); else window.open(s.data.signedUrl, '_blank', 'noopener');
  }
  async function eliminaDoc(d: Doc) {
    await supabase.storage.from('documenti').remove([d.path]);
    const { error } = await supabase.from('documenti').delete().eq('id', d.id);
    if (error) toast(tm(testoErrore(error))); else reload();
  }

  return (
    <Modal titolo={`${v.targa} · ${v.marca_modello}`} onClose={onClose}>
      {!data ? <Caricamento /> : <div className="form">
        <h2>{t('Dotazioni di bordo')}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Tipo')}</th><th>{t('Descrizione')}</th><th>{t('Scadenza')}</th><th></th></tr></thead>
          <tbody>{data.dot.length ? data.dot.map(d => { const g = giorniA(d.scadenza); return (
            <tr key={d.id}><td>{t(TIPI_DOTAZIONE[d.tipo])}</td><td>{d.descrizione ?? '—'}<div className="sub mono">{d.matricola}</div></td>
              <td>{d.scadenza ? <div className="scad"><Pill s={g! < 0 ? 'warn' : g! <= 30 ? 'warn' : 'ok'}>{g! < 0 ? t('Scaduta') : g! <= 30 ? t('Tra {n} gg', { n: g! }) : t('Valida')}</Pill><span className="mono sub">{fmtData(d.scadenza)}</span></div> : '—'}</td>
              <td><button className="btn-ghost btn-sm" onClick={() => togliDot(d.id)}>{t('Togli')}</button></td></tr>); })
            : <tr><td colSpan={4} className="sub">{t('Nessuna dotazione registrata')}</td></tr>}</tbody>
        </table></div>
        <form className="row-flex wrap-end" onSubmit={aggiungiDot}>
          <div className="field"><label htmlFor="d-t">{t('Tipo')}</label><select id="d-t" value={nd.tipo} onChange={e => setNd({ ...nd, tipo: e.target.value })}>
            {Object.entries(TIPI_DOTAZIONE).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          <div className="field"><label htmlFor="d-d">{t('Descrizione')}</label><input id="d-d" value={nd.descrizione} onChange={e => setNd({ ...nd, descrizione: e.target.value })} /></div>
          <div className="field"><label htmlFor="d-m">{t('Matricola')}</label><input id="d-m" dir="ltr" value={nd.matricola} onChange={e => setNd({ ...nd, matricola: e.target.value })} /></div>
          <div className="field"><label htmlFor="d-s">{t('Scadenza')}</label><input id="d-s" type="date" value={nd.scadenza} onChange={e => setNd({ ...nd, scadenza: e.target.value })} /></div>
          <button className="btn btn-sm">{t('Aggiungi')}</button>
        </form>

        <h2 style={{ marginTop: 10 }}>{t('Documenti')}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Tipo')}</th><th>{t('Titolo')}</th><th></th></tr></thead>
          <tbody>{data.doc.length ? data.doc.map(d => <tr key={d.id}><td>{t(TIPI_DOC[d.tipo])}</td><td>{d.titolo}<div className="sub">{fmtData(d.caricato_il)}</div></td>
            <td className="nowrap actions"><button className="btn-ghost btn-sm" onClick={() => apriDoc(d)}>{t('Apri')}</button><button className="btn-ghost btn-sm" onClick={() => eliminaDoc(d)}>{t('Elimina')}</button></td></tr>)
            : <tr><td colSpan={3} className="sub">{t('Nessun documento caricato')}</td></tr>}</tbody>
        </table></div>
        <form className="row-flex wrap-end" onSubmit={caricaDoc}>
          <div className="field"><label htmlFor="c-t">{t('Tipo')}</label><select id="c-t" value={ndoc.tipo} onChange={e => setNdoc({ ...ndoc, tipo: e.target.value })}>
            {Object.entries(TIPI_DOC).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          <div className="field"><label htmlFor="c-n">{t('Titolo')}</label><input id="c-n" value={ndoc.titolo} onChange={e => setNdoc({ ...ndoc, titolo: e.target.value })} /></div>
          <div className="field"><label htmlFor="c-f">{t('File (PDF o foto)')}</label><input id="c-f" type="file" accept="application/pdf,image/*" onChange={e => setNdoc({ ...ndoc, file: e.target.files?.[0] ?? null })} /></div>
          <button className="btn btn-sm" disabled={!ndoc.file || invio}>{t('Carica')}</button>
        </form>
        <p className="hint">{t('I tecnici vedono i documenti nella pagina del veicolo dopo la scansione del QR. La copia digitale non sostituisce l\'originale a bordo.')}</p>
        {err && <Banner s="ko">{err}</Banner>}
      </div>}
    </Modal>
  );
}
