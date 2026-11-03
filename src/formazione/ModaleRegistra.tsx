import { FormEvent, useEffect, useState } from 'react';
import { rpc, supabase } from '../lib/supabase';
import { fmtData, oggiISO } from '../lib/format';
import { Banner, Modal, toast } from '../ui';
import { caricaFile, chiediAttestato, piuMesi, type Corso, type DipBase } from './comune';

/** Scelta file: «Scatta foto» (fotocamera del telefono) o «Scegli file / PDF». Più file, con anteprima. */
export function SceltaFile({ file, onChange }: { file: File[]; onChange: (f: File[]) => void }) {
  const [anteprime, setAnteprime] = useState<string[]>([]);
  useEffect(() => {
    const u = file.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''));
    setAnteprime(u); return () => u.forEach(x => x && URL.revokeObjectURL(x));
  }, [file]);
  const aggiungi = (l: FileList | null) => { if (l) onChange([...file, ...Array.from(l)]); };
  return (
    <div className="field">
      <label>Attestato (facoltativo, anche più file)</label>
      <div className="row-flex">
        <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: 16 }}>📷 Scatta foto
          <input type="file" accept="image/*" capture="environment" hidden onChange={e => { aggiungi(e.target.files); e.target.value = ''; }} /></label>
        <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: 16 }}>📄 Scegli file o PDF
          <input type="file" accept="application/pdf,image/*" multiple hidden onChange={e => { aggiungi(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {file.length > 0 && (
        <div className="row-flex" style={{ marginTop: 8 }}>
          {file.map((f, i) => (
            <div key={i} style={{ width: 92, textAlign: 'center', fontSize: 12 }}>
              {anteprime[i] ? <img src={anteprime[i]} alt="" style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                : <div style={{ width: 92, height: 92, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-2)', fontWeight: 700 }}>PDF</div>}
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(file.filter((_, j) => j !== i))}>Togli</button>
            </div>))}
        </div>)}
    </div>
  );
}

export async function collegaFile(cdIds: number[], file: File[]) {
  for (const f of file) {
    const u = await caricaFile(f);
    const { error } = await supabase.from('corsi_attestati').insert(cdIds.map(id => ({ corso_dipendente_id: id, path: u.path, nome_file: u.nome, mime: u.mime })).slice(0, 1));
    if (error) throw new Error('Attestato non salvato. Riprova.');
    // stesso file per più dipendenti: una copia del riferimento per ognuno (percorso unico → si ricarica)
    for (const id of cdIds.slice(1)) {
      const v = await caricaFile(f);
      const r = await supabase.from('corsi_attestati').insert({ corso_dipendente_id: id, path: v.path, nome_file: v.nome, mime: v.mime });
      if (r.error) throw new Error('Attestato non salvato. Riprova.');
    }
  }
}

/** Assegna un corso a uno o più dipendenti (rinnovo = nuova registrazione, lo storico resta). */
export function ModaleAssegna({ corsi, dipendenti, corso: corso0, scelti: scelti0, titolo, onClose, onFatto }:
  { corsi: Corso[]; dipendenti: DipBase[]; corso?: number; scelti?: number[]; titolo?: string; onClose: () => void; onFatto: () => void }) {
  const attivi = corsi.filter(c => c.attivo || c.id === corso0);
  const [corso, setCorso] = useState(corso0 ? String(corso0) : '');
  const [scelti, setScelti] = useState<Set<number>>(new Set(scelti0 ?? []));
  const [soloTec, setSoloTec] = useState(true);
  const [data, setData] = useState(oggiISO());
  const [scad, setScad] = useState<string | null>(null);
  const [file, setFile] = useState<File[]>([]);
  const [ente, setEnte] = useState('');
  const [ore, setOre] = useState('');
  const [chiedi, setChiedi] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const fisso = scelti0 && scelti0.length === 1;
  const c = attivi.find(x => String(x.id) === corso);
  const auto = c?.validita_mesi != null && data ? piuMesi(data, c.validita_mesi) : null;
  const lista = dipendenti.filter(d => !soloTec || d.categoria === 'TEC' || scelti.has(d.id));
  const tocca = (id: number) => { const n = new Set(scelti); if (n.has(id)) n.delete(id); else n.add(id); setScelti(n); };

  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!c) return setErr('Scegli il corso.');
    if (!scelti.size) return setErr('Scegli almeno un dipendente.');
    if (!data || data > oggiISO()) return setErr('Indica la data del corso (non nel futuro).');
    if (scad && scad < data) return setErr('La scadenza non può essere prima della data del corso.');
    setInvio(true);
    try {
      const r = await rpc<{ id: number[] }>('formazione_registra', { p_corso: c.id, p_dipendenti: [...scelti], p_data: data, p_scadenza: scad,
        p_ente: ente || null, p_ore: ore ? Number(ore.replace(',', '.')) : null, p_note: null, p_attestato: null });
      if (file.length) await collegaFile(r.id, file);
      else if (chiedi) await chiediAttestato(r.id);
      toast((scelti.size > 1 ? `Corso registrato per ${scelti.size} dipendenti` : 'Corso registrato') + (!file.length && chiedi ? ' · attestato chiesto' : ''));
      onFatto();
    } catch (x) { setErr((x as { message?: string })?.message ?? String(x)); setInvio(false); }
  }
  const big = { fontSize: 17 };
  return (
    <Modal titolo={titolo ?? 'Assegna corso'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="field"><label htmlFor="a-c">1. Corso</label>
          <select id="a-c" style={big} value={corso} onChange={e => { setCorso(e.target.value); setScad(null); }}>
            <option value="">— scegli —</option>{attivi.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></div>
        {!fisso && (
          <div className="field"><label>2. Chi l'ha fatto? ({scelti.size} scelti)</label>
            <div className="row-flex">
              <button type="button" className={soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(true)}>Tecnici</button>
              <button type="button" className={!soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(false)}>Tutti</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setScelti(new Set([...scelti, ...lista.map(d => d.id)]))}>Tutti spuntati</button>
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
              {lista.map(d => (
                <label key={d.id} className="row-flex" style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontSize: 16 }}>
                  <input type="checkbox" checked={scelti.has(d.id)} onChange={() => tocca(d.id)} style={{ width: 20, height: 20 }} />{d.cognome} {d.nome}</label>))}
            </div></div>)}
        <div className="field"><label htmlFor="a-d">{fisso ? '2' : '3'}. Data del corso</label>
          <input id="a-d" type="date" style={big} value={data} max={oggiISO()} onChange={e => { setData(e.target.value); setScad(null); }} />
          {c && <p className="hint">{c.validita_mesi == null ? 'Questo corso non scade.' : `Scade il ${fmtData(scad ?? auto)}.`}{' '}
            {c.validita_mesi != null && <button type="button" className="btn-ghost btn-sm" onClick={() => setScad(scad ? null : auto)}>{scad ? 'Usa la scadenza automatica' : 'Cambia scadenza'}</button>}</p>}
          {scad && <input type="date" aria-label="Scadenza" value={scad} min={data} onChange={e => setScad(e.target.value || null)} />}
        </div>
        <SceltaFile file={file} onChange={setFile} />
        {file.length === 0 && <label className="row-flex" style={{ fontSize: 16 }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={chiedi} onChange={e => setChiedi(e.target.checked)} />
          Non ho l'attestato: chiedilo al dipendente (lo carica dall'app)</label>}
        <details><summary className="sub">Altri dati (facoltativi)</summary>
          <div className="row-flex" style={{ marginTop: 8 }}>
            <div className="field" style={{ flex: 2 }}><label htmlFor="a-e">Ente</label><input id="a-e" value={ente} onChange={e => setEnte(e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="a-o">Ore</label><input id="a-o" inputMode="decimal" value={ore} onChange={e => setOre(e.target.value)} /></div>
          </div></details>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" style={big} disabled={invio}>{invio ? 'Salvo…' : 'Salva'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

/** Aggiunge attestati a una registrazione esistente. */
export function ModaleAggiungiAttestato({ cdId, titolo, onClose, onFatto }: { cdId: number; titolo: string; onClose: () => void; onFatto: () => void }) {
  const [file, setFile] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); if (!file.length) return setErr('Scatta una foto o scegli un file.');
    setInvio(true); setErr(null);
    try { await collegaFile([cdId], file); toast('Attestato aggiunto'); onFatto(); }
    catch (x) { setErr((x as Error).message); setInvio(false); }
  }
  return (
    <Modal titolo={titolo} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <SceltaFile file={file} onChange={setFile} />
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{invio ? 'Carico…' : 'Salva attestato'}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
