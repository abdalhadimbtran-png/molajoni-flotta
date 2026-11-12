import { FormEvent, useEffect, useMemo, useState } from 'react';
import { rpc } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { fmtOra } from '../lib/format';
import { prossimoStadio, type Pratica, type Template, type Trasferimento } from '../lib/centralino/tipi';
import { compila, emailDaModello, segnaposto, type Valori } from '../lib/centralino/modelli';
import type { TecnicoDisp } from '../lib/centralino/tipi';
import { useConfig } from './comune';
import { useSalva } from '../lib/salva';
import { apriBozza, apriEmail } from '../lib/centralino/mailto';
import { useTastoTelefono } from './tastiera';
import { AVVISO_ALLEGATO, avanzaConModello, richiedeAllegato, templatePasso } from '../lib/centralino/passi';
import { NOME_RUOLO, controllaEmail, destinatarioPerAzione, ruoloModello, type ContestoDest, type PersonaEmail } from '../lib/centralino/destinatari';
import type { PersonaDisp } from '../lib/centralino/tipi';

const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const lista = (s: string) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

/**
 * Email da modello: segnaposto compilati, anteprima modificabile, A/CC. Invio principale «Apri in Outlook»
 * (dalla casella di Jennifer), secondario «Copia testo»; «Invia» automatico solo con invio_email = 'automatico'.
 * Ogni invio resta nella storia.
 * Con `trasf` è l'email di riepilogo dopo una chiamata trasferita (obbligatoria).
 */
