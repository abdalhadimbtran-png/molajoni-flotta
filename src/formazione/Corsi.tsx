import { FormEvent, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { ModaleAssegna } from './ModaleRegistra';
import { caricaTutto, testoValidita, type Corso } from './comune';

const DURATE: [number, string][] = [[6, '6 mesi'], [12, '1 anno'], [24, '2 anni'], [36, '3 anni'], [48, '4 anni'], [60, '5 anni'], [120, '10 anni']];

/** Passo 1: i corsi. Passo 2: «Assegna» a uno o più tecnici. */
export default function Corsi() {
  const { data, errore, reload } = useLoad(caricaTutto);
  const [mod, setMod] = useState<Corso | 'nuovo' | null>(null);
  const [assegna, setAssegna] = useState<Corso | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="page-hero"><div><h1>Corsi</h1>
        <p className="sub">I corsi già presenti sono <b>esempi da verificare</b> con il RSPP: durata e obbligo li decide l'azienda.</p></div>
        <button className="btn" style={{ fontSize: 17 }} onClick={() => setMod('nuovo')}>+ Nuovo corso</button></div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {data.corsi.map(c => {
          const n = data.registrazioni.filter(r => r.attuale && r.corso_id === c.id).length;
          return (
            <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 16, background: 'var(--surface)', opacity: c.attivo ? 1 : 0.6 }}>
              <b style={{ fontSize: 17 }}>{c.nome}</b>
              {c.descrizione && <p className="sub" style={{ margin: '4px 0' }}>{c.descrizione}</p>}
              <div className="row-flex" style={{ margin: '8px 0' }}>
                <Pill s="na">{testoValidita(c.validita_mesi)}</Pill>
                {c.obbligatorio_per_tec && <Pill s="info">Obbligatorio tecnici</Pill>}
                {!c.attivo && <Pill s="na">Non attivo</Pill>}
                <span className="sub">{n} {n === 1 ? 'persona' : 'persone'}</span>
              </div>
              <div className="row-flex">
                {c.attivo && <button className="btn" onClick={() => setAssegna(c)}>Assegna a tecnici</button>}
                <button className="btn-ghost" onClick={() => setMod(c)}>Modifica</button>
              </div>
            </div>);
        })}
      </div>
      {mod && <ModaleCorso c={mod === 'nuovo' ? null : mod} ordine={(data.corsi[data.corsi.length - 1]?.ordine ?? 0) + 10} onClose={() => setMod(null)} onSalvato={() => { setMod(null); reload(); }} />}
      {assegna && <ModaleAssegna corsi={data.corsi} dipendenti={data.dip} corso={assegna.id} titolo={`Assegna: ${assegna.nome}`} onClose={() => setAssegna(null)} onFatto={() => { setAssegna(null); reload(); }} />}
    </>
  );
}

function SiNo({ v, onChange, label }: { v: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <div className="field"><label>{label}</label>
      <div className="row-flex">
        <button type="button" className={v ? 'btn' : 'btn-ghost'} style={{ minWidth: 80, fontSize: 17 }} onClick={() => onChange(true)} aria-pressed={v}>Sì</button>
        <button type="button" className={!v ? 'btn' : 'btn-ghost'} style={{ minWidth: 80, fontSize: 17 }} onClick={() => onChange(false)} aria-pressed={!v}>No</button>
      </div></div>
  );
}

function ModaleCorso({ c, ordine, onClose, onSalvato }: { c: Corso | null; ordine: number; onClose: () => void; onSalvato: () => void }) {
  const m0 = c?.validita_mesi ?? 60;
  const [f, setF] = useState({ nome: c?.nome ?? '', descrizione: c?.descrizione ?? '', scade: c ? c.validita_mesi != null : true,
    mesi: m0, altro: !DURATE.some(d => d[0] === m0), obbl: c?.obbligatorio_per_tec ?? false, attivo: c?.attivo ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (f.nome.trim().length < 2) return setErr('Scrivi il nome del corso.');
    const mesi = f.scade ? Math.round(f.mesi) : null;
    if (mesi != null && (mesi < 1 || mesi > 240)) return setErr('La durata deve essere tra 1 e 240 mesi.');
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
        <div className="field"><label htmlFor="c-nome">Nome del corso</label><input id="c-nome" style={{ fontSize: 17 }} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} maxLength={120} autoFocus /></div>
        <div className="field"><label htmlFor="c-desc">Breve descrizione (facoltativa)</label><input id="c-desc" value={f.descrizione} onChange={e => setF({ ...f, descrizione: e.target.value })} /></div>
        <SiNo label="Ha una scadenza?" v={f.scade} onChange={b => setF({ ...f, scade: b })} />
        {f.scade && (
          <div className="field"><label htmlFor="c-dur">Vale per</label>
            <select id="c-dur" style={{ fontSize: 17 }} value={f.altro ? 'altro' : String(f.mesi)}
              onChange={e => e.target.value === 'altro' ? setF({ ...f, altro: true }) : setF({ ...f, altro: false, mesi: Number(e.target.value) })}>
              {DURATE.map(([m, l]) => <option key={m} value={m}>{l}</option>)}<option value="altro">Altro (in mesi)…</option>
            </select>
            {f.altro && <input type="number" min={1} max={240} aria-label="Mesi" value={f.mesi} onChange={e => setF({ ...f, mesi: Number(e.target.value) })} />}
          </div>)}
        <SiNo label="Obbligatorio per tutti i tecnici?" v={f.obbl} onChange={b => setF({ ...f, obbl: b })} />
        {c && <SiNo label="Attivo?" v={f.attivo} onChange={b => setF({ ...f, attivo: b })} />}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" style={{ fontSize: 17 }} disabled={invio}>Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
