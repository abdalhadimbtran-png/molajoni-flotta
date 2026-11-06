import { FormEvent, useEffect, useMemo, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { prossimoStadio, type Commerciale, type Flusso, type PersonaDisp, type Pratica, type TecnicoDisp, type Template } from '../lib/centralino/tipi';
import { giornoRoma } from '../lib/centralino/sla';
import { compila, guscioEmail, inTesto, segnaposto } from '../lib/centralino/modelli';
import { useConfig } from './comune';

export interface Prossimo { key: string; nome: string; mancanti: string[] }
export const prossimoDi = (id: number) => rpc<Prossimo | null>('centralino_prossimo', { p_id: id });

const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const QUANDO = ['entro 30 minuti', 'entro 1 ora', 'entro 2 ore', 'oggi in mattinata', 'oggi pomeriggio', 'domani mattina', 'domani pomeriggio'];
const quandoDefault = (p: Pratica) => (p.urgenza === 'ordinario' ? 'domani mattina' : 'entro 1 ora');

/** Email pronta da modello per la pratica (destinatario scelto dal passo). */
export function componi(t: Template, p: Pratica, firma: string, a: string, extra: Partial<Pratica> = {}, ccOfferte: string[] = []) {
  const v = { ...segnaposto({ ...p, ...extra }, firma), numero_pratica: p.numero };
  const corpo = compila(t.corpo_html, v);
  const cc = [...t.cc_default, ...(t.cc_offerte_grandi ? ccOfferte : [])];
  if (t.codice === 'sopralluogo_cliente' && p.commerciale_email) cc.push(p.commerciale_email);
  return { a, cc: [...new Set(cc.filter(Boolean))], oggetto: compila(t.oggetto, v, false), html: guscioEmail(corpo), corpo, testo: inTesto(corpo) };
}

/**
 * Prossimo passo (mai salti) in UNA schermata, con azioni combinate:
 * «Invia email al coordinatore e avanti», «Conferma e informa il cliente», «Chiudi».
 * Scorciatoia: Invio = azione principale, Esc = chiudi.
 */
export default function Avanza({ p, f, onClose, onFatto, onEmail }: { p: Pratica; f: Flusso; stadio?: unknown; onClose: () => void; onFatto: () => void; onEmail?: (template?: string) => void }) {
  const { config } = useConfig();
  const s = prossimoStadio(f, p);
  const req = s?.requisiti ?? [];
  const has = (r: string) => (req as string[]).includes(r);
  const ultimo = !!s && s.key === f.stadi[f.stadi.length - 1].key;
  const idx = s ? f.stadi.findIndex(x => x.key === s.key) : -1;
  const dopo = idx >= 0 ? f.stadi[idx + 1] : undefined;
  const firma = String(config?.impostazioni.firma ?? '');
  const modello = (c?: string) => (c ? config?.modelli.find(m => m.codice === c && m.attivo) : undefined);

  const [coord, setCoord] = useState<PersonaDisp[]>([]);
  const [coordNome, setCoordNome] = useState(p.coordinatore_nome ?? '');
  const [telefonato, setTelefonato] = useState(!!p.coordinatore_telefonato);
  const [tecnici, setTecnici] = useState<TecnicoDisp[]>([]);
  const [tecId, setTecId] = useState<number | ''>(p.tecnico_dipendente_id ?? '');
  const [quando, setQuando] = useState(p.tecnico_quando ?? quandoDefault(p));
  const [quandoAt, setQuandoAt] = useState('');
  const [doc, setDoc] = useState(p.documento_intervento ?? '');
  const [avvisato, setAvvisato] = useState(false);
  const [app, setApp] = useState(false);
  const [data, setData] = useState(p.appuntamento_data ?? '');
  const [fascia, setFascia] = useState(p.appuntamento_fascia ?? '');
  const [taylor, setTaylor] = useState(p.alert_taylor);
  const [comm, setComm] = useState(p.commerciale_nome ?? '');
  const [commerciali, setCommerciali] = useState<Commerciale[]>([]);
  const [dest, setDest] = useState(p.assegnato_nome ?? '');
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    if (has('coordinatore')) rpc<PersonaDisp[]>('centralino_coordinatori', { p_tipo: p.tipo }).then(l => { setCoord(l ?? []); if (!coordNome) setCoordNome((l ?? []).find(x => x.disponibile)?.nome ?? l?.[0]?.nome ?? ''); }, () => undefined);
    if (has('tecnico')) rpc<TecnicoDisp[]>('centralino_tecnici', {}).then(l => {
      setTecnici(l ?? []);
      if (!tecId) { const lib = [...(l ?? [])].filter(t => !t.assente).sort((a, b) => a.interventi_oggi - b.interventi_oggi)[0]; if (lib) setTecId(lib.id); }
    }, () => undefined);
    if (has('commerciale') && p.tipo === 'offerta_grande') rpc<Commerciale[]>('centralino_commerciali', {}).then(setCommerciali, () => undefined);
  }, [s?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tecnico = tecnici.find(t => t.id === tecId);
  const coordSel = coord.find(c => c.nome === coordNome);
  const elencoComm = p.tipo === 'offerta_grande' ? commerciali.map(c => ({ nome: c.nome, email: c.email ?? '', nota: c.disponibile ? 'disponibile' : c.assente ? 'assente oggi' : 'occupato' }))
    : (config?.impostazioni.commerciali ?? []).map(c => ({ ...c, nota: '' }));
  const destinatari = config?.impostazioni.destinatari_trasferimento ?? [];

  // email del passo (precompilata, anteprima chiusa)
  const tEmail = has('email') ? modello(s?.template) : undefined;
  const aEmail = !tEmail ? '' : tEmail.codice.endsWith('_coordinatore') ? (coordSel?.email ?? '') : tEmail.codice === 'riepilogo_commerciale' ? (p.commerciale_email ?? '') : (p.email ?? '');
  const ccOff = (config?.impostazioni.cc_offerte_grandi ?? []).map(x => x.email).filter(Boolean) as string[];
  const email = useMemo(() => (tEmail ? componi(tEmail, p, firma, aEmail, {}, ccOff) : null), [tEmail, p, firma, aEmail]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aMod, setAMod] = useState<string | null>(null);
  const destEmail = aMod ?? aEmail;

  // passo «cliente» successivo al tecnico: si invia insieme
  const tCliente = has('tecnico') && dopo?.requisiti?.includes('email') ? modello(dopo.template) : undefined;

  if (!s) return null;

  const inviaEmail = (e: { a: string; cc: string[]; oggetto: string; html: string; testo: string }, codice: string) =>
    rpc('centralino_invia_email', { p_id: p.id, p_template: codice, p_a: e.a.trim(), p_cc: e.cc, p_oggetto: e.oggetto, p_html: e.html, p_testo: e.testo, p_modo: 'resend', p_avanza: null });
  const avanza = (key: string, dati: Record<string, unknown>) => rpc('centralino_avanza', { p_id: p.id, p_stadio: key, p_dati: dati, p_testo: nota || null });

  async function salva(e?: FormEvent) {
    e?.preventDefault(); if (!s) return; setErr(null);
    const dati: Record<string, unknown> = {};
    if (has('coordinatore')) {
      if (!coordNome) return setErr('Scegli il coordinatore.');
      if (!telefonato) return setErr('Spunta «Telefonato» dopo averlo chiamato.');
      dati.coordinatore_nome = coordNome; dati.coordinatore_telefonato = true;
    }
    if (has('tecnico')) {
      if (!tecnico) return setErr('Scegli il tecnico.');
      if (!quando && !quandoAt) return setErr('Indica quando passa il tecnico.');
      const q = quandoAt ? `il ${new Date(quandoAt).toLocaleString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : quando;
      Object.assign(dati, { tecnico_nome: tecnico.nome, tecnico_dipendente_id: tecnico.id, tecnico_quando: q, tecnico_quando_at: quandoAt ? new Date(quandoAt).toISOString() : null });
    }
    if (has('buono') || has('avviso')) {
      if (has('buono') && !doc.trim()) return setErr('Scrivi il numero del buono.');
      if (!avvisato && !app) return setErr('Spunta l\'avviso al tecnico (Taylor + WhatsApp).');
      if (doc.trim()) dati.documento_intervento = doc.trim();
      if (avvisato) { dati.alert_taylor = true; dati.whatsapp_tecnico = true; }
    }
    if (has('appuntamento')) { dati.appuntamento_data = data; dati.appuntamento_fascia = fascia; }
    if (has('taylor')) { dati.alert_taylor = taylor; dati.documento_intervento = doc; }
    if (has('commerciale') && comm) { dati.commerciale_nome = comm; dati.commerciale_email = elencoComm.find(c => c.nome === comm)?.email || null; }
    if (has('destinatario') && dest) dati.assegnato_nome = dest;
    if (email && tEmail && !emailOk(destEmail)) return setErr('Manca l\'indirizzo email del destinatario.');
    setInvio(true);
    try {
      if (email && tEmail) await inviaEmail({ ...email, a: destEmail }, tEmail.codice);
      if (app) await rpc('centralino_avviso_tecnico', { p_id: p.id });
      await avanza(s.key, dati);
      if (tCliente && dopo) {
        if (emailOk(p.email)) {
          const ec = componi(tCliente, p, firma, p.email!, { tecnico_nome: String(dati.tecnico_nome), tecnico_quando: String(dati.tecnico_quando) });
          await inviaEmail(ec, tCliente.codice);
          await avanza(dopo.key, {});
          toast(`${p.numero}: tecnico ${dati.tecnico_nome} · cliente informato`);
        } else { toast(`${p.numero}: tecnico ${dati.tecnico_nome}. Manca l'email del cliente: informalo per telefono o scrivi l'email.`); onFatto(); onEmail?.(dopo.template); return; }
      } else toast(ultimo ? `${p.numero}: pratica chiusa` : `${p.numero}: ${s.nome}`);
      onFatto();
    } catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }

  const etichetta = invio ? 'Invio…'
    : has('coordinatore') ? 'Invia email al coordinatore e avanti'
    : tCliente ? 'Conferma e informa il cliente'
    : ultimo ? (email ? 'Invia e chiudi' : 'Chiudi la pratica')
    : email ? 'Invia e avanti' : `Fatto: ${s.nome}`;

  return (
    <Modal titolo={`Passo ${idx + 1} di ${f.stadi.length}: ${s.nome}`} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        {has('coordinatore') && (<>
          <div className="field"><label htmlFor="av-coord">Coordinatore</label>
            <select id="av-coord" value={coordNome} onChange={e => setCoordNome(e.target.value)}>{coord.map(c => <option key={c.nome} value={c.nome}>{c.nome} · {c.disponibile ? 'disponibile' : c.assente ? 'assente oggi' : 'occupato'}{c.telefono || c.cellulare ? ` · ${c.cellulare || c.telefono}` : ''}</option>)}</select>
            {!coord.length && <p className="hint">Nessun coordinatore: impostalo in Referenti («Coordinamento interventi/sopralluoghi»).</p>}</div>
          <button type="button" className={`btn-ghost ct-toggle ${telefonato ? 'on' : ''}`} aria-pressed={telefonato} onClick={() => setTelefonato(!telefonato)}>{telefonato ? '✓ Telefonato' : 'Telefonato'}</button>
        </>)}
        {has('tecnico') && (<>
          <div className="field"><label htmlFor="av-tec">Tecnico</label>
            <select id="av-tec" value={tecId} onChange={e => setTecId(e.target.value ? Number(e.target.value) : '')}><option value="">— scegli —</option>
              {tecnici.map(t => <option key={t.id} value={t.id}>{t.nome} · {t.assente ? 'assente oggi' : `${t.interventi_oggi} interventi oggi`}</option>)}</select></div>
          <div className="segmented ct-chips" role="group" aria-label="Quando">
            {QUANDO.map(q => <button type="button" key={q} className={!quandoAt && quando === q ? 'on' : ''} onClick={() => { setQuando(q); setQuandoAt(''); }}>{q}</button>)}
          </div>
          <div className="field"><label htmlFor="av-qat">Oppure data e ora</label><input id="av-qat" type="datetime-local" value={quandoAt} onChange={e => setQuandoAt(e.target.value)} /></div>
          {tCliente && <p className="hint">Il cliente riceve: «La contatterà il nostro tecnico {tecnico?.nome ?? '…'} {quandoAt ? 'il giorno scelto' : quando}».{!emailOk(p.email) && ' Manca l\'email del cliente.'}</p>}
        </>)}
        {(has('buono') || has('avviso')) && (<>
          {has('buono') && <div className="field"><label htmlFor="av-doc">N. buono di intervento</label><input id="av-doc" value={doc} onChange={e => setDoc(e.target.value)} autoFocus /></div>}
          <label className="check"><input type="checkbox" checked={avvisato} onChange={e => setAvvisato(e.target.checked)} /> Tecnico avvisato: alert su Taylor + WhatsApp</label>
          <label className="check"><input type="checkbox" checked={app} onChange={e => setApp(e.target.checked)} /> Invia anche l'avviso urgente nell'app{p.tecnico_dipendente_id ? '' : ' (tecnico senza app)'}</label>
          <p className="hint">Obiettivo: {p.urgenza === 'ordinario' ? 'intervento entro 2 giorni lavorativi' : 'intervento oggi'}.</p>
        </>)}
        {has('appuntamento') && (
          <div className="ct-riga">
            <input type="date" aria-label="Data" value={data} min={giornoRoma(new Date())} onChange={e => setData(e.target.value)} />
            <select aria-label="Fascia" value={fascia} onChange={e => setFascia(e.target.value)}><option value="">— fascia —</option><option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option></select>
          </div>)}
        {has('taylor') && (<>
          <label className="check"><input type="checkbox" checked={taylor} onChange={e => setTaylor(e.target.checked)} /> Alert inviato su Taylor</label>
          <div className="field"><label htmlFor="av-doc2">N. Documento di Intervento</label><input id="av-doc2" value={doc} onChange={e => setDoc(e.target.value)} /></div>
        </>)}
        {has('commerciale') && (
          <div className="field"><label htmlFor="av-com">Commerciale</label>
            <select id="av-com" value={comm} onChange={e => setComm(e.target.value)}><option value="">— scegli —</option>{elencoComm.map(c => <option key={c.nome} value={c.nome}>{c.nome}{c.nota ? ` · ${c.nota}` : ''}</option>)}</select></div>)}
        {has('destinatario') && (
          <div className="field"><label htmlFor="av-dest">Girata a</label>
            <select id="av-dest" value={dest} onChange={e => setDest(e.target.value)}><option value="">— scegli —</option>{destinatari.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.nota ? ` · ${d.nota}` : ''}</option>)}</select></div>)}
        {has('email') && !tEmail && <Banner s="warn">Questo passo richiede un'email. <button type="button" className="ct-link" onClick={() => onEmail?.(s.template)}>Scrivi l'email</button></Banner>}
        {email && (
          <details className="ct-anteprima-box">
            <summary>Email a <b>{destEmail || '— manca l\'indirizzo —'}</b>: {email.oggetto}</summary>
            <div className="field"><label htmlFor="av-a">A</label><input id="av-a" type="email" value={destEmail} onChange={e => setAMod(e.target.value)} /></div>
            {email.cc.length > 0 && <p className="hint">CC: {email.cc.join(', ')}</p>}
            <div className="ct-anteprima" dangerouslySetInnerHTML={{ __html: email.corpo }} />
            <button type="button" className="ct-link" onClick={() => onEmail?.(s.template)}>Modifica il testo</button>
          </details>)}
        {email && !emailOk(destEmail) && <p className="hint">Apri l'anteprima e scrivi l'indirizzo.</p>}
        <details><summary>Nota (facoltativa)</summary><input aria-label="Nota" value={nota} onChange={e => setNota(e.target.value)} /></details>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{etichetta}</button><span className="hint">Invio ↵</span></div>
      </form>
    </Modal>
  );
}

/** Passi senza dati da chiedere: si può avanzare con un clic. */
export const avanzaDiretto = (s: { requisiti?: string[] } | null | undefined) => !!s && !(s.requisiti?.length);
