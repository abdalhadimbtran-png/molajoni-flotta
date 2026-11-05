import { FormEvent, useEffect, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { indiceStadio, type Flusso, type Pratica, type Stadio } from '../lib/centralino/tipi';
import { giornoRoma } from '../lib/centralino/sla';

/** Avanza lo stato: i passi semplici in un clic, quelli con dati (appuntamento, Taylor, esito) chiedono solo il necessario. */
export default function Avanza({ p, f, stadio, onClose, onFatto }: { p: Pratica; f: Flusso; stadio?: Stadio | null; onClose: () => void; onFatto: () => void }) {
  const i = indiceStadio(f, p.stato_corrente);
  const successivi = f.stadi.slice(i + 1);
  const [s, setS] = useState<Stadio | undefined>(stadio ?? successivi[0]);
  const [data, setData] = useState(p.appuntamento_data ?? '');
  const [fascia, setFascia] = useState(p.appuntamento_fascia ?? '');
  const [taylor, setTaylor] = useState(true);
  const [tecnico, setTecnico] = useState(p.tecnico_nome ?? '');
  const [tecnici, setTecnici] = useState<{ id: number; nome: string }[]>([]);
  const [esito, setEsito] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  useEffect(() => { if (s?.azione === 'taylor' && !tecnici.length) rpc<{ id: number; nome: string }[]>('centralino_persone', {}).then(setTecnici, () => undefined); }, [s, tecnici.length]);

  async function salva(e?: FormEvent) {
    e?.preventDefault(); if (!s) return; setErr(null);
    const dati: Record<string, unknown> = {};
    if (s.azione === 'appuntamento') { if (!data || !fascia) { setErr('Indica data e fascia.'); return; } dati.appuntamento_data = data; dati.appuntamento_fascia = fascia; }
    if (s.azione === 'taylor') { dati.alert_taylor = taylor; if (tecnico) dati.tecnico_nome = tecnico; }
    if (s.azione === 'esito') { if (!esito) { setErr('Scegli l\'esito.'); return; } dati.esito_offerta = esito; }
    setInvio(true);
    try {
      await rpc('centralino_avanza', { p_id: p.id, p_stadio: s.key, p_dati: dati, p_testo: nota || null });
      toast(`${p.numero}: ${s.nome}`); onFatto();
    } catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }
  if (!successivi.length) return null;
  return (
    <Modal titolo={`Avanza ${p.numero}`} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="ct-chips" role="radiogroup" aria-label="Stadio">
          {successivi.map((x, k) => <button type="button" key={x.key} role="radio" aria-checked={s?.key === x.key} className={s?.key === x.key ? 'on' : ''} onClick={() => setS(x)}>{k === 0 ? '' : '↷ '}{x.nome}</button>)}
        </div>
        {s && successivi[0].key !== s.key && <p className="hint">Salti {successivi.indexOf(s)} {successivi.indexOf(s) === 1 ? 'passo' : 'passi'}: resta scritto nella storia.</p>}
        {s?.azione === 'appuntamento' && (
          <div className="ct-riga">
            <input type="date" aria-label="Data" value={data} min={giornoRoma(new Date())} onChange={e => setData(e.target.value)} />
            <div className="segmented" role="group" aria-label="Fascia">
              <button type="button" className={fascia === 'mattina' ? 'on' : ''} onClick={() => setFascia('mattina')}>Mattina</button>
              <button type="button" className={fascia === 'pomeriggio' ? 'on' : ''} onClick={() => setFascia('pomeriggio')}>Pomeriggio</button>
            </div>
          </div>)}
        {s?.azione === 'taylor' && (<>
          <label className="check"><input type="checkbox" checked={taylor} onChange={e => setTaylor(e.target.checked)} /> Alert inviato su Taylor</label>
          <div className="field"><label htmlFor="av-tec">Tecnico (facoltativo)</label>
            <input id="av-tec" list="av-tecnici" value={tecnico} onChange={e => setTecnico(e.target.value)} />
            <datalist id="av-tecnici">{tecnici.map(t => <option key={t.id} value={t.nome} />)}</datalist></div>
        </>)}
        {s?.azione === 'esito' && (
          <div className="ct-chips" role="radiogroup" aria-label="Esito">
            {[['accettata', 'Accettata'], ['rifiutata', 'Rifiutata'], ['in_attesa', 'In attesa']].map(([v, l]) => (
              <button type="button" key={v} role="radio" aria-checked={esito === v} className={`${esito === v ? 'on' : ''} ${v === 'rifiutata' ? 'urg' : ''}`} onClick={() => setEsito(v)}>{l}</button>))}
          </div>)}
        {s?.azione === 'esito' && esito === 'rifiutata' && <p className="hint">La pratica si chiude con esito negativo.</p>}
        {s && s.key === f.stadi[f.stadi.length - 1].key && <p className="hint">È l'ultimo passo: la pratica si chiude.</p>}
        <div className="field"><label htmlFor="av-nota">Nota (facoltativa)</label><input id="av-nota" value={nota} onChange={e => setNota(e.target.value)} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio || !s}>{invio ? 'Salvo…' : `Conferma: ${s?.nome ?? ''}`}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

/** Passi senza dati da chiedere: si può avanzare con un clic. */
export const avanzaDiretto = (s: Stadio | null | undefined) => !!s && !s.azione;
