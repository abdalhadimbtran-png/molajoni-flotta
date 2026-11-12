import { useEffect, useMemo, useState } from 'react';
import { rpc, supabase } from '../lib/supabase';
import { fmtEuro } from '../lib/format';
import { Banner, Modal, toast } from '../ui';
import { NOME_TIPO, STATI_CLIENTE, nomeCanale, type Pratica, type Trasferimento } from '../lib/centralino/tipi';
import { compila, emailDaModello, segnaposto, type Valori } from '../lib/centralino/modelli';
import type { Template } from '../lib/centralino/tipi';
import { partiRoma } from '../lib/centralino/sla';
import { useConfig } from './comune';
import { useSalva } from '../lib/salva';
import { apriBozza, apriEmail } from '../lib/centralino/mailto';
import { useTastoTelefono } from './tastiera';
import { controllaEmail } from '../lib/centralino/destinatari';

const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const hhmm = (iso: string) => { const p = partiRoma(new Date(iso)); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
const giorno = (iso: string) => { const p = partiRoma(new Date(iso)); const oggi = partiRoma(new Date()); const dow = new Date(Date.UTC(p.y, p.m - 1, p.g)).getUTCDay();
  return p.y === oggi.y && p.m === oggi.m && p.g === oggi.g ? 'oggi' : `${GIORNI[dow]} ${String(p.g).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`; };

interface Bozza { a: string; oggetto: string; corpo: string; t?: Template }
type Valori2 = Valori & Record<string, string>;

/**
 * Dopo ogni chiamata passata a un responsabile: DUE email, in anteprima modificabile.
 *  1) al referente: chi ha chiamato, di cosa, cosa deve fare ed entro quando, link alla pratica
 *  2) al cliente: presa in carico («la contatterà entro …») o riepilogo se la chiamata è già passata
 * Per ognuna «Outlook → referente» / «Outlook → cliente» (dalla casella di Jennifer) e «Copia testo»;
 * «Invia entrambe» (Resend) solo con invio_email = 'automatico'.
 */
export default function EmailTrasferimento({ trasf, pratica, onClose, onFatto }: { trasf: Trasferimento; pratica?: Pratica | null; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const [p, setP] = useState<Pratica | null>(pratica ?? null);
  const [ref, setRef] = useState<Bozza | null>(null);
  const [cli, setCli] = useState<Bozza | null>(null);
  const [inviataRef, setInviataRef] = useState(!!trasf.email_referente_inviata_at);
  const [inviataCli, setInviataCli] = useState(!!(trasf.email_cliente_inviata_at || trasf.email_riepilogo_at));
  const [motivo, setMotivo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const { salva: esegui } = useSalva({ riprova: false });
  const automatico = config?.impostazioni.invio_email === 'automatico';
  useEffect(() => { if (!p && trasf.pratica_id) supabase.from('pratiche').select('*').eq('id', trasf.pratica_id).maybeSingle().then(r => setP((r.data as Pratica) ?? null)); }, [trasf.pratica_id, p]);

  const refEmail = useMemo(() => {
    const im = config?.impostazioni;
    return trasf.referente_email || im?.destinatari_trasferimento.find(d => d.nome === trasf.destinatario_nome)?.email
      || im?.commerciali_offerte_grandi.find(d => d.nome === trasf.destinatario_nome)?.email || im?.commerciali.find(d => d.nome === trasf.destinatario_nome)?.email || '';
  }, [config, trasf]);

  const valori = useMemo((): Valori2 | null => {
    if (!config) return null;
    const firma = String(config.impostazioni.firma ?? '');
    const b = segnaposto({ numero: p?.numero ?? '', cliente_nome: p?.cliente_nome ?? trasf.cliente_nome ?? 'Cliente', contatto_nome: p?.contatto_nome ?? trasf.cliente_nome,
      appuntamento_data: p?.appuntamento_data ?? null, appuntamento_fascia: p?.appuntamento_fascia ?? null, commerciale_nome: p?.commerciale_nome ?? null, tecnico_nome: p?.tecnico_nome ?? null }, firma);
    const sc = trasf.richiamo_scadenza;
    const scTesto = sc ? `${giorno(sc)} entro le ${hhmm(sc)}` : 'chiamata già passata';
    const stato = (p?.stato_cliente ?? trasf.stato_cliente) as keyof typeof STATI_CLIENTE | null;
    const link = `${window.location.origin}/centralino/${trasf.pratica_id ? `pratica/${trasf.pratica_id}` : 'trasferimenti'}`;
    return {
      ...b, referente: trasf.destinatario_nome, argomento: trasf.tipo_argomento || (p ? NOME_TIPO[p.tipo] : 'la sua richiesta'),
      entro: sc ? (trasf.entro_testo || `entro le ${hhmm(sc)}`) : 'al più presto', ora_scadenza: sc ? hhmm(sc) : '', giorno: sc ? giorno(sc) : '',
      numero_pratica: p?.numero ?? '', rif_pratica: p ? ` – ${p.numero}` : '',
      stato_cliente: stato ? STATI_CLIENTE[stato][1] : '—', telefono: trasf.telefono || p?.telefono || '—', email_cliente: trasf.cliente_email || p?.email || '—',
      sede: [p?.sede, p?.indirizzo, p?.cap, p?.comune].filter(Boolean).join(', ') || '—', canale: p ? nomeCanale(p.canale) : 'Telefono',
      richiesta: [trasf.argomento, p?.descrizione].filter(Boolean).join(' — ') || '—', importo: p?.importo_stimato != null ? fmtEuro(p.importo_stimato) : '—',
      scadenza: scTesto, link, autore: trasf.autore_nome ?? 'il centralino', ora_trasferimento: hhmm(trasf.at),
      richiesta_al_referente: trasf.richiamo_scadenza
        ? `ti ho passato questa richiesta: <b>richiama il cliente ${scTesto}</b>${trasf.modalita === 'richiamo' ? ' (gli ho promesso il richiamo)' : ' (al trasferimento non hai risposto)'}.`
        : 'ti ho appena passato questa chiamata. Conferma per email al cliente quanto concordato (offerta, sopralluogo o appuntamento).',
    } as Valori2;
  }, [config, p, trasf]);

  useEffect(() => {
    if (!valori || !config || ref || (trasf.pratica_id && !p)) return;
    const m = (c: string) => config.modelli.find(x => x.codice === c);
    const tr = m('trasf_referente'), tc = m(trasf.richiamo_scadenza ? 'riepilogo_richiamo' : 'riepilogo_trasferita');
    // nei segnaposto HTML del referente il testo è già HTML sicuro (frasi nostre); i dati del cliente vengono «escapati»
    const corpoRef = tr ? compila(tr.corpo_html.replace('{richiesta_al_referente}', '§RQ§'), valori).replace('§RQ§', valori.richiesta_al_referente) : '';
    setRef({ a: refEmail, oggetto: tr ? compila(tr.oggetto, valori, false) : '', corpo: corpoRef, t: tr });
    setCli({ a: trasf.cliente_email || p?.email || '', oggetto: tc ? compila(tc.oggetto, valori, false) : '', corpo: tc ? compila(tc.corpo_html, valori) : '', t: tc });
  }, [valori, config, refEmail, p]); // eslint-disable-line react-hooks/exhaustive-deps

  const fin = (b: Bozza) => (b.t && valori ? emailDaModello(b.t, valori, b.corpo) : { html: b.corpo, testo: b.corpo.replace(/<[^>]+>/g, ''), oggetto: b.oggetto });
  const emailInterne = useMemo(() => { const im = config?.impostazioni; return [...(im?.destinatari_trasferimento ?? []), ...(im?.commerciali ?? []), ...(im?.commerciali_offerte_grandi ?? []), ...(im?.cc_offerte_grandi ?? [])].map(x => x.email).concat(refEmail); }, [config, refEmail]);
  /** A giusto per ognuna: referente ≠ cliente; numero pratica nell'oggetto; nessun segnaposto vuoto. */
  const verifica = (chi: 'ref' | 'cli', b: Bozza) => controllaEmail({ codice: chi === 'ref' ? 'trasf_referente' : (trasf.richiamo_scadenza ? 'riepilogo_richiamo' : 'riepilogo_trasferita'),
    oggetto: b.oggetto, testo: fin(b).testo, a: b.a, numero: p?.numero, clienteEmail: trasf.cliente_email || p?.email, emailInterne,
    nomeDest: chi === 'ref' ? trasf.destinatario_nome : (trasf.cliente_nome) });
  async function inviaRef(modo: 'resend' | 'copia' | 'outlook') {
    if (!ref) return false;
    await rpc('centralino_trasf_email_referente', { p_id: trasf.id, p_a: ref.a.trim(), p_oggetto: ref.oggetto, p_html: fin(ref).html, p_testo: fin(ref).testo, p_modo: modo });
    setInviataRef(true); return true;
  }
  async function inviaCli(modo: 'resend' | 'copia' | 'outlook') {
    if (!cli) return false;
    await rpc('centralino_trasf_email', { p_id: trasf.id, p_template: trasf.richiamo_scadenza ? 'riepilogo_richiamo' : 'riepilogo_trasferita', p_a: cli.a.trim(), p_cc: [], p_oggetto: cli.oggetto, p_html: fin(cli).html, p_testo: fin(cli).testo, p_modo: modo });
    setInviataCli(true); return true;
  }
  async function entrambe() {
    setErr(null);
    const problemi: string[] = [];
    if (automatico && !inviataRef && !emailOk(ref?.a ?? '')) problemi.push(`Aggiungi l'email di ${trasf.destinatario_nome} in Impostazioni (Destinatari dei trasferimenti).`);
    if (!inviataCli && !emailOk(cli?.a ?? '') && !motivo) problemi.push('Scrivi l\'email del cliente oppure scegli «Email non disponibile» con il motivo.');
    const refBloccata = automatico && !inviataRef && !!ref && emailOk(ref.a) ? verifica('ref', ref) : null;
    if (refBloccata) problemi.push(refBloccata);
    if (automatico && !inviataCli && cli && emailOk(cli.a)) { const x = verifica('cli', cli); if (x) { setErr(x); return; } }
    setInvio(true);
    const esito = await esegui(async () => {
      if (automatico && !inviataRef && !refBloccata && emailOk(ref?.a ?? '')) await inviaRef('resend');
      if (automatico && !inviataCli && emailOk(cli?.a ?? '')) await inviaCli('resend');
      else if (!inviataCli && motivo) await rpc('centralino_trasf_senza_email', { p_id: trasf.id, p_motivo: motivo });
      if (problemi.length) { setErr(problemi.join(' ')); } else { toast(automatico ? 'Email in invio: referente e cliente' : 'Registrato'); if (automatico || inviataRef) onFatto(); }
    });
    if (esito.duplicato) return;
    setInvio(false);
    if (!esito.ok) setErr(esito.messaggio);
  }
  async function outlook(chi: 'ref' | 'cli') {
    const b = chi === 'ref' ? ref : cli; if (!b) return;
    const x = verifica(chi, b); if (x) { setErr(x); return; }
    setErr(null);
    const esito = await esegui(async () => {
      await (chi === 'ref' ? inviaRef('outlook') : inviaCli('outlook'));
      toast(apriEmail({ a: b.a, oggetto: b.oggetto, testo: fin(b).testo }));
      const altra = chi === 'ref' ? inviataCli : inviataRef;
      if (altra) onFatto();
    });
    if (!esito.ok && !esito.duplicato) setErr(esito.messaggio);
  }
  /** Secondario: bozza formattata .eml. */
  async function eml(chi: 'ref' | 'cli') {
    const b = chi === 'ref' ? ref : cli; if (!b) return;
    const x = verifica(chi, b); if (x) { setErr(x); return; }
    const esito = await esegui(async () => {
      await (chi === 'ref' ? inviaRef('outlook') : inviaCli('outlook'));
      const f = fin(b); toast(apriBozza({ a: b.a, oggetto: b.oggetto, html: f.html, testo: f.testo, numero: p?.numero }));
      if (chi === 'ref' ? inviataCli : inviataRef) onFatto();
    });
    if (!esito.ok && !esito.duplicato) setErr(esito.messaggio);
  }
  /** Alternativa all'email: avvisato per telefono (conta come l'email inviata). */
  async function telefono(chi: 'ref' | 'cli') {
    if (invio) return;
    setErr(null); setInvio(true);
    const esito = await esegui(async () => {
      await rpc('centralino_avvisato_telefono', { p_pratica_id: null, p_trasf_id: trasf.id, p_chi: chi === 'ref' ? 'referente' : 'cliente', p_destinatario: chi === 'ref' ? trasf.destinatario_nome : (trasf.cliente_nome ?? null), p_template: chi === 'ref' ? 'trasf_referente' : null, p_avanza: null });
      if (chi === 'ref') setInviataRef(true); else setInviataCli(true);
      toast(chi === 'ref' ? `${trasf.destinatario_nome} avvisato per telefono` : 'Cliente avvisato per telefono');
      if (chi === 'ref' ? inviataCli : inviataRef) onFatto();
    });
    if (esito.duplicato) return;
    setInvio(false);
    if (!esito.ok) setErr(esito.messaggio);
  }
  // T: avvisa per telefono il primo ancora da fare
  useTastoTelefono(() => telefono(!inviataRef ? 'ref' : 'cli'), !(inviataRef && inviataCli));

  const Scheda = ({ chi, b, set, fatta, titolo }: { chi: 'ref' | 'cli'; b: Bozza | null; set: (x: Bozza) => void; fatta: boolean; titolo: string }) => (
    <section className={`ct-email2 ${fatta ? 'fatta' : ''}`}>
      <div className="ct-email2-h"><b>{titolo}</b>{fatta ? <span className="ct-sla verde">fatto</span> : <span className="ct-sla rosso">da inviare</span>}</div>
      {b && <>
        <div className="field"><label>A</label><input type="email" value={b.a} disabled={fatta || (chi === 'ref' && !!refEmail)} onChange={e => set({ ...b, a: e.target.value })}
          placeholder={chi === 'ref' ? 'email del referente (da Impostazioni)' : 'email del cliente'} /></div>
        {chi === 'ref' && !refEmail && !fatta && <p className="ct-err-email">Aggiungi l'email di {trasf.destinatario_nome} in Impostazioni › Destinatari dei trasferimenti. Il trasferimento è comunque registrato.</p>}
        <p className="ct-dest"><b>A:</b> {chi === 'ref' ? `${trasf.destinatario_nome} (referente)` : `${trasf.cliente_nome || p?.contatto_nome || p?.cliente_nome || 'Cliente'} (cliente)`}{emailOk(b.a) ? ` · ${b.a.trim()}` : ' · manca l\'email'}</p>
        <div className="field"><label>Oggetto</label><input value={b.oggetto} disabled={fatta} onChange={e => set({ ...b, oggetto: e.target.value })} /></div>
        <div className="ct-anteprima" contentEditable={!fatta} suppressContentEditableWarning onBlur={e => set({ ...b, corpo: (e.target as HTMLDivElement).innerHTML })} dangerouslySetInnerHTML={{ __html: b.corpo }} />
        {b.t && valori && <details className="ct-anteprima-box"><summary>Anteprima formattata</summary><iframe title="Anteprima email" sandbox="" className="ct-iframe ct-iframe-email" srcDoc={fin(b).html} /></details>}
        {!fatta && <div className="row-flex"><button type="button" className="btn btn-sm" onClick={() => outlook(chi)}>{chi === 'ref' ? 'Outlook → referente' : 'Outlook → cliente'}</button><button type="button" className="btn-ghost btn-sm" onClick={() => telefono(chi)} disabled={invio}>Avvisato per telefono</button><button type="button" className="ct-link" onClick={() => eml(chi)}>Versione formattata (.eml)</button></div>}
      </>}
    </section>
  );

  return (
    <Modal titolo="Email dopo il trasferimento" onClose={onClose}>
      <div className="form">
        <p className="hint">Due email obbligatorie: al referente ({trasf.destinatario_nome}) e al cliente. Controlla e, se serve, modifica il testo.</p>
        <div className="ct-email2-g">
          <Scheda chi="ref" b={ref} set={setRef} fatta={inviataRef} titolo={`1 · Al referente: ${trasf.destinatario_nome}`} />
          <Scheda chi="cli" b={cli} set={setCli} fatta={inviataCli} titolo={`2 · Al cliente: ${trasf.cliente_nome ?? ''}`} />
        </div>
        {!inviataCli && !emailOk(cli?.a ?? '') && (
          <div className="ct-riga"><span className="sub">Il cliente non ha email?</span>
            <select aria-label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)}><option value="">— Email non disponibile: motivo —</option>{(config?.impostazioni.motivi_senza_email ?? ['Altro']).map(m => <option key={m}>{m}</option>)}</select></div>)}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex">
          {automatico && <button className="btn" disabled={invio || (inviataRef && inviataCli)} onClick={entrambe}>{invio ? 'Invio…' : inviataRef && inviataCli ? 'Inviate' : 'Invia entrambe'}</button>}
          {!automatico && !inviataCli && !emailOk(cli?.a ?? '') && motivo && <button className="btn" disabled={invio} onClick={entrambe}>Registra «email non disponibile»</button>}
          <button type="button" className="btn-ghost" onClick={inviataRef && inviataCli ? onFatto : onClose}>{inviataRef && inviataCli ? 'Chiudi' : 'Più tardi'}</button>
        </div>
        <p className="hint">«Outlook → …» apre subito il messaggio pronto: premi Invia. «Avvisato per telefono» (tasto <kbd>T</kbd>) lo segna come fatto senza email. Tutto è registrato. Finché manca un'email resta il segnale rosso.</p>
      </div>
    </Modal>
  );
}
