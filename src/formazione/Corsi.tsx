import { FormEvent, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { testoValidita, type Corso } from './comune';

/** Catalogo dei corsi: aggiungi, rinomina, validità, obbligatorio, attivo, ordine. */
export default function Corsi() {
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('corsi').select('*').order('ordine').order('nome');
    if (error) throw error; return (data ?? []) as Corso[];
  });
  const [mod, setMod] = useState<Corso | 'nuovo' | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  async function sposta(i: number, d: -1 | 1) {
    const a = data![i], b = data![i + d]; if (!b) return;
    const oa = a.ordine === b.ordine ? a.ordine + d : b.ordine, ob = a.ordine === b.ordine ? b.ordine : a.ordine;
    const r = await Promise.all([supabase.from('corsi').update({ ordine: oa }).eq('id', a.id), supabase.from('corsi').update({ ordine: ob }).eq('id', b.id)]);
    const e = r.find(x => x.error)?.error; if (e) toast(testoErrore(e)); reload();
  }
  return (
    <>
      <div className="page-hero"><div><h1>Corsi</h1>
        <p className="sub">L'elenco dei corsi che si possono registrare. I corsi già presenti sono <b>esempi da verificare</b> con il RSPP o il consulente: durata e obbligo vanno confermati dall'azienda.</p></div>
        <button className="btn" onClick={() => setMod('nuovo')}>+ Nuovo corso</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ordine</th><th>Corso</th><th>Validità</th><th>Obbligatorio tecnici</th><th>Stato</th><th></th></tr></thead>
        <tbody>{data.map((c, i) => (
          <tr key={c.id}>
            <td><div className="row-flex">
              <button className="btn-ghost btn-sm" aria-label="Sposta su" disabled={i === 0} onClick={() => sposta(i, -1)}>↑</button>
              <button className="btn-ghost btn-sm" aria-label="Sposta giù" disabled={i === data.length - 1} onClick={() => sposta(i, 1)}>↓</button></div></td>
            <td><b>{c.nome}</b>{c.descrizione && <div className="sub">{c.descrizione}</div>}</td>
            <td>{testoValidita(c.validita_mesi)}</td>
            <td>{c.obbligatorio_per_tec ? 'Sì' : 'No'}</td>
            <td>{c.attivo ? <Pill s="ok">Attivo</Pill> : <Pill s="na">Non attivo</Pill>}</td>
            <td><button className="btn-ghost btn-sm" onClick={() => setMod(c)}>Modifica</button></td>
          </tr>))}</tbody>
      </table></div>
      {mod && <ModaleCorso c={mod === 'nuovo' ? null : mod} ordine={(data[data.length - 1]?.ordine ?? 0) + 10} onClose={() => setMod(null)} onSalvato={() => { setMod(null); reload(); }} />}
    </>
  );
}

function ModaleCorso({ c, ordine, onClose, onSalvato }: { c: Corso | null; ordine: number; onClose: () => void; onSalvato: () => void }) {
  const [f, setF] = useState({ nome: c?.nome ?? '', descrizione: c?.descrizione ?? '', scade: c ? c.validita_mesi != null : true,
    mesi: String(c?.validita_mesi ?? 60), obbl: c?.obbligatorio_per_tec ?? false, attivo: c?.attivo ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const mesi = f.scade ? Number(f.mesi) : null;
    if (f.nome.trim().length < 2) return setErr('Scrivi il nome del corso.');
    if (mesi != null && (!Number.isInteger(mesi) || mesi < 1 || mesi > 240)) return setErr('La validità deve essere tra 1 e 240 mesi.');
    setInvio(true);
    const rec = { nome: f.nome.trim(), descrizione: f.descrizione.trim() || null, validita_mesi: mesi, obbligatorio_per_tec: f.obbl, attivo: f.attivo };
    const { error } = c ? await supabase.from('corsi').update(rec).eq('id', c.id) : await supabase.from('corsi').insert({ ...rec, ordine });
    setInvio(false);
    if (error) return setErr(error.message.includes('duplicate') ? 'Esiste già un corso con questo nome.' : testoErrore(error));
    toast('Corso salvato'); onSalvato();
  }
  return (
    <Modal titolo={c ? 'Modifica corso' : 'Nuovo corso'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="field"><label htmlFor="c-nome">Nome del corso</label><input id="c-nome" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} maxLength={120} autoFocus /></div>
        <div className="field"><label htmlFor="c-desc">Descrizione (facoltativa)</label><input id="c-desc" value={f.descrizione} onChange={e => setF({ ...f, descrizione: e.target.value })} /></div>
        <label className="row-flex"><input type="checkbox" checked={f.scade} onChange={e => setF({ ...f, scade: e.target.checked })} /> Il corso scade</label>
        {f.scade && <div className="field"><label htmlFor="c-mesi">Validità in mesi (60 = 5 anni)</label><input id="c-mesi" type="number" min={1} max={240} value={f.mesi} onChange={e => setF({ ...f, mesi: e.target.value })} /></div>}
        <label className="row-flex"><input type="checkbox" checked={f.obbl} onChange={e => setF({ ...f, obbl: e.target.checked })} /> Obbligatorio per tutti i tecnici</label>
        <label className="row-flex"><input type="checkbox" checked={f.attivo} onChange={e => setF({ ...f, attivo: e.target.checked })} /> Attivo (si può registrare)</label>
        {c && c.validita_mesi !== (f.scade ? Number(f.mesi) : null) && <p className="hint">La nuova validità vale per i corsi che registri da adesso. Le scadenze già salvate non cambiano.</p>}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
