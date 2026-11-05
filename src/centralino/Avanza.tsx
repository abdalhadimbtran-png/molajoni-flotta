import { FormEvent, useEffect, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { prossimoStadio, type Commerciale, type Flusso, type Pratica } from '../lib/centralino/tipi';
import { giornoRoma } from '../lib/centralino/sla';
import { useConfig } from './comune';

export interface Prossimo { key: string; nome: string; mancanti: string[] }
export const prossimoDi = (id: number) => rpc<Prossimo | null>('centralino_prossimo', { p_id: id });

/**
 * Avanza al passo SUCCESSIVO (mai salti). Chiede solo i dati che il passo richiede;
 * l'email si invia dal compositore (pulsante qui sotto) e poi il passo si sblocca.
 */
export default function Avanza({ p, f, onClose, onFatto, onEmail }: { p: Pratica; f: Flusso; stadio?: unknown; onClose: () => void; onFatto: () => void; onEmail?: (template?: string) => void }) {
  const { config } = useConfig();
  const s = prossimoStadio(f, p);
  const req = s?.requisiti ?? [];
  const [mancanti, setMancanti] = useState<string[] | null>(null);
  const [data, setData] = useState(p.appuntamento_data ?? '');
  const [fascia, setFascia] = useState(p.appuntamento_fascia ?? '');
  const [taylor, setTaylor] = useState(p.alert_taylor);
  const [doc, setDoc] = useState(p.documento_intervento ?? '');
  const [tecnico, setTecnico] = useState(p.tecnico_nome ?? '');
  const [tecnici, setTecnici] = useState<{ id: number; nome: string }[]>([]);
  const [comm, setComm] = useState(p.commerciale_nome ?? '');
  const [commerciali, setCommerciali] = useState<Commerciale[]>([]);
  const [dest, setDest] = useState(p.assegnato_nome ?? '');
  const [esito, setEsito] = useState('');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  useEffect(() => { prossimoDi(p.id).then(x => setMancanti(x?.mancanti ?? []), () => setMancanti([])); }, [p.id]);
  useEffect(() => { if (req.includes('taylor')) rpc<{ id: number; nome: string }[]>('centralino_persone', {}).then(setTecnici, () => undefined); }, [req.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (req.includes('commerciale') && p.tipo === 'offerta_grande') rpc<Commerciale[]>('centralino_commerciali', {}).then(setCommerciali, () => undefined); }, [req.join(), p.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const elencoComm = p.tipo === 'offerta_grande' ? commerciali.map(c => ({ nome: c.nome, email: c.email ?? '', nota: c.disponibile ? 'disponibile' : c.assente ? 'assente oggi' : 'occupato' }))
    : (config?.impostazioni.commerciali ?? []).map(c => ({ ...c, nota: '' }));
  const destinatari = config?.impostazioni.destinatari_trasferimento ?? [];
  const manca = (k: string) => (mancanti ?? []).some(m => m.toLowerCase().includes(k));

  async function salva(e?: FormEvent) {
    e?.preventDefault(); if (!s) return; setErr(null);
    const dati: Record<string, unknown> = {};
    if (req.includes('appuntamento')) { dati.appuntamento_data = data; dati.appuntamento_fascia = fascia; }
    if (req.includes('taylor')) { dati.alert_taylor = taylor; dati.documento_intervento = doc; if (tecnico) dati.tecnico_nome = tecnico; }
    if (req.includes('commerciale') && comm) { dati.commerciale_nome = comm; dati.commerciale_email = elencoComm.find(c => c.nome === comm)?.email || null; }
    if (req.includes('destinatario') && dest) dati.assegnato_nome = dest;
    if (req.includes('esito')) dati.esito_offerta = esito;
    setInvio(true);
    try { await rpc('centralino_avanza', { p_id: p.id, p_stadio: s.key, p_dati: dati, p_testo: nota || null }); toast(`${p.numero}: ${s.nome}`); onFatto(); }
    catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }
  const emailMancante = req.includes('email') && manca('email');
  return (
    <Modal titolo={`Prossimo passo: ${s.nome}`} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="hint">Si procede un passo alla volta. {s.key === f.stadi[f.stadi.length - 1].key ? 'È l\'ultimo passo: la pratica si chiude.' : ''}</p>
        {req.includes('appuntamento') && (
          <div className="ct-riga">
            <input type="date" aria-label="Data" value={data} min={giornoRoma(new Date())} onChange={e => setData(e.target.value)} />
            <select aria-label="Fascia" value={fascia} onChange={e => setFascia(e.target.value)}><option value="">— fascia —</option><option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option></select>
          </div>)}
        {req.includes('taylor') && (<>
          <label className="check"><input type="checkbox" checked={taylor} onChange={e => setTaylor(e.target.checked)} /> Alert inviato su Taylor con il Documento di Intervento</label>
          <div className="ct-griglia">
            <div className="field"><label htmlFor="av-doc">N. Documento di Intervento</label><input id="av-doc" value={doc} onChange={e => setDoc(e.target.value)} /></div>
            <div className="field"><label htmlFor="av-tec">Tecnico</label>
              <select id="av-tec" value={tecnico} onChange={e => setTecnico(e.target.value)}><option value="">— facoltativo —</option>{tecnici.map(t => <option key={t.id}>{t.nome}</option>)}</select></div>
          </div>
        </>)}
        {req.includes('commerciale') && (
          <div className="field"><label htmlFor="av-com">Commerciale</label>
            <select id="av-com" value={comm} onChange={e => setComm(e.target.value)}><option value="">— scegli —</option>{elencoComm.map(c => <option key={c.nome} value={c.nome}>{c.nome}{c.nota ? ` · ${c.nota}` : ''}</option>)}</select></div>)}
        {req.includes('destinatario') && (
          <div className="field"><label htmlFor="av-dest">Girata a</label>
            <select id="av-dest" value={dest} onChange={e => setDest(e.target.value)}><option value="">— scegli —</option>{destinatari.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.nota ? ` · ${d.nota}` : ''}</option>)}</select></div>)}
        {req.includes('esito') && (
          <div className="field"><label htmlFor="av-es">Esito</label>
            <select id="av-es" value={esito} onChange={e => setEsito(e.target.value)}><option value="">— scegli —</option><option value="accettata">Accettata</option><option value="rifiutata">Rifiutata (la pratica si chiude)</option><option value="in_attesa">In attesa</option></select></div>)}
        {emailMancante && <Banner s="warn">Questo passo richiede l'email al cliente. <button type="button" className="ct-link" onClick={() => onEmail?.(s.template)}>Scrivi l'email</button> (dopo l'invio puoi segnare il passo come fatto).</Banner>}
        <div className="field"><label htmlFor="av-nota">Nota (facoltativa)</label><input id="av-nota" value={nota} onChange={e => setNota(e.target.value)} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio || emailMancante}>{invio ? 'Salvo…' : `Fatto: ${s.nome}`}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

/** Passi senza dati da chiedere: si può avanzare con un clic. */
export const avanzaDiretto = (s: { requisiti?: string[] } | null | undefined) => !!s && !(s.requisiti?.length);
