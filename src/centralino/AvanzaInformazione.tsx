import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { tabRoving, tastiRadio, useTastoTelefono } from './tastiera';
import { rpc } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import type { Flusso, Pratica, Stadio, Template } from '../lib/centralino/tipi';
import { useConfig } from './comune';
import { controllaEmail } from '../lib/centralino/destinatari';
import { useSalva } from '../lib/salva';
import { apriEmail } from '../lib/centralino/mailto';
import { ESITI_INFO, TEMPLATE_RISPOSTA, erroreEsito, type EsitoInfo } from '../lib/centralino/informazione';
import { componi } from './Avanza';

const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/**
 * «Informazione» (0083): 1 Risposto a voce · 2 Risposto via email · 3 Girata a un responsabile.
 * Tutti chiudono la pratica (chiusa_ok); l'esito e il referente restano nella storia.
 */
export default function AvanzaInformazione({ p, f, s, onClose, onFatto, onEmail }: { p: Pratica; f: Flusso; s: Stadio; onClose: () => void; onFatto: () => void; onEmail?: (template?: string, dopoPasso?: boolean) => void }) {
  const { config } = useConfig();
  const [esito, setEsito] = useState<EsitoInfo | null>(null);
  const [ref, setRef] = useState(p.assegnato_nome ?? '');
  const [avvisaCli, setAvvisaCli] = useState(emailOk(p.email));
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const { salva: esegui } = useSalva({ riprova: false });
  const gruppo = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = window.setTimeout(() => gruppo.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(), 30); return () => window.clearTimeout(k); }, []);

  const firma = String(config?.impostazioni.firma ?? '');
  const automatico = config?.impostazioni.invio_email === 'automatico';
  const referenti = config?.impostazioni.destinatari_trasferimento ?? [];
  const refP = referenti.find(r => r.nome === ref);
  const modello = (c: string) => config?.modelli.find((m: Template) => m.codice === c && m.attivo);
  const tRisp = modello(TEMPLATE_RISPOSTA), tRef = modello('girata_referente'), tCli = modello('girata_ufficio');
  const extra = { assegnato_nome: ref || null } as Partial<Pratica>;
  const email = useMemo(() => {
    if (esito === 'email' && tRisp && emailOk(p.email)) return { codice: tRisp.codice, nome: p.contatto_nome || p.cliente_nome, ...componi(tRisp, p, firma, p.email!) };
    if (esito === 'girata' && tRef && ref) return { codice: tRef.codice, nome: ref, ...componi(tRef, p, firma, refP?.email ?? '', extra) };
    return null;
  }, [esito, ref, p, firma, tRisp, tRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const emailInterne = [...referenti, ...(config?.impostazioni.commerciali ?? []), ...(config?.impostazioni.cc_offerte_grandi ?? [])].map(x => x.email ?? null);
  const avanza = (key: string, dati: Record<string, unknown>) => rpc('centralino_avanza', { p_id: p.id, p_stadio: key, p_dati: dati, p_testo: nota || null });
  const chiusa = f.stadi[f.stadi.findIndex(x => x.key === s.key) + 1];

  async function salva(e?: FormEvent, tel = false) {
    e?.preventDefault(); setErr(null);
    const x = erroreEsito(esito, p, ref); if (x) return setErr(x);
    if (tel && esito !== 'girata') return;
    if (esito !== 'voce' && !tel) {
      if (!email) return setErr(esito === 'email' ? 'Modello «risposta_informazione» non attivo.' : 'Modello «girata_referente» non attivo.');
      const c = controllaEmail({ codice: email.codice, oggetto: email.oggetto, testo: email.testo, a: email.a, cc: email.cc, numero: p.numero, clienteEmail: p.email, emailInterne, dati: { ...p, ...extra }, nomeDest: email.nome });
      if (c) return setErr(c);
    }
    setInvio(true);
    const r = await esegui(async () => {
      let apri = false;
      if (esito !== 'voce') {
        if (tel) await rpc('centralino_avvisato_telefono', { p_pratica_id: p.id, p_trasf_id: null, p_chi: 'referente', p_destinatario: ref, p_template: 'girata_referente', p_avanza: null });
        else if (email) {
          await rpc('centralino_invia_email', { p_id: p.id, p_template: email.codice, p_a: email.a.trim(), p_cc: email.cc, p_oggetto: email.oggetto, p_html: email.html, p_testo: email.testo, p_modo: automatico ? 'resend' : 'outlook', p_avanza: null });
          apri = !automatico;
        }
      }
      await avanza(s.key, { esito_info: esito, ...(esito === 'girata' ? { assegnato_nome: ref, referente_telefonato: tel } : {}) });
      if (chiusa) await avanza(chiusa.key, {});
      // conferma al cliente (girata): in automatico parte subito, con Outlook si apre dopo nel compositore (una finestra per clic)
      const cli = esito === 'girata' && avvisaCli && emailOk(p.email) && !!tCli;
      if (cli && automatico) await rpc('centralino_invia_email', { p_id: p.id, p_template: tCli!.codice, p_a: p.email, p_cc: [], ...(() => { const c = componi(tCli!, p, firma, p.email!, extra); return { p_oggetto: c.oggetto, p_html: c.html, p_testo: c.testo }; })(), p_modo: 'resend', p_avanza: null });
      if (apri && email) toast(apriEmail({ a: email.a, cc: email.cc, oggetto: email.oggetto, testo: email.testo, html: email.html, numero: p.numero }));
      else toast(`${p.numero}: pratica chiusa`);
      onFatto();
      if (cli && !automatico) onEmail?.(tCli!.codice, true);
    });
    if (!r.ok && !r.duplicato) { setErr(r.messaggio); setInvio(false); }
  }
  const telRef = useRef<() => void>(() => undefined);
  telRef.current = () => { if (!invio) void salva(undefined, true); };
  useTastoTelefono(() => telRef.current(), esito === 'girata');

  const etichetta = invio ? 'Invio…' : esito === 'voce' || !esito ? 'Chiudi la pratica' : automatico ? 'Invia e chiudi' : 'Apri in Outlook e chiudi';
  return (
    <Modal titolo={`Informazione: ${s.nome}`} onClose={onClose} bloccaFuori>
      <form className="form" onSubmit={salva}>
        <div className="ct-big ct-big-gestione" role="radiogroup" aria-label="Esito" ref={gruppo} onKeyDown={tastiRadio}>
          {ESITI_INFO.map((o, i) => (
            <button type="button" key={o.v} role="radio" aria-checked={esito === o.v} tabIndex={tabRoving(esito === o.v, i, !!esito)} className={esito === o.v ? 'on' : ''} onClick={() => { setEsito(o.v); setErr(null); }}>
              <span className="ct-big-t"><b>{o.l}</b><span className="sub">{o.d}</span></span>
              <span className="k-n" aria-hidden>{i + 1}</span><span className="ct-check" aria-hidden /></button>))}
        </div>
        {esito === 'email' && !emailOk(p.email) && <Banner s="warn">Manca l'email del cliente. <button type="button" className="ct-link" onClick={() => setEsito('voce')}>Passa a «Risposto a voce»</button></Banner>}
        {esito === 'girata' && (<>
          <div className="field"><label htmlFor="inf-ref">Responsabile</label>
            <select id="inf-ref" value={ref} onChange={e => setRef(e.target.value)}><option value="">— scegli —</option>
              {referenti.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.nota ? ` · ${d.nota}` : ''}</option>)}</select></div>
          {ref && !emailOk(refP?.email) && <p className="hint">Manca l'email di {ref}: usa «Avvisato per telefono».</p>}
          <label className="check"><input type="checkbox" checked={avvisaCli} disabled={!emailOk(p.email)} onChange={e => setAvvisaCli(e.target.checked)} /> Email al cliente «il nostro responsabile Vi ricontatterà»{!emailOk(p.email) ? ' — manca l\'email' : ''}</label>
        </>)}
        {email && (
          <details className="ct-anteprima-box"><summary>A: <b>{email.nome || '—'}</b> · {email.a || 'manca l\'email'} — {email.oggetto}</summary>
            <div className="ct-anteprima" dangerouslySetInnerHTML={{ __html: email.corpo }} /></details>)}
        {esito === 'email' && <p className="hint">Scrivi la risposta in Outlook al posto di «[scrivere qui la risposta]».</p>}
        <details><summary>Nota (facoltativa)</summary><input aria-label="Nota" value={nota} onChange={e => setNota(e.target.value)} /></details>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio || !esito}>{etichetta}</button>
          {esito === 'girata' && <button type="button" className="btn-ghost" disabled={invio} onClick={() => salva(undefined, true)}>Avvisato per telefono <kbd>T</kbd></button>}
          <span className="k-hint"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> esito · <kbd>Invio</kbd> conferma · <kbd>Esc</kbd> chiudi</span></div>
      </form>
    </Modal>
  );
}
