import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { tabRoving, tabbabili, tastiRadio, useTastoTelefono } from './tastiera';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { prossimoStadio, type Commerciale, type Flusso, type PersonaDisp, type Pratica, type TecnicoDisp, type Template } from '../lib/centralino/tipi';
import { giornoRoma } from '../lib/centralino/sla';
import { emailDaModello, segnaposto } from '../lib/centralino/modelli';
import { AVVISO_ALLEGATO, richiedeAllegato, templatePasso } from '../lib/centralino/passi';
import { useConfig } from './comune';
import { NOME_RUOLO, controllaEmail, ruoloModello } from '../lib/centralino/destinatari';
import { useSalva } from '../lib/salva';
import { apriEmail } from '../lib/centralino/mailto';
import type { Eml } from '../lib/centralino/emailHtml';

export interface Prossimo { key: string; nome: string; mancanti: string[] }
export const prossimoDi = (id: number) => rpc<Prossimo | null>('centralino_prossimo', { p_id: id });

const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const QUANDO = ['entro 30 minuti', 'entro 1 ora', 'entro 2 ore', 'oggi pomeriggio', 'domani mattina', 'entro 2 giorni lavorativi'];
const quandoDefault = (p: Pratica) => (p.urgenza === 'ordinario' ? 'entro 2 giorni lavorativi' : 'entro 1 ora');

/** Email pronta da modello per la pratica (destinatario scelto dal passo). */
export function componi(t: Template, p: Pratica, firma: string, a: string, extra: Partial<Pratica> = {}, ccOfferte: string[] = []) {
  const v = { ...segnaposto({ ...p, ...extra }, firma), numero_pratica: p.numero };
  const e = emailDaModello(t, v);
  const cc = [...t.cc_default, ...(t.cc_offerte_grandi ? ccOfferte : [])];
  if (t.codice === 'sopralluogo_cliente' && p.commerciale_email) cc.push(p.commerciale_email);
  return { a, cc: [...new Set(cc.filter(Boolean))], oggetto: e.oggetto, html: e.html, corpo: e.corpo, testo: e.testo };
}

/**
 * Prossimo passo (mai salti) in UNA schermata, con azioni combinate:
 * «Invia email al coordinatore e avanti», «Conferma e informa il cliente», «Chiudi».
 * Scorciatoia: Invio = azione principale, Esc = chiudi.
 */