export default function ModaleEmail({ pratica, trasf, codice, onClose, onFatto }: { pratica?: Pratica | null; trasf?: Trasferimento | null; codice?: string; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const tipo = trasf ? 'trasferimento' : pratica?.tipo;
  const modelli = useMemo(() => (config?.modelli ?? []).filter(m => m.attivo && (trasf ? m.tipo_pratica === 'trasferimento' : m.tipo_pratica !== 'trasferimento')), [config, trasf]);
  const ordinati = useMemo(() => [...modelli].sort((a, b) => Number(b.tipo_pratica === tipo) - Number(a.tipo_pratica === tipo) || a.ordine - b.ordine), [modelli, tipo]);
  const [m, setM] = useState<Template | null>(null);
  const [a, setA] = useState(trasf?.cliente_email ?? pratica?.email ?? '');
  const [cc, setCc] = useState('');
  const [ogg, setOgg] = useState('');
  const [corpo, setCorpo] = useState('');
  const [avanza, setAvanza] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const { salva: esegui } = useSalva({ riprova: false });
  const [senza, setSenza] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [telTec, setTelTec] = useState<string | null>(null);
  useEffect(() => { if (pratica?.tecnico_dipendente_id) rpc<TecnicoDisp[]>('centralino_tecnici', {}).then(l => setTelTec((l ?? []).find(t => t.id === pratica.tecnico_dipendente_id)?.telefono ?? null), () => undefined); }, [pratica?.tecnico_dipendente_id]);
  const [coordinatori, setCoordinatori] = useState<PersonaEmail[]>([]);
  useEffect(() => { if (pratica && (pratica.tipo === 'manutenzione' || pratica.tipo === 'sopralluogo')) rpc<PersonaDisp[]>('centralino_coordinatori', { p_tipo: pratica.tipo }).then(l => setCoordinatori(l ?? []), () => undefined); }, [pratica?.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctxDest = useMemo((): ContestoDest => {
    const im = config?.impostazioni;
    return { pratica, trasf, coordinatori, referenti: im?.destinatari_trasferimento ?? [], commerciali: [...(im?.commerciali_offerte_grandi ?? []), ...(im?.commerciali ?? [])] };
  }, [config, pratica, trasf, coordinatori]);
  /** indirizzi dei colleghi: mai come A di un'email al cliente */
  const emailInterne = useMemo(() => { const im = config?.impostazioni; return [...(im?.destinatari_trasferimento ?? []), ...(im?.commerciali ?? []), ...(im?.commerciali_offerte_grandi ?? []), ...(im?.cc_offerte_grandi ?? []), ...coordinatori, ...(pratica?.commerciale_email ? [{ email: pratica.commerciale_email }] : [])].map(x => x.email); }, [config, coordinatori, pratica?.commerciale_email]);
  const prossimo = pratica && config ? prossimoStadio(config.flussi.find(f => f.tipo === pratica.tipo), pratica) : null;

  const valori: Valori | null = useMemo(() => {
    if (!config) return null;
    const firma = String(config.impostazioni.firma ?? '');
    const base = pratica ? segnaposto({ ...pratica, tecnico_telefono: telTec }, firma) : segnaposto({ numero: '', cliente_nome: trasf?.cliente_nome || 'Cliente', contatto_nome: trasf?.cliente_nome ?? null, appuntamento_data: null, appuntamento_fascia: null, commerciale_nome: null, tecnico_nome: null, telefono: trasf?.telefono, email: trasf?.cliente_email }, firma);
    return {
      ...base,
      numero_pratica: pratica?.numero ?? '',
      argomento: trasf?.argomento || trasf?.tipo_argomento || base.argomento,
      scadenza: trasf?.richiamo_scadenza ? `entro le ${fmtOra(trasf.richiamo_scadenza)}` : '',
      referente: trasf?.destinatario_nome ?? base.commerciale,
      entro: trasf?.entro_testo || (trasf?.richiamo_scadenza ? `entro ${fmtOra(trasf.richiamo_scadenza)}` : 'al più presto'),
    } as Valori;
  }, [config, pratica, trasf, telTec]);
  const val = valori;

  function scegli(t: Template) {
    if (!val || !config) return;
    setM(t);
    // A sempre dal ruolo del modello: cliente ↔ collega non si mescolano cambiando modello
    setA(destinatarioPerAzione(t.codice, ctxDest, t.oggetto).email ?? '');
    setOgg(compila(t.oggetto, val, false));
    setCorpo(compila(t.corpo_html, val));
    const c = [...t.cc_default];
    if (t.cc_offerte_grandi) { c.push(...config.impostazioni.cc_offerte_grandi.map(x => x.email).filter(Boolean)); if (pratica?.commerciale_email) c.push(pratica.commerciale_email); }
    setCc([...new Set(c)].join(', '));
    // il passo coordinatore richiede anche il nome del coordinatore: si avanza dalla finestra del passo
    setAvanza(!!pratica && !!prossimo && avanzaConModello(pratica, prossimo.template, t.codice));
  }
  useEffect(() => {
    if (m || !ordinati.length || !val) return;
    const pref = (codice && ordinati.find(x => x.codice === codice))
      || (trasf && ordinati.find(x => x.codice === (trasf.modalita === 'richiamo' ? 'riepilogo_richiamo' : 'riepilogo_trasferita')))
      || (prossimo?.template && pratica && ordinati.find(x => x.codice === templatePasso(pratica, prossimo.template)))
      || ordinati.find(x => x.tipo_pratica === tipo) || ordinati[0];
    scegli(pref);
  }, [ordinati, val]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (m && ruoloModello(m.codice, m.oggetto) === 'coordinatore') setA(destinatarioPerAzione(m.codice, ctxDest, m.oggetto).email ?? ''); }, [coordinatori]); // eslint-disable-line react-hooks/exhaustive-deps
  const dest = m ? destinatarioPerAzione(m.codice, ctxDest, m.oggetto) : null;
  const finale = useMemo(() => (m && val ? emailDaModello(m, val, corpo) : null), [m, val, corpo]);
  const html = () => finale?.html ?? '';
  async function registra(modo: 'resend' | 'copia' | 'outlook') {
    setErr(null);
    if (!ogg.trim()) { setErr('Scrivi l\'oggetto.'); return false; }
    const errore = m ? controllaEmail({ codice: m.codice, oggetto: ogg, testo: finale?.testo ?? '', a, cc: lista(cc), numero: pratica?.numero,
      clienteEmail: trasf?.cliente_email ?? pratica?.email, emailInterne, dati: pratica ? { ...pratica } : undefined, nomeDest: dest?.nome })
      : (!emailOk(a) ? 'Scrivi l\'indirizzo email del destinatario.' : null);
    if (errore) { setErr(errore); return false; }
    setInvio(true);
    const esito = await esegui(async () => {
      const testo = finale?.testo ?? '';
      if (trasf) await rpc('centralino_trasf_email', { p_id: trasf.id, p_template: m?.codice ?? null, p_a: a.trim(), p_cc: lista(cc), p_oggetto: ogg, p_html: html(), p_testo: testo, p_modo: modo });
      else if (pratica) await rpc('centralino_invia_email', { p_id: pratica.id, p_template: m?.codice ?? null, p_a: a.trim(), p_cc: lista(cc), p_oggetto: ogg, p_html: html(), p_testo: testo, p_modo: modo, p_avanza: avanza && prossimo ? prossimo.key : null });
    });
    if (esito.duplicato) return false;
    setInvio(false);
    if (!esito.ok) setErr(esito.messaggio);
    return esito.ok;
  }
  const automatico = config?.impostazioni.invio_email === 'automatico';
  async function invia(e: FormEvent) { e.preventDefault(); if (!automatico) { await outlook(); return; } if (await registra('resend')) { toast('Email in invio'); onFatto(); } }
  async function copia() {
    const testo = `${ogg}\n\n${finale?.testo ?? ''}`;
    try { await navigator.clipboard.writeText(testo); } catch { /* il browser può negarlo: il testo resta visibile */ }
    if (await registra('copia')) { toast('Testo copiato e registrato'); onFatto(); }
  }
  /** Un clic: Outlook si apre (mailto) con A/CC/oggetto/testo semplice; l'email è registrata. */
  async function outlook() {
    if (!(await registra('outlook'))) return;
    const avviso = apriEmail({ a, cc: lista(cc), oggetto: ogg, testo: finale?.testo ?? '' });
    toast(richiedeAllegato(m) ? `${avviso} ${AVVISO_ALLEGATO}.` : avviso); onFatto();
  }
  /** Secondario: bozza formattata .eml da aprire. */
  async function eml() {
    if (!(await registra('outlook'))) return;
    const avviso = apriBozza({ a, cc: lista(cc), oggetto: ogg, html: html(), testo: finale?.testo ?? '', numero: pratica?.numero });
    toast(richiedeAllegato(m) ? `${avviso} ${AVVISO_ALLEGATO}.` : avviso); onFatto();
  }
  /** Alternativa all'email: avvisato per telefono. Conta come l'email inviata (e avanza il passo se spuntato). */
  const chi = dest?.ruolo ?? 'cliente';
  const nomeDest = dest?.nome || (trasf?.cliente_nome ?? pratica?.contatto_nome ?? pratica?.cliente_nome);
  async function telefono() {
    if (invio) return;
    setErr(null); setInvio(true);
    const esito = await esegui(async () => {
      await rpc('centralino_avvisato_telefono', { p_pratica_id: trasf ? null : pratica?.id ?? null, p_trasf_id: trasf?.id ?? null, p_chi: chi, p_destinatario: nomeDest || null, p_template: m?.codice ?? null, p_avanza: !trasf && avanza && prossimo ? prossimo.key : null });
      toast(`Registrato: ${chi === 'cliente' ? 'cliente' : nomeDest || chi} avvisato per telefono`); onFatto();
    });
    if (esito.duplicato) return;
    setInvio(false);
    if (!esito.ok) setErr(esito.messaggio);
  }
  useTastoTelefono(telefono, !!m);
  async function senzaEmail() {
    if (!trasf || !motivo.trim()) { setErr('Scrivi il motivo.'); return; }
    const esito = await esegui(() => rpc('centralino_trasf_senza_email', { p_id: trasf.id, p_motivo: motivo }));
    if (esito.ok) { toast('Registrato: email non disponibile'); onFatto(); } else if (!esito.duplicato) setErr(esito.messaggio);
  }

  return (
    <Modal titolo={trasf ? 'Email di riepilogo al cliente' : `Email · ${pratica?.numero ?? ''}`} onClose={onClose} bloccaFuori>
      <form className="form ct-email" onSubmit={invia}>
        {trasf && <Banner s="warn">Dopo ogni chiamata trasferita l'email di riepilogo al cliente è obbligatoria.</Banner>}
        <div className="field"><label htmlFor="em-mod">Modello</label>
          <select id="em-mod" value={m?.codice ?? ''} onChange={e => { const t = ordinati.find(x => x.codice === e.target.value); if (t) scegli(t); }}>
            {ordinati.map(t => <option key={t.codice} value={t.codice}>{t.nome}{t.tipo_pratica === tipo ? ' ★' : ''}</option>)}
          </select></div>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="em-a">A</label><input id="em-a" type="email" value={a} onChange={e => setA(e.target.value)} placeholder="email" />
            {!emailOk(a) && <p className="hint">{dest?.errore ?? 'Manca email.'}</p>}</div>
          <div className="field"><label htmlFor="em-cc">CC</label><input id="em-cc" value={cc} onChange={e => setCc(e.target.value)} placeholder="a, b" /></div>
        </div>
        {m?.cc_offerte_grandi && config && config.impostazioni.cc_offerte_grandi.some(x => !x.email) && <p className="hint">Mancano alcune email in copia ({config.impostazioni.cc_offerte_grandi.filter(x => !x.email).map(x => x.nome).join(', ')}): aggiungile in Flussi e impostazioni.</p>}
        <div className="field"><label htmlFor="em-ogg">Oggetto</label><input id="em-ogg" value={ogg} onChange={e => setOgg(e.target.value)} /></div>
        <div className="field"><label>Testo</label>
          <div className="ct-anteprima" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
            onBlur={e => setCorpo((e.target as HTMLDivElement).innerHTML)} dangerouslySetInnerHTML={{ __html: corpo }} /></div>
        {finale && <details className="ct-anteprima-box" open><summary>Anteprima dell'email formattata</summary>
          <iframe title="Anteprima email" sandbox="" className="ct-iframe ct-iframe-email" srcDoc={finale.html} /></details>}
        {pratica && prossimo && <label className="check"><input type="checkbox" checked={avanza} onChange={e => setAvanza(e.target.checked)} /> Segna anche «{prossimo.nome}» come fatto</label>}
        {richiedeAllegato(m) && <Banner s="warn">{AVVISO_ALLEGATO}: il messaggio non contiene allegati.</Banner>}
        {err && <Banner s="ko">{err}</Banner>}
        {dest && <p className="ct-dest" aria-live="polite"><b>A:</b> {dest.nome || '—'} ({NOME_RUOLO[dest.ruolo]}){emailOk(a) ? ` · ${a.trim()}` : ' · manca l\'email'}</p>}
        <div className="row-flex">
          <button className="btn" disabled={invio}>{invio ? 'Apertura…' : automatico ? 'Invia' : 'Apri in Outlook'}</button>
          {automatico && <button type="button" className="btn-ghost" onClick={outlook} disabled={invio}>Apri in Outlook</button>}
          <button type="button" className="btn-ghost" onClick={telefono} disabled={invio} title="Tasto T">Avvisato per telefono <kbd>T</kbd></button>
          <button type="button" className="btn-ghost" onClick={copia} disabled={invio}>Copia testo</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Più tardi</button>
        </div>
        <p className="hint"><button type="button" className="ct-link" onClick={eml} disabled={invio}>Versione formattata (.eml)</button></p>
        {trasf && (
          <details open={senza} onToggle={e => setSenza((e.target as HTMLDetailsElement).open)}>
            <summary>Email non disponibile</summary>
            <div className="ct-riga"><select aria-label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)}><option value="">— motivo —</option>{(config?.impostazioni.motivi_senza_email ?? ['Altro']).map(m => <option key={m}>{m}</option>)}</select>
              <button type="button" className="btn-ghost" onClick={senzaEmail}>Registra il motivo</button></div>
          </details>)}
      </form>
    </Modal>
  );
}
