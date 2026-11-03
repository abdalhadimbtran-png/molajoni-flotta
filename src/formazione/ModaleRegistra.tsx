import { FormEvent, useState } from 'react';
import { rpc } from '../lib/supabase';
import { fmtData, oggiISO } from '../lib/format';
import { Banner, toast } from '../ui';
import { caricaAttestato, piuMesi, type Corso } from './comune';

/** Modulo «registra corso» per uno o più dipendenti. Rinnovo = nuova registrazione (lo storico resta). */
export function ModuloRegistra({ corsi, dipendenti, corsoIniziale, onFatto, onAnnulla }:
  { corsi: Corso[]; dipendenti: number[]; corsoIniziale?: number; onFatto: () => void; onAnnulla?: () => void }) {
  const attivi = corsi.filter(c => c.attivo || c.id === corsoIniziale);
  const [corso, setCorso] = useState(corsoIniziale ? String(corsoIniziale) : '');
  const [data, setData] = useState(oggiISO());
  const [scadManuale, setScadManuale] = useState<string | null>(null);
  const [ente, setEnte] = useState('');
  const [ore, setOre] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const c = attivi.find(x => String(x.id) === corso);
  const scadAuto = c?.validita_mesi != null && data ? piuMesi(data, c.validita_mesi) : null;
  const scadenza = scadManuale ?? scadAuto;

  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!c) return setErr('Scegli il corso.');
    if (!data) return setErr('Indica la data del corso.');
    if (data > oggiISO()) return setErr('La data del corso non può essere nel futuro.');
    if (!dipendenti.length) return setErr('Scegli almeno un dipendente.');
    if (scadenza && scadenza < data) return setErr('La scadenza non può essere prima della data del corso.');
    setInvio(true);
    try {
      const path = file ? await caricaAttestato(file) : null;
      await rpc('formazione_registra', { p_corso: c.id, p_dipendenti: dipendenti, p_data: data, p_scadenza: scadManuale || null,
        p_ente: ente || null, p_ore: ore ? Number(ore.replace(',', '.')) : null, p_note: note || null, p_attestato: path });
      toast(dipendenti.length > 1 ? `Corso registrato per ${dipendenti.length} dipendenti` : 'Corso registrato');
      onFatto();
    } catch (x) { setErr(x instanceof Error ? x.message : String((x as { message?: string })?.message ?? x)); setInvio(false); }
  }
  return (
    <form className="form" onSubmit={salva}>
      <div className="field"><label htmlFor="r-corso">Corso</label>
        <select id="r-corso" value={corso} onChange={e => { setCorso(e.target.value); setScadManuale(null); }} style={{ fontSize: 17 }}>
          <option value="">— scegli il corso —</option>
          {attivi.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select></div>
      <div className="field"><label htmlFor="r-data">Data del corso (o dell'attestato)</label>
        <input id="r-data" type="date" value={data} max={oggiISO()} onChange={e => { setData(e.target.value); setScadManuale(null); }} style={{ fontSize: 17 }} /></div>
      {c && (
        <div className="field"><label htmlFor="r-scad">Scadenza</label>
          {c.validita_mesi == null && scadManuale == null
            ? <p style={{ margin: 0 }}>Questo corso non scade. <button type="button" className="btn-ghost btn-sm" onClick={() => setScadManuale(data)}>Metti una scadenza</button></p>
            : <><input id="r-scad" type="date" value={scadenza ?? ''} min={data} onChange={e => setScadManuale(e.target.value || null)} style={{ fontSize: 17 }} />
              <p className="hint">{scadManuale ? 'Scadenza scritta a mano.' : `Calcolata in automatico: ${fmtData(scadAuto)}. Puoi cambiarla se l'attestato dice diversamente.`}</p></>}
        </div>)}
      <div className="row-flex" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 2 }}><label htmlFor="r-ente">Ente / docente (facoltativo)</label><input id="r-ente" value={ente} onChange={e => setEnte(e.target.value)} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="r-ore">Ore (facoltativo)</label><input id="r-ore" inputMode="decimal" value={ore} onChange={e => setOre(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="r-note">Note (facoltative)</label><input id="r-note" value={note} onChange={e => setNote(e.target.value)} /></div>
      <div className="field"><label htmlFor="r-file">Attestato PDF o foto (facoltativo)</label>
        <input id="r-file" type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {dipendenti.length > 1 && file && <p className="hint">Lo stesso file viene collegato a tutti i dipendenti scelti.</p>}</div>
      {err && <Banner s="ko">{err}</Banner>}
      <div className="row-flex">
        <button className="btn" disabled={invio} style={{ fontSize: 17 }}>{invio ? 'Salvo…' : dipendenti.length > 1 ? `Registra per ${dipendenti.length} dipendenti` : 'Registra corso'}</button>
        {onAnnulla && <button type="button" className="btn-ghost" onClick={onAnnulla}>Annulla</button>}
      </div>
    </form>
  );
}