export default function Avanza({ p, f, onClose, onFatto, onEmail }: { p: Pratica; f: Flusso; stadio?: unknown; onClose: () => void; onFatto: () => void; onEmail?: (template?: string, dopoPasso?: boolean) => void }) {
  const { config } = useConfig();
  const s = prossimoStadio(f, p);
  const req = s?.requisiti ?? [];
  const has = (r: string) => (req as string[]).includes(r);
  const ultimo = !!s && s.key === f.stadi[f.stadi.length - 1].key;
  const idx = s ? f.stadi.findIndex(x => x.key === s.key) : -1;
  const dopo = idx >= 0 ? f.stadi[idx + 1] : undefined;
  const firma = String(config?.impostazioni.firma ?? '');
  const modello = (c?: string) => { const k = templatePasso(p, c); return k ? config?.modelli.find(m => m.codice === k && m.attivo) : undefined; };
  const tablet = p.tipo === 'offerta_tablet';

  const [coord, setCoord] = useState<PersonaDisp[]>([]);
  const [coordNome, setCoordNome] = useState(p.coordinatore_nome ?? '');
  const [telefonatoS, setTelefonato] = useState(!!p.coordinatore_telefonato);
  const telefonato = telefonatoS;
  const [altri, setAltri] = useState<PersonaDisp[]>([]);
  // sopralluogo: Jennifer può girare direttamente a un tecnico/commerciale; intervento/manutenzione: lo assegna il coordinatore
  const [tecCoord, setTecCoord] = useState<TecnicoDisp[]>([]);
  const [coordSelKey, setCoordSelKey] = useState('');
  const [avvisoCoordApp, setAvvisoCoordApp] = useState(false);
  const [tecnici, setTecnici] = useState<TecnicoDisp[]>([]);
  const [tecId, setTecId] = useState<number | ''>(p.tecnico_dipendente_id ?? '');
  const [quando, setQuando] = useState(p.tecnico_quando ?? quandoDefault(p));
  const [quandoAt, setQuandoAt] = useState('');
  const [doc, setDoc] = useState(p.documento_intervento ?? '');
  const [avvisato, setAvvisato] = useState(false);
  const [verificato, setVerificato] = useState(false);
  const [app, setApp] = useState(false);
  const [data, setData] = useState(p.appuntamento_data ?? '');
  const [fascia, setFascia] = useState(p.appuntamento_fascia ?? '');
  const [taylor, setTaylor] = useState(p.alert_taylor);
  const [comm, setComm] = useState(p.commerciale_nome ?? '');
  const [commerciali, setCommerciali] = useState<Commerciale[]>([]);
  const [dest, setDest] = useState(p.assegnato_nome ?? f.assegnazione?.nome ?? '');
  const [voceS, setVoce] = useState(false);
  const voce = voceS;
  const [extra, setExtra] = useState(false);
  const [nota, setNota] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  // invii email e avanzamenti non sono idempotenti: niente nuovo tentativo automatico, solo anti-doppio-clic + toast
  const { salva: esegui } = useSalva({ riprova: false });
  const formRef = useRef<HTMLFormElement>(null);
  // all'apertura: focus sul primo campo
  useEffect(() => { const k = window.setTimeout(() => { const f = formRef.current; if (f && !f.contains(document.activeElement)) tabbabili(f)[0]?.focus(); }, 30); return () => window.clearTimeout(k); }, [s?.key]);

  useEffect(() => {
    if (has('coordinatore')) {
      rpc<PersonaDisp[]>('centralino_coordinatori', { p_tipo: p.tipo }).then(l => { setCoord(l ?? []); if (!coordNome) setCoordNome(((l ?? []).find(x => x.disponibile && emailOk(x.email)) ?? (l ?? []).find(x => x.disponibile))?.nome ?? l?.[0]?.nome ?? ''); }, () => undefined);
      rpc<PersonaDisp[]>('centralino_altri_referenti', { p_tipo: p.tipo }).then(l => setAltri(l ?? []), () => undefined);
      if (p.tipo === 'sopralluogo') rpc<TecnicoDisp[]>('centralino_tecnici', {}).then(l => setTecCoord(l ?? []), () => undefined);
    }
    if (has('tecnico') || has('informato')) rpc<TecnicoDisp[]>('centralino_tecnici', {}).then(l => {
      setTecnici(l ?? []);
      if (!tecId && has('tecnico')) { const lib = [...(l ?? [])].filter(t => !t.assente).sort((a, b) => a.interventi_oggi - b.interventi_oggi)[0]; if (lib) setTecId(lib.id); }
    }, () => undefined);
    if (has('commerciale') && p.tipo === 'offerta_grande') rpc<Commerciale[]>('centralino_commerciali', {}).then(setCommerciali, () => undefined);
  }, [s?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tecnico = tecnici.find(t => t.id === tecId);
  // destinatario del passo coordinatore: chiave «c:nome» / «r:nome» / «t:id»
  const keyEff = coordSelKey || (coordNome ? (coord.some(c => c.nome === coordNome) ? `c:${coordNome}` : altri.some(c => c.nome === coordNome) ? `r:${coordNome}` : (() => { const t = tecCoord.find(x => x.nome === coordNome); return t ? `t:${t.id}` : `c:${coordNome}`; })()) : '');
  const tecDiretto = keyEff.startsWith('t:') ? tecCoord.find(t => `t:${t.id}` === keyEff) : undefined;
  const coordSel: { nome: string; email: string | null } | undefined = tecDiretto ? { nome: tecDiretto.nome, email: tecDiretto.email ?? null } : [...coord, ...altri].find(c => c.nome === coordNome);
  const sceltaCoord = (k: string) => {
    setCoordSelKey(k); setAMod(null);
    if (k.startsWith('t:')) { const t = tecCoord.find(x => `t:${x.id}` === k); setCoordNome(t?.nome ?? ''); }
    else setCoordNome(k.slice(2));
    if (!k.startsWith('t:')) setAvvisoCoordApp(false);
  };
  const notaP = (c: PersonaDisp) => (c.disponibile ? 'disponibile' : c.assente ? 'in ferie oggi' : 'occupato');
  const elencoComm = p.tipo === 'offerta_grande' ? commerciali.map(c => ({ nome: c.nome, email: c.email ?? '', nota: c.disponibile ? 'disponibile' : c.assente ? 'assente oggi' : 'occupato' }))
    : (config?.impostazioni.commerciali ?? []).map(c => ({ ...c, nota: '' }));
  const destinatari = config?.impostazioni.destinatari_trasferimento ?? [];
  // «informazione»: girare è facoltativo (vuoto = risposta data dal centralino)
  const destEff = s?.girata_facoltativa ? (destinatari.some(d => d.nome === dest) ? dest : '') : (dest || destinatari[0]?.nome || '');
  const girata = s?.template === 'girata_referente';
  const destPersona = destinatari.find(d => d.nome === destEff);

  // email del passo (precompilata, anteprima chiusa)
  const tEmail = has('email') || has('informato') || (girata && !!destEff) ? modello(s?.template) : undefined;
  const aEmail = !tEmail ? '' : girata ? (destPersona?.email ?? '') : tEmail.codice.endsWith('_coordinatore') ? (coordSel?.email ?? '') : tEmail.codice === 'riepilogo_commerciale' ? (p.commerciale_email || elencoComm.find(c => c.nome === p.commerciale_nome)?.email || '') : (p.email ?? '');
  const ccOff = (config?.impostazioni.cc_offerte_grandi ?? []).map(x => x.email).filter(Boolean) as string[];
  const telTec = tecnici.find(t => t.id === p.tecnico_dipendente_id)?.telefono ?? null;
  const extraDati = { tecnico_telefono: telTec, ...(girata && destEff ? { assegnato_nome: destEff } : {}) } as Partial<Pratica>;
  const email = useMemo(() => (tEmail ? componi(tEmail, p, firma, aEmail, extraDati, ccOff) : null), [tEmail, p, firma, aEmail, telTec, destEff]);
  // email facoltativa del passo (conferma al chiamante / presa in carico)
  const tExtra = s?.template_extra && (!girata || destEff) ? modello(s.template_extra) : undefined;
  const emailExtra = useMemo(() => (tExtra && emailOk(p.email) ? componi(tExtra, p, firma, p.email!, extraDati) : null), [tExtra, p, firma, destEff]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aMod, setAMod] = useState<string | null>(null);
  const destEmail = aMod ?? aEmail;
  const chiTel = girata ? 'referente' : has('coordinatore') ? (tecDiretto ? 'tecnico' : 'coordinatore') : tEmail?.codice === 'riepilogo_commerciale' ? 'commerciale' : 'cliente';
  const nomeTel = girata ? destEff : has('coordinatore') ? coordNome : chiTel === 'commerciale' ? (comm || p.commerciale_nome) : (p.contatto_nome || p.cliente_nome);

  // passo «cliente» successivo al tecnico: si invia insieme
  const tCliente = !tablet && has('tecnico') && (dopo?.requisiti?.includes('email') || (dopo?.requisiti as string[] | undefined)?.includes('informato')) ? modello(dopo!.template) : undefined;

  const telPossibile = !!(tEmail || tCliente);
  const telRef = useRef<(() => void) | null>(null);
  useTastoTelefono(() => telRef.current?.(), telPossibile);
  if (!s) return null;

  const automatico = config?.impostazioni.invio_email === 'automatico';
  // modalità Outlook: l'email è registrata come inviata (modo 'outlook') e il messaggio si apre nella casella di Jennifer
  let daAprire: Eml | null = null;
  const inviaEmail = async (e: { a: string; cc: string[]; oggetto: string; html: string; testo: string }, codice: string) => {
    if (!automatico) daAprire = { a: e.a, cc: e.cc, oggetto: e.oggetto, html: e.html, testo: e.testo };
    return rpc('centralino_invia_email', { p_id: p.id, p_template: codice, p_a: e.a.trim(), p_cc: e.cc, p_oggetto: e.oggetto, p_html: e.html, p_testo: e.testo, p_modo: automatico ? 'resend' : 'outlook', p_avanza: null });
  };
  const allegato = richiedeAllegato(tEmail);
  const apriSeServe = () => { const m = daAprire as Eml | null; if (m) toast(`${apriEmail({ a: m.a, cc: m.cc, oggetto: m.oggetto, testo: m.testo })}${allegato ? ` ${AVVISO_ALLEGATO}.` : ''}`); return !!m; };
  const avanza = (key: string, dati: Record<string, unknown>) => rpc('centralino_avanza', { p_id: p.id, p_stadio: key, p_dati: dati, p_testo: nota || null });

  const emailInterne = [...destinatari, ...elencoComm, ...coord, ...altri, ...tecCoord, ...(config?.impostazioni.cc_offerte_grandi ?? [])].map(x => x.email ?? null).concat(p.commerciale_email);
  const controlla = (e: { a: string; cc: string[]; oggetto: string; testo: string }, codice: string, dati: Record<string, unknown>, nome?: string | null) =>
    controllaEmail({ codice, oggetto: e.oggetto, testo: e.testo, a: e.a, cc: e.cc, numero: p.numero, clienteEmail: p.email, emailInterne, dati: { ...p, ...extraDati, ...dati }, nomeDest: nome });
  async function salva(e?: FormEvent, tel = false) {
    e?.preventDefault(); if (!s) return; setErr(null);
    const dati: Record<string, unknown> = {};
    const telefonato = telefonatoS || (tel && has('coordinatore'));
    const voce = voceS || tel;
    if (has('coordinatore')) {
      if (!coordNome) return setErr('Scegli il coordinatore.');
      if (!telefonato && !emailOk(destEmail)) return setErr('Invia l\'email (manca l\'indirizzo) oppure segna «Telefonato».');
      dati.coordinatore_nome = coordNome; dati.coordinatore_telefonato = telefonato;
      // inviato direttamente a un tecnico: diventa il tecnico proposto per il passo successivo (modificabile)
      if (tecDiretto) { dati.tecnico_dipendente_id = tecDiretto.id; dati.coordinatore_tecnico = true; }
    }
    if (has('tecnico')) {
      if (!tecnico) return setErr('Scegli il tecnico.');
      const q = !quando && !quandoAt ? quandoDefault(p) : quandoAt ? `il ${new Date(quandoAt).toLocaleString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : quando;
      if (tablet && !verificato) return setErr('Spunta «Preventivo verificato» prima di andare avanti.');
      if (tablet) dati.verificato = true;
      Object.assign(dati, { tecnico_nome: tecnico.nome, tecnico_dipendente_id: tecnico.id, tecnico_quando: q, tecnico_quando_at: quandoAt ? new Date(quandoAt).toISOString() : null });
    }
    if (has('buono') || has('avviso')) {
      if (!avvisato && !app) return setErr(p.tipo === 'sopralluogo' ? 'Spunta almeno un avviso al tecnico (Taylor/WhatsApp o app).' : 'Spunta «Tecnico avvisato» (Taylor/WhatsApp).');
      if (doc.trim()) dati.documento_intervento = doc.trim();
      if (avvisato) { dati.alert_taylor = true; dati.whatsapp_tecnico = true; }
    }
    if (has('appuntamento')) { dati.appuntamento_data = data; dati.appuntamento_fascia = fascia; }
    if (has('taylor')) { dati.alert_taylor = taylor; dati.documento_intervento = doc; }
    if (has('commerciale') && comm) { dati.commerciale_nome = comm; dati.commerciale_email = elencoComm.find(c => c.nome === comm)?.email || null; }
    if (has('destinatario') && destEff) dati.assegnato_nome = destEff;
    if (girata && destEff && !emailOk(destEmail)) return setErr(`Manca l'email di ${destEff}: aggiungila in Referenti oppure scrivila nell'anteprima.`);
    if (has('informato') && voce) dati.informato_voce = true;
    const mandaEmail = !tel && !!email && !!tEmail && !(has('informato') && voce) && !(has('coordinatore') && !emailOk(destEmail));
    if (mandaEmail && !emailOk(destEmail)) return setErr(has('informato') ? 'Manca l\'email del cliente: spunta «Informato a voce».' : 'Manca l\'indirizzo email del destinatario.');
    if (mandaEmail && email && tEmail) { const x = controlla({ ...email, a: destEmail }, tEmail.codice, dati, nomeTel); if (x) return setErr(x); }
    setInvio(true);
    const esito = await esegui(async () => {
      if (mandaEmail && email && tEmail) await inviaEmail({ ...email, a: destEmail }, tEmail.codice);
      if (tel) await rpc('centralino_avvisato_telefono', { p_pratica_id: p.id, p_trasf_id: null, p_chi: chiTel, p_destinatario: nomeTel || null, p_template: tEmail?.codice ?? tCliente?.codice ?? null, p_avanza: null });
      // facoltativa: in automatico parte subito; con Outlook si apre dopo nel compositore (una bozza per clic)
      const extraDopo = extra && !!emailExtra && !!tExtra && !automatico;
      if (extra && emailExtra && tExtra && automatico) await inviaEmail(emailExtra, tExtra.codice);
      if (app) await rpc('centralino_avviso_tecnico', { p_id: p.id });
      await avanza(s.key, dati);
      if (tecDiretto && avvisoCoordApp) {
        try { await rpc('centralino_avviso_tecnico', { p_id: p.id }); } catch (x) { toast(`Avviso nell'app non inviato: ${testoErrore(x)}`); }
      }
      if (tCliente && dopo) {
        if (voce) { await avanza(dopo.key, { informato_voce: true }); toast(`${p.numero}: tecnico ${dati.tecnico_nome} · cliente informato a voce`); }
        else if (emailOk(p.email) && !automatico) {
          // una sola finestra Outlook per clic: la seconda email (al cliente) si apre subito dopo nel compositore
          apriSeServe(); toast(`${p.numero}: tecnico ${dati.tecnico_nome}. Ora l'email al cliente: «Apri in Outlook».`); onFatto(); onEmail?.(dopo.template, true); return;
        } else if (emailOk(p.email)) {
          const ec = componi(tCliente, p, firma, p.email!, { tecnico_nome: String(dati.tecnico_nome), tecnico_quando: String(dati.tecnico_quando), tecnico_telefono: tecnico?.telefono ?? null } as Partial<Pratica>);
          const x = controlla(ec, tCliente.codice, dati, p.contatto_nome || p.cliente_nome); if (x) { toast(`${p.numero}: tecnico ${dati.tecnico_nome}. ${x}`); onFatto(); onEmail?.(dopo.template, true); return; }
          await inviaEmail(ec, tCliente.codice);
          await avanza(dopo.key, {});
          toast(`${p.numero}: tecnico ${dati.tecnico_nome} · cliente informato`);
        } else { toast(`${p.numero}: tecnico ${dati.tecnico_nome}. Manca l'email del cliente: informalo per telefono o scrivi l'email.`); onFatto(); onEmail?.(dopo.template, true); return; }
      } else if (!apriSeServe()) toast(ultimo ? `${p.numero}: pratica chiusa` : `${p.numero}: ${s.nome}`);
      onFatto();
      if (extraDopo) onEmail?.(tExtra!.codice, true);
    });
    if (!esito.ok && !esito.duplicato) { setErr(esito.messaggio); setInvio(false); }
  }

  telRef.current = () => { if (!invio) void salva(undefined, true); };

  const etichetta = invio ? 'Invio…'
    : has('coordinatore') ? (emailOk(destEmail) ? (automatico ? (tecDiretto ? 'Invia email al tecnico e avanti' : 'Invia email al coordinatore e avanti') : (tecDiretto ? 'Apri in Outlook (tecnico) e avanti' : 'Apri in Outlook (coordinatore) e avanti')) : 'Avanti')
    : has('informato') && voce ? (ultimo ? 'Chiudi la pratica' : 'Avanti')
    : tCliente ? 'Conferma e informa il cliente'
    : ultimo ? (email ? (automatico ? 'Invia e chiudi' : 'Apri in Outlook e chiudi') : 'Chiudi la pratica')
    : email ? (automatico ? 'Invia e avanti' : 'Apri in Outlook e avanti') : `Fatto: ${s.nome}`;

  return (
    <Modal titolo={`Passo ${idx + 1} di ${f.stadi.length}: ${s.nome}`} onClose={onClose} bloccaFuori>
      <form className="form" onSubmit={salva} ref={formRef} onKeyDown={e => {
        // Invio = Avanti (anche da tendine e caselle); non su pulsanti, link, riepiloghi o gruppi a scelta
        if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        if (/^(BUTTON|TEXTAREA|A|SUMMARY)$/.test(t.tagName) || t.closest('[role=radiogroup]')) { if (!(e.ctrlKey || e.metaKey)) return; }
        e.preventDefault(); if (!invio) formRef.current?.requestSubmit();
      }}>
        {has('coordinatore') && (<>
          <div className="field"><label htmlFor="av-coord">Coordinatore</label>
            <select id="av-coord" value={keyEff} onChange={e => sceltaCoord(e.target.value)}>
              {!keyEff && <option value="">— scegli —</option>}
              {coord.length > 0 && <optgroup label="Coordinatori">{coord.map(c => <option key={`c${c.nome}`} value={`c:${c.nome}`}>{c.nome} · {notaP(c)}{c.telefono || c.cellulare ? ` · ${c.cellulare || c.telefono}` : ''}</option>)}</optgroup>}
              {altri.length > 0 && <optgroup label="Altri referenti">{altri.map(c => <option key={`r${c.nome}`} value={`r:${c.nome}`}>{c.nome} · {notaP(c)}{c.telefono || c.cellulare ? ` · ${c.cellulare || c.telefono}` : ''}</option>)}</optgroup>}
              {tecCoord.length > 0 && <optgroup label="Tecnici">{tecCoord.map(t => <option key={`t${t.id}`} value={`t:${t.id}`}>{t.nome} · {t.assente ? 'in ferie oggi' : `disponibile · ${t.interventi_oggi} interventi oggi`}{t.telefono ? ` · ${t.telefono}` : ''}</option>)}</optgroup>}
            </select>
            {!coord.length && <p className="hint">Nessun coordinatore: impostalo in Referenti («Coordinamento interventi/sopralluoghi»).</p>}
            {tecDiretto?.assente && <p className="hint">In ferie oggi.</p>}</div>
          {tecDiretto && <label className="check"><input type="checkbox" checked={avvisoCoordApp} onChange={e => setAvvisoCoordApp(e.target.checked)} /> Avviso in app</label>}
          <button type="button" className={`btn-ghost ct-toggle ${telefonato ? 'on' : ''}`} aria-pressed={telefonato} onClick={() => setTelefonato(!telefonato)}>{telefonato ? '✓ Telefonato' : 'Telefonato'}</button>
        </>)}
        {has('tecnico') && (<>
          <div className="field"><label htmlFor="av-tec">{tablet ? 'TMQ firmatario' : 'Tecnico'}</label>
            <select id="av-tec" value={tecId} onChange={e => setTecId(e.target.value ? Number(e.target.value) : '')}><option value="">— scegli —</option>
              {tecnici.map(t => <option key={t.id} value={t.id}>{t.nome} · {t.assente ? 'assente oggi' : `${t.interventi_oggi} interventi oggi`}</option>)}</select></div>
          {tablet && <label className="check"><input type="checkbox" checked={verificato} onChange={e => setVerificato(e.target.checked)} /> Preventivo verificato</label>}
          {!tablet && <><div className="segmented ct-chips" role="radiogroup" aria-label="Quando" onKeyDown={tastiRadio}>
            {QUANDO.map((q, i) => { const on = !quandoAt && quando === q; return <button type="button" key={q} role="radio" aria-checked={on} tabIndex={tabRoving(on, i, !quandoAt && QUANDO.includes(quando))} className={on ? 'on' : ''} onClick={() => { setQuando(q); setQuandoAt(''); }}><span className="k-n" aria-hidden>{i + 1}</span>{q}</button>; })}
          </div>
          <div className="field"><label htmlFor="av-qat">Data e ora</label><input id="av-qat" type="datetime-local" value={quandoAt} onChange={e => setQuandoAt(e.target.value)} /></div></>}
          {tCliente && <label className="check"><input type="checkbox" checked={voce} onChange={e => setVoce(e.target.checked)} /> Informato a voce</label>}
          {tCliente && !emailOk(p.email) && <p className="hint">Manca email cliente.</p>}
        </>)}
        {(has('buono') || has('avviso')) && (<>
          {has('buono') && <div className="field"><label htmlFor="av-doc">N. buono</label><input id="av-doc" value={doc} onChange={e => setDoc(e.target.value)} /></div>}
          <label className="check"><input type="checkbox" checked={avvisato} onChange={e => setAvvisato(e.target.checked)} /> Tecnico avvisato</label>
          {p.tipo === 'sopralluogo' ? <label className="check"><input type="checkbox" checked={app} onChange={e => setApp(e.target.checked)} /> Invia anche l'avviso urgente nell'app{p.tecnico_dipendente_id ? '' : ' (tecnico senza app)'}</label> : p.tecnico_dipendente_id ? <label className="check"><input type="checkbox" checked={app} onChange={e => setApp(e.target.checked)} /> Invia anche l'avviso urgente nell'app</label> : null}
        </>)}
        {has('appuntamento') && (
          <div className="ct-riga">
            <input type="date" aria-label="Data" value={data} min={giornoRoma(new Date())} onChange={e => setData(e.target.value)} />
            <select aria-label="Fascia" value={fascia} onChange={e => setFascia(e.target.value)}><option value="">— fascia —</option><option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option></select>
          </div>)}
        {has('taylor') && (<>
          <label className="check"><input type="checkbox" checked={taylor} onChange={e => setTaylor(e.target.checked)} /> Alert Taylor</label>
          <div className="field"><label htmlFor="av-doc2">N. documento</label><input id="av-doc2" value={doc} onChange={e => setDoc(e.target.value)} /></div>
        </>)}
        {has('commerciale') && (
          <div className="field"><label htmlFor="av-com">Commerciale</label>
            <select id="av-com" value={comm} onChange={e => setComm(e.target.value)}><option value="">— scegli —</option>{elencoComm.map(c => <option key={c.nome} value={c.nome}>{c.nome}{c.nota ? ` · ${c.nota}` : ''}</option>)}</select></div>)}
        {has('destinatario') && (
          <div className="field"><label htmlFor="av-dest">Girata a</label>
            <select id="av-dest" value={destEff} onChange={e => setDest(e.target.value)}><option value="">{s.girata_facoltativa ? 'Nessuno: risposta data dal centralino' : '— scegli —'}</option>{destinatari.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.nota ? ` · ${d.nota}` : ''}</option>)}</select></div>)}
        {(has('email') || (has('informato') && !voce)) && !tEmail && <Banner s="warn">Questo passo richiede un'email. <button type="button" className="ct-link" onClick={() => onEmail?.(s.template)}>Scrivi l'email</button></Banner>}
        {email && (
          <details className="ct-anteprima-box">
            <summary>A: <b>{nomeTel || '—'}</b> ({NOME_RUOLO[tecDiretto ? 'tecnico' : ruoloModello(tEmail?.codice, tEmail?.oggetto)]}) · {destEmail || 'manca l\'email'} — {email.oggetto}</summary>
            <div className="field"><label htmlFor="av-a">A</label><input id="av-a" type="email" value={destEmail} onChange={e => setAMod(e.target.value)} /></div>
            {email.cc.length > 0 && <p className="hint">CC: {email.cc.join(', ')}</p>}
            <div className="ct-anteprima" dangerouslySetInnerHTML={{ __html: email.corpo }} />
            <button type="button" className="ct-link" onClick={() => onEmail?.(s.template)}>Modifica il testo</button>
          </details>)}
        {allegato && <Banner s="warn">{AVVISO_ALLEGATO}: il messaggio non contiene allegati.</Banner>}
        {tExtra && <label className="check"><input type="checkbox" checked={extra} disabled={!emailOk(p.email)} onChange={e => setExtra(e.target.checked)} /> {s.extra_etichetta || tExtra.nome}{!emailOk(p.email) ? ' — manca l\'email di chi ha chiamato' : ''}</label>}
        {has('informato') && <label className="check"><input type="checkbox" checked={voce} onChange={e => setVoce(e.target.checked)} /> Informato a voce</label>}
        {email && !voce && !emailOk(destEmail) && <p className="hint">{has('coordinatore') ? `Manca l'email di ${coordNome || 'questa persona'}: aggiungila in ${tecDiretto ? 'Dipendenti' : 'Referenti'} oppure basta «Telefonato».` : 'Apri l\'anteprima e scrivi l\'indirizzo.'}</p>}
        <details><summary>Nota (facoltativa)</summary><input aria-label="Nota" value={nota} onChange={e => setNota(e.target.value)} /></details>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{etichetta}</button>{telPossibile && <button type="button" className="btn-ghost" disabled={invio} onClick={() => salva(undefined, true)} title="Tasto T">Avvisato per telefono <kbd>T</kbd></button>}<span className="k-hint"><kbd>Invio</kbd> avanti · <kbd>Spazio</kbd> spunta · <kbd>↑</kbd><kbd>↓</kbd> nelle tendine · <kbd>Esc</kbd> chiudi</span></div>
      </form>
    </Modal>
  );
}

/** Passi senza dati da chiedere: si può avanzare con un clic. */
export const avanzaDiretto = (s: { requisiti?: string[] } | null | undefined) => !!s && !(s.requisiti?.length);
