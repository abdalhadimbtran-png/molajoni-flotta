import { FormEvent, useEffect, useMemo, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { fmtOra } from '../lib/format';
import { prossimoStadio, type Pratica, type Template, type Trasferimento } from '../lib/centralino/tipi';
import { compila, guscioEmail, inTesto, segnaposto, type Valori } from '../lib/centralino/modelli';
import { useConfig } from './comune';

const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const lista = (s: string) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

/**
 * Email da modello: segnaposto compilati, anteprima modificabile, A/CC, invio dalla coda (Resend)
 * oppure «Copia testo» / «Apri in Outlook» (Resend in prova). Ogni invio resta nella storia.
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
  const [senza, setSenza] = useState(false);
  const [motivo, setMotivo] = useState('');
  const prossimo = pratica && config ? prossimoStadio(config.flussi.find(f => f.tipo === pratica.tipo), pratica) : null;

  const valori: Valori | null = useMemo(() => {
    if (!config) return null;
    const firma = String(config.impostazioni.firma ?? '');
    const base = pratica ? segnaposto(pratica, firma) : segnaposto({ numero: '', cliente_nome: trasf?.cliente_nome || 'Cliente', contatto_nome: trasf?.cliente_nome ?? null, appuntamento_data: null, appuntamento_fascia: null, commerciale_nome: null, tecnico_nome: null, telefono: trasf?.telefono, email: trasf?.cliente_email }, firma);
    return {
      ...base,
      numero_pratica: pratica ? `Riferimento: ${pratica.numero}` : '',
      argomento: trasf?.argomento || trasf?.tipo_argomento || 'la sua richiesta',
      referente: trasf?.destinatario_nome ?? base.commerciale,
      entro: trasf?.entro_testo || (trasf?.richiamo_scadenza ? `entro ${fmtOra(trasf.richiamo_scadenza)}` : 'al più presto'),
    } as Valori;
  }, [config, pratica, trasf]);
  // nelle email della pratica {numero_pratica} è il numero nudo (i modelli scrivono già «Riferimento:»)
  const val = useMemo(() => (valori && pratica && !trasf ? { ...valori, numero_pratica: pratica.numero } : valori), [valori, pratica, trasf]);

  function scegli(t: Template) {
    if (!val || !config) return;
    setM(t);
    setOgg(compila(t.oggetto, val, false));
    setCorpo(compila(t.corpo_html, val));
    const c = [...t.cc_default];
    if (t.cc_offerte_grandi) { c.push(...config.impostazioni.cc_offerte_grandi.map(x => x.email).filter(Boolean)); if (pratica?.commerciale_email) c.push(pratica.commerciale_email); }
    setCc([...new Set(c)].join(', '));
    setAvanza(!!pratica && !!prossimo && prossimo.template === t.codice);
  }
  useEffect(() => {
    if (m || !ordinati.length || !val) return;
    const pref = (codice && ordinati.find(x => x.codice === codice))
      || (trasf && ordinati.find(x => x.codice === (trasf.modalita === 'richiamo' ? 'riepilogo_richiamo' : 'riepilogo_trasferita')))
      || (prossimo?.template && ordinati.find(x => x.codice === prossimo.template))
      || (pratica?.sottotipo === 'Allarme sonoro attivo' && ordinati.find(x => x.codice === 'conferma_urgente_allarme'))
      || ordinati.find(x => x.tipo_pratica === tipo) || ordinati[0];
    scegli(pref);
  }, [ordinati, val]); // eslint-disable-line react-hooks/exhaustive-deps

  const html = () => guscioEmail(corpo);
  async function registra(modo: 'resend' | 'copia' | 'outlook') {
    setErr(null);
    if (!emailOk(a)) { setErr('Scrivi l\'indirizzo email del cliente.'); return false; }
    if (!ogg.trim()) { setErr('Scrivi l\'oggetto.'); return false; }
    setInvio(true);
    try {
      const testo = inTesto(corpo);
      if (trasf) await rpc('centralino_trasf_email', { p_id: trasf.id, p_template: m?.codice ?? null, p_a: a.trim(), p_cc: lista(cc), p_oggetto: ogg, p_html: html(), p_testo: testo, p_modo: modo });
      else if (pratica) await rpc('centralino_invia_email', { p_id: pratica.id, p_template: m?.codice ?? null, p_a: a.trim(), p_cc: lista(cc), p_oggetto: ogg, p_html: html(), p_testo: testo, p_modo: modo, p_avanza: avanza && prossimo ? prossimo.key : null });
      return true;
    } catch (x) { setErr(testoErrore(x)); return false; } finally { setInvio(false); }
  }
  async function invia(e: FormEvent) { e.preventDefault(); if (await registra('resend')) { toast('Email in invio'); onFatto(); } }
  async function copia() {
    const testo = `${ogg}\n\n${inTesto(corpo)}`;
    try { await navigator.clipboard.writeText(testo); } catch { /* il browser può negarlo: il testo resta visibile */ }
    if (await registra('copia')) { toast('Testo copiato e registrato'); onFatto(); }
  }
  async function outlook() {
    const u = `mailto:${encodeURIComponent(a.trim())}?${new URLSearchParams({ ...(cc ? { cc: lista(cc).join(',') } : {}), subject: ogg, body: inTesto(corpo) }).toString().replace(/\+/g, '%20')}`;
    if (await registra('outlook')) { window.location.href = u; toast('Aperta in Outlook e registrata'); onFatto(); }
  }
  async function senzaEmail() {
    if (!trasf || !motivo.trim()) { setErr('Scrivi il motivo.'); return; }
    try { await rpc('centralino_trasf_senza_email', { p_id: trasf.id, p_motivo: motivo }); toast('Registrato: email non disponibile'); onFatto(); } catch (x) { setErr(testoErrore(x)); }
  }

  return (
    <Modal titolo={trasf ? 'Email di riepilogo al cliente' : `Email · ${pratica?.numero ?? ''}`} onClose={onClose}>
      <form className="form ct-email" onSubmit={invia}>
        {trasf && <Banner s="warn">Dopo ogni chiamata trasferita l'email di riepilogo al cliente è obbligatoria.</Banner>}
        <div className="field"><label htmlFor="em-mod">Modello</label>
          <select id="em-mod" value={m?.codice ?? ''} onChange={e => { const t = ordinati.find(x => x.codice === e.target.value); if (t) scegli(t); }}>
            {ordinati.map(t => <option key={t.codice} value={t.codice}>{t.nome}{t.tipo_pratica === tipo ? ' ★' : ''}</option>)}
          </select></div>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="em-a">A</label><input id="em-a" type="email" value={a} onChange={e => setA(e.target.value)} placeholder="email del cliente" />
            {!emailOk(a) && <p className="hint">Chiedi l'email al cliente.</p>}</div>
          <div className="field"><label htmlFor="em-cc">CC</label><input id="em-cc" value={cc} onChange={e => setCc(e.target.value)} placeholder="separati da virgola" /></div>
        </div>
        {m?.cc_offerte_grandi && config && config.impostazioni.cc_offerte_grandi.some(x => !x.email) && <p className="hint">Mancano alcune email in copia ({config.impostazioni.cc_offerte_grandi.filter(x => !x.email).map(x => x.nome).join(', ')}): aggiungile in Flussi e impostazioni.</p>}
        <div className="field"><label htmlFor="em-ogg">Oggetto</label><input id="em-ogg" value={ogg} onChange={e => setOgg(e.target.value)} /></div>
        <div className="field"><label>Testo (modificabile)</label>
          <div className="ct-anteprima" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
            onBlur={e => setCorpo((e.target as HTMLDivElement).innerHTML)} dangerouslySetInnerHTML={{ __html: corpo }} /></div>
        {pratica && prossimo && <label className="check"><input type="checkbox" checked={avanza} onChange={e => setAvanza(e.target.checked)} /> Segna anche «{prossimo.nome}» come fatto</label>}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex">
          <button className="btn" disabled={invio}>{invio ? 'Invio…' : 'Invia'}</button>
          <button type="button" className="btn-ghost" onClick={copia} disabled={invio}>Copia testo</button>
          <button type="button" className="btn-ghost" onClick={outlook} disabled={invio}>Apri in Outlook</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Più tardi</button>
        </div>
        <p className="hint">Resend è ancora in prova: se l'invio non arriva al cliente usa «Apri in Outlook». In tutti i casi l'email resta nella storia.</p>
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
