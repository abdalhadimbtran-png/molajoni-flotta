import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { Banner, Modal, Pill, toast } from '../ui';
import {
  SEL_DIP, STATI, categoriaReparto, fmtQ, giornoBreve, giornoLungo, nomeTipo, num, periodo, piuGiorni, prossimoLavorativo, testoQuando,
  type Anteprima, type Dipendente, type Impatto, type Richiesta, type Stato, type TipoAssenza,
} from './comune';

export const PillStato = ({ stato }: { stato: Stato }) => <Pill s={STATI[stato][0]}>{STATI[stato][1]}</Pill>;

/** Testo di errore leggibile per le funzioni hr_* (mai codici a schermo). */
export function erroreHR(e: unknown): string {
  const m = testoErrore(e);
  if (/non è più in attesa/.test(m)) return 'Questa richiesta è già stata decisa.';
  if (/duplicate key/.test(m) && /codice/.test(m)) return 'Questo codice è già di un altro dipendente.';
  if (/Accesso riservato all'ufficio HR/.test(m)) return 'Permesso negato per questa operazione.';
  return m;
}

// ---------- Cosa cambia (impatto) ----------
interface Persona { id: number; categoria: string; reparto: string | null; attivo: boolean }
export function ImpattoRichiesta({ r, persone }: { r: Richiesta; persone?: Persona[] }) {
  const imp: Impatto | undefined = r.impatto;
  if (!imp) return null;
  const righe: { l: 'ok' | 'info' | 'warn' | 'ko'; m: ReactNode; sub?: string }[] = [];
  // colleghi assenti (stessa categoria e reparto), con i giorni
  const assenti = new Map<string, string[]>();
  imp.giorni.forEach(g => g.colleghi_assenti.forEach(n => assenti.set(n, [...(assenti.get(n) ?? []), g.giorno])));
  if (assenti.size) {
    const testo = [...assenti].map(([n, gg]) => `${n} (${gg.length > 1 ? `${giornoBreve(gg[0], false)}–${giornoBreve(gg[gg.length - 1], false)}` : giornoBreve(gg[0], false)})`).join(', ');
    righe.push({ l: 'info', m: <>Nello stesso periodo sono assenti: {testo}.</> });
  } else righe.push({ l: 'ok', m: 'Nessun altro collega assente in quei giorni.' });

  if (imp.tec) {
    const min = imp.giorni.reduce((a, g) => Math.min(a, g.tec_disponibili), Infinity);
    const tot = imp.giorni[0]?.tec_attivi ?? 0;
    if (Number.isFinite(min) && tot) righe.push({ l: min < tot / 2 ? 'warn' : 'info', m: `Tecnici disponibili nei giorni peggiori: ${min} su ${tot}.` });
    const att = imp.giorni.reduce((a, g) => Math.max(a, g.tec_in_attesa), 0);
    if (att) righe.push({ l: 'info', m: `Altri ${att} tecnici hanno una richiesta in valutazione negli stessi giorni.` });
    if (imp.interventi_totali > 0) {
      const el = imp.giorni.flatMap(g => g.interventi.map(i => `${giornoBreve(g.giorno, false)}${i.ora ? ` alle ${i.ora}` : ''}${i.luogo ? ` ${i.luogo}` : ''}`));
      righe.push({ l: 'warn', m: `Ha ${imp.interventi_totali} ${imp.interventi_totali === 1 ? 'intervento pianificato' : 'interventi pianificati'}: ${el.slice(0, 3).join(', ')}${el.length > 3 ? ', …' : ''}.`,
        sub: 'Se approvi, il responsabile flotta riceve l\'avviso di riassegnarli.' });
    } else righe.push({ l: 'ok', m: 'Nessun intervento pianificato in quei giorni.' });
  } else if (persone) {
    const gruppo = persone.filter(p => p.attivo && p.categoria === r.dipendente.categoria && (r.dipendente.reparto == null || p.reparto === r.dipendente.reparto));
    const maxAss = imp.giorni.reduce((a, g) => Math.max(a, g.colleghi_assenti.length), 0);
    const restano = gruppo.length - 1 - maxAss;
    if (gruppo.length > 1) righe.push({ l: restano < gruppo.length / 2 ? 'warn' : 'info', m: `In ${r.dipendente.reparto ?? categoriaReparto(r.dipendente.categoria, null)} restano ${restano} ${restano === 1 ? 'persona' : 'persone'} su ${gruppo.length}.` });
  }
  return (
    <div className="hr-impatto">
      <div className="lbl-sm">Cosa cambia</div>
      <div className="msgs">{righe.map((x, i) => <div key={i} className={`msg ${x.l}`}><div>{x.m}{x.sub && <div className="sub">{x.sub}</div>}</div></div>)}</div>
    </div>
  );
}

// ---------- Rifiuto con motivo obbligatorio ----------
const MOTIVI = ['Troppe persone assenti in quel periodo', 'Periodo di lavoro intenso', 'Ferie non sufficienti', 'Altro'];
export function ModaleRifiuto({ nome, onConferma, onClose }: { nome: string; onConferma: (motivo: string) => Promise<void>; onClose: () => void }) {
  const [scelta, setScelta] = useState('');
  const [motivo, setMotivo] = useState('');
  const [invio, setInvio] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function invia(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try { await onConferma(motivo.trim()); } catch (x) { setErr(erroreHR(x)); setInvio(false); }
  }
  return (
    <Modal titolo={`Rifiuta la richiesta di ${nome}`} onClose={onClose}>
      <form className="form" onSubmit={invia}>
        <div className="field"><span className="lbl-sm">Motivo</span>
          <div className="scelte-tec">{MOTIVI.map(m => <button type="button" key={m} className={scelta === m ? 'on' : ''}
            onClick={() => { setScelta(m); setMotivo(m === 'Altro' ? '' : m); }}>{m}</button>)}</div></div>
        <div className="field"><label htmlFor="rif-mot">Motivo (obbligatorio)</label>
          <textarea id="rif-mot" rows={3} required maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus /></div>
        <p className="hint">{nome} vedrà questo motivo nell'app.</p>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn brand" disabled={invio || motivo.trim().length < 3}>{invio ? 'Invio…' : 'Rifiuta richiesta'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

/** Approva / rifiuta: esito per il toast. */
export async function decidi(r: Richiesta, decisione: 'approva' | 'rifiuta', motivo?: string) {
  const x = await rpc<{ stato: string; avvisi: string[]; auto_decisione: boolean }>('hr_decidi_richiesta', { p_id: r.id, p_decisione: decisione, p_motivo: motivo ?? null });
  const nome = r.dipendente.nome.split(' ')[0];
  if (decisione === 'rifiuta') toast(`Richiesta rifiutata. ${nome} riceve la notifica.`);
  else if (r.impatto?.interventi_totali) toast(`Approvata. Il responsabile flotta riceve l'avviso per ${r.impatto.interventi_totali} interventi.`);
  else toast(`Approvata. ${nome} riceve la notifica.`);
  if (x.avvisi?.length) window.setTimeout(() => toast(x.avvisi.join(' ')), 3600);
  return x;
}

// ---------- Riepilogo della richiesta ----------
export function RiepilogoRichiesta({ r }: { r: Richiesta }) {
  return (
    <dl className="riepilogo">
      <dt>Dipendente</dt><dd><b>{r.dipendente.nome}</b> <span className="sub">{categoriaReparto(r.dipendente.categoria, r.dipendente.reparto)} · {r.dipendente.codice}</span></dd>
      <dt>Tipo</dt><dd>{nomeTipo(r.tipo_descrizione)} <span className="sub">{r.numero}</span></dd>
      <dt>Assente</dt><dd>{r.ora_inizio ? `${giornoLungo(r.primo_giorno)} dalle ${r.ora_inizio} alle ${r.ora_fine}`
        : r.mezza_giornata ? `${giornoLungo(r.primo_giorno)}, mezza giornata`
        : r.primo_giorno === r.ultimo_giorno ? giornoLungo(r.primo_giorno) : `da ${giornoLungo(r.primo_giorno)} a ${giornoLungo(r.ultimo_giorno)}`}</dd>
      {!r.ora_inizio && !r.mezza_giornata && <><dt>Rientro</dt><dd>{giornoLungo(r.rientro)}</dd></>}
      <dt>Conteggio</dt><dd>{fmtQ(r.quantita, r.unita)}</dd>
      {r.note && <><dt>{r.tipo === 'MAL' ? 'Protocollo' : 'Nota'}</dt><dd><i>«{r.note}»</i></dd></>}
      <dt>Stato</dt><dd><PillStato stato={r.stato} /></dd>
    </dl>
  );
}

export function StoriaRichiesta({ r }: { r: Richiesta }) {
  const voci: { l: 'info' | 'ok' | 'ko' | 'na'; t: string }[] = [
    { l: 'info', t: `${r.creata_da === 'hr' ? `Inserita dall'ufficio personale${r.creata_da_utente ? ` (${r.creata_da_utente})` : ''}` : 'Inviata dal dipendente'} · ${fmtTs(r.creato_il)}` },
  ];
  if (r.deciso_il) voci.push({ l: r.stato === 'rifiutata' ? 'ko' : 'ok', t: `${r.stato === 'rifiutata' ? 'Rifiutata' : 'Approvata'}${r.deciso_da ? ` da ${r.deciso_da}` : ''} · ${fmtTs(r.deciso_il)}${r.motivo_decisione ? ` · motivo: ${r.motivo_decisione}` : ''}` });
  if (r.annullata_il) voci.push({ l: 'na', t: `Annullata ${r.annullata_da === 'dipendente' ? 'dal dipendente' : `dall'ufficio personale${r.annullata_da_utente ? ` (${r.annullata_da_utente})` : ''}`} · ${fmtTs(r.annullata_il)}${r.motivo_annullamento ? ` · ${r.motivo_annullamento}` : ''}` });
  if (r.auto_decisione) voci.push({ l: 'info', t: 'Decisa dall\'account collegato allo stesso dipendente: l\'amministratore la vede nell\'elenco delle auto-decisioni.' });
  return <div className="msgs hr-storia">{voci.map((v, i) => <div key={i} className={`msg ${v.l === 'na' ? 'info' : v.l}`}>{v.t}</div>)}</div>;
}
const fmtTs = (ts: string) => new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

/** Avviso per le richieste che solo l'account collegato può decidere (regola auto-decisione). */
export function AvvisoDecisore({ r, mio }: { r: Richiesta; mio: number | null }) {
  if (!r.puo_decidere) return <Banner s="warn">Questa richiesta riguarda {r.decide_solo ?? r.dipendente.nome}, che ha un account dell'ufficio personale: la decide solo lei/lui dal proprio account. Tu la vedi soltanto.</Banner>;
  if (mio != null && r.dipendente_id === mio) return <Banner s="warn">Questa è una tua richiesta: puoi deciderla tu, e l'amministratore vede la decisione.</Banner>;
  return null;
}

// ---------- Dettaglio con azioni (calendario, dipendenti) ----------
export function ModaleDettaglio({ id, mio, onClose, onCambiato }: { id: number; mio: number | null; onClose: () => void; onCambiato: () => void }) {
  const [r, setR] = useState<Richiesta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rifiuta, setRifiuta] = useState(false);
  const [annulla, setAnnulla] = useState(false);
  const [invio, setInvio] = useState(false);
  useEffect(() => {
    supabase.from('richieste_assenza').select('stato,dipendente_id,primo_giorno,ultimo_giorno').eq('id', id).single()
      .then(async ({ data, error }) => {
        if (error || !data) { setErr(erroreHR(error)); return; }
        const l = await rpc<Richiesta[]>('hr_richieste', { p_stato: data.stato, p_da: data.primo_giorno, p_a: data.ultimo_giorno, p_dipendente: data.dipendente_id });
        const x = l.find(y => y.id === id); if (x) setR(x); else setErr('Richiesta non trovata.');
      }).then(undefined, e => setErr(erroreHR(e)));
  }, [id]);
  async function approva() {
    if (!r) return; setInvio(true);
    try { await decidi(r, 'approva'); onCambiato(); } catch (e) { setErr(erroreHR(e)); setInvio(false); }
  }
  if (rifiuta && r) return <ModaleRifiuto nome={r.dipendente.nome} onClose={() => setRifiuta(false)} onConferma={async m => { await decidi(r, 'rifiuta', m); onCambiato(); }} />;
  if (annulla && r) return <ModaleAnnulla r={r} onClose={() => setAnnulla(false)} onFatto={onCambiato} />;
  return (
    <Modal titolo={r ? `${nomeTipo(r.tipo_descrizione)} · ${r.dipendente.nome}` : 'Richiesta'} onClose={onClose}>
      {err && <Banner s="ko">{err}</Banner>}
      {!r && !err && <p className="sub">Caricamento…</p>}
      {r && <div className="form">
        <RiepilogoRichiesta r={r} />
        {r.saldi?.map(s => <div key={s.anno} className={`msg ${s.saldo_dopo_approvazione < 0 ? 'warn' : 'info'}`}>Saldo {s.anno}: {num(s.saldo)} → {num(s.saldo_dopo_approvazione)} {r.unita === 'ore' ? 'ore' : 'giorni'}</div>)}
        <StoriaRichiesta r={r} />
        <AvvisoDecisore r={r} mio={mio} />
        {r.puo_decidere && <div className="row-flex">
          {r.stato === 'in_attesa' && <><button className="btn" onClick={approva} disabled={invio}>{invio ? 'Salvataggio…' : 'Approva'}</button>
            <button className="btn-ghost" onClick={() => setRifiuta(true)}>Rifiuta</button></>}
          {(r.stato === 'approvata' || r.stato === 'in_attesa') && <button className="btn-ghost" onClick={() => setAnnulla(true)}>{r.stato === 'approvata' ? "Annulla l'assenza" : 'Annulla la richiesta'}</button>}
        </div>}
      </div>}
    </Modal>
  );
}

/** Annullamento da HR: conferma obbligatoria (non si torna indietro), motivo richiesto dal server. «No» ha il focus. */
export function ModaleAnnulla({ r, onClose, onFatto }: { r: Richiesta; onClose: () => void; onFatto: () => void }) {
  const nome = r.dipendente.nome;
  const [motivo, setMotivo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => { no.current?.focus(); }, []);
  async function conferma() {
    setErr(null); setInvio(true);
    try { await rpc('hr_annulla_richiesta', { p_id: r.id, p_motivo: motivo.trim() }); toast(`Assenza annullata. ${nome.split(' ')[0]} riceve una notifica.`); onFatto(); }
    catch (e) { setErr(erroreHR(e)); setInvio(false); }
  }
  return (
    <Modal titolo={`Annullare l'assenza di ${nome}?`} onClose={onClose}>
      <div className="form">
        <p>{nome} riceve una notifica{r.unita && r.tipo !== 'MAL' ? ' e i giorni tornano nel saldo' : ''}. {nomeTipo(r.tipo_descrizione)} · {periodo(r)}.</p>
        <div className="field"><label htmlFor="ann-mot">Motivo (lo vede il dipendente)</label>
          <input id="ann-mot" value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} placeholder="Es. inserita per errore" /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn brand" onClick={conferma} disabled={invio || motivo.trim().length < 3}>{invio ? 'Salvataggio…' : 'Sì, annulla'}</button>
          <button ref={no} className="btn-ghost" onClick={onClose}>No</button></div>
      </div>
    </Modal>
  );
}

// ---------- Inserisci un'assenza per conto di un dipendente ----------
type Modo = 'giorni' | 'mezza' | 'ore';
export function ModaleInserisci({ preDipendente, onClose, onSalvato }: { preDipendente?: number; onClose: () => void; onSalvato: () => void }) {
  const [dip, setDip] = useState<Dipendente[]>([]);
  const [tipi, setTipi] = useState<TipoAssenza[]>([]);
  const [fest, setFest] = useState<Set<string>>(new Set());
  const [cerca, setCerca] = useState('');
  const [f, setF] = useState({ dip: preDipendente ? String(preDipendente) : '', tipo: 'FERIE', modo: 'giorni' as Modo, primo: '', rientro: '', rientroMano: false, dalle: '09:00', alle: '11:00', note: '', approva: true });
  const [ant, setAnt] = useState<Anteprima | null>(null);
  const [calcolo, setCalcolo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  useEffect(() => {
    Promise.all([
      supabase.from('dipendenti').select(SEL_DIP).eq('attivo', true).order('cognome'),
      supabase.from('tipi_assenza').select('*').eq('attivo', true).order('ordine'),
      supabase.from('festivita').select('data').eq('attiva', true).gte('data', piuGiorni(oggiISO(), -60)).lte('data', piuGiorni(oggiISO(), 500)),
    ]).then(([d, t, fe]) => {
      setDip((d.data ?? []) as Dipendente[]); setTipi((t.data ?? []) as TipoAssenza[]);
      setFest(new Set((fe.data ?? []).map((x: { data: string }) => x.data)));
    });
  }, []);
  const tipo = tipi.find(x => x.codice === f.tipo);
  const persona = dip.find(x => String(x.id) === f.dip);
  const modi: [Modo, string][] = tipo?.unita === 'ore' ? [['ore', 'A ore'], ['giorni', 'Giorni interi']] : tipo?.mezza_giornata ? [['giorni', 'Giorni interi'], ['mezza', 'Mezza giornata']] : [['giorni', 'Giorni interi']];
  const modo: Modo = modi.some(m => m[0] === f.modo) ? f.modo : modi[0][0];

  function setPrimo(v: string) {
    const auto = v && persona ? prossimoLavorativo(v, persona.giorni_riposo, fest) : '';
    setF(x => ({ ...x, primo: v, rientro: x.rientroMano && x.rientro > v ? x.rientro : auto }));
  }
  // anteprima dal server con attesa di 300 ms
  useEffect(() => {
    setAnt(null); setErr(null);
    if (!f.dip || !f.primo || !tipo) return;
    const args = { p_dipendente: Number(f.dip), p_tipo: f.tipo, p_primo_giorno: f.primo,
      p_rientro: modo === 'giorni' ? f.rientro || null : null, p_ora_inizio: modo === 'ore' ? f.dalle : null, p_ora_fine: modo === 'ore' ? f.alle : null,
      p_mezza_giornata: modo === 'mezza' };
    setCalcolo(true);
    const k = window.setTimeout(() => {
      rpc<Anteprima>('hr_anteprima', args).then(setAnt).catch(e => setErr(erroreHR(e))).finally(() => setCalcolo(false));
    }, 300);
    return () => window.clearTimeout(k);
  }, [f.dip, f.tipo, f.primo, f.rientro, f.dalle, f.alle, modo, tipo]);

  async function salva(e: FormEvent) {
    e.preventDefault(); if (!ant?.ok) return;
    setInvio(true); setErr(null);
    try {
      const x = await rpc<{ messaggio: string }>('hr_inserisci_richiesta', { p_dipendente: Number(f.dip), p_tipo: f.tipo, p_primo_giorno: f.primo,
        p_rientro: modo === 'giorni' ? f.rientro : null, p_ora_inizio: modo === 'ore' ? f.dalle : null, p_ora_fine: modo === 'ore' ? f.alle : null,
        p_mezza_giornata: modo === 'mezza', p_note: f.note.trim() || null, p_approva: f.approva });
      toast(x.messaggio); onSalvato();
    } catch (x) { setErr(erroreHR(x)); setInvio(false); }
  }
  const filtrati = dip.filter(x => !cerca || `${x.nome} ${x.cognome} ${x.codice}`.toLowerCase().includes(cerca.toLowerCase()));
  const mal = f.tipo === 'MAL';
  return (
    <Modal titolo="Inserisci un'assenza" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="form grid2">
          <div className="field"><label htmlFor="ins-cerca">Cerca dipendente</label><input id="ins-cerca" value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Nome o codice" /></div>
          <div className="field"><label htmlFor="ins-dip">Dipendente</label>
            <select id="ins-dip" required value={f.dip} onChange={e => setF({ ...f, dip: e.target.value, primo: '', rientro: '', rientroMano: false })}>
              <option value="">Scegli…</option>{filtrati.map(x => <option key={x.id} value={x.id}>{x.cognome} {x.nome} · {x.codice}</option>)}</select></div>
          <div className="field"><label htmlFor="ins-tipo">Tipo di assenza</label>
            <select id="ins-tipo" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>
              {tipi.map(x => <option key={x.codice} value={x.codice}>{nomeTipo(x.descrizione)}</option>)}</select></div>
          <div className="field"><span className="lbl-sm">Durata</span>
            <div className="segmented" role="group" aria-label="Durata">{modi.map(([k, l]) => <button type="button" key={k} className={modo === k ? 'on' : ''} onClick={() => setF({ ...f, modo: k })}>{l}</button>)}</div></div>
          <div className="field"><label htmlFor="ins-primo">{modo === 'giorni' ? 'Primo giorno di assenza' : 'Giorno'}</label>
            <input id="ins-primo" type="date" required value={f.primo} onChange={e => setPrimo(e.target.value)} disabled={!f.dip} /></div>
          {modo === 'giorni' && <div className="field"><label htmlFor="ins-rientro">Rientro (primo giorno di nuovo al lavoro)</label>
            <input id="ins-rientro" type="date" required min={f.primo ? piuGiorni(f.primo, 1) : undefined} value={f.rientro} onChange={e => setF({ ...f, rientro: e.target.value, rientroMano: true })} disabled={!f.primo} /></div>}
          {modo === 'ore' && <div className="row-flex"><div className="field"><label htmlFor="ins-dalle">Dalle</label><input id="ins-dalle" type="time" step={900} value={f.dalle} onChange={e => setF({ ...f, dalle: e.target.value })} /></div>
            <div className="field"><label htmlFor="ins-alle">Alle</label><input id="ins-alle" type="time" step={900} value={f.alle} onChange={e => setF({ ...f, alle: e.target.value })} /></div></div>}
        </div>

        <div className="hr-anteprima" aria-live="polite">
          {calcolo && <span className="sub">Calcolo…</span>}
          {ant && !calcolo && <>
            {ant.ok && <div className="ph-msg info">
              {ant.modalita === 'giorni' ? <>Assente <b>{ant.primo_giorno === ant.ultimo_giorno ? giornoLungo(ant.primo_giorno) : `da ${giornoLungo(ant.primo_giorno)} a ${giornoLungo(ant.ultimo_giorno)}`}</b>. Torna al lavoro <b>{giornoLungo(ant.rientro)}</b>.</>
                : ant.modalita === 'ore' ? <><b>{giornoLungo(ant.primo_giorno)}</b> dalle {ant.ora_inizio} alle {ant.ora_fine}.</> : <><b>{giornoLungo(ant.primo_giorno)}</b>, mezza giornata.</>}
              <div><b>{fmtQ(ant.quantita, ant.unita)}</b> di {nomeTipo(ant.tipo_descrizione).toLowerCase()}{ant.festivita_escluse.length ? ` · Non contano: ${ant.festivita_escluse.map(x => `${testoQuando(x.data).slice(0, 5)} (${x.nome})`).join(', ')}` : ''}</div>
            </div>}
            {ant.saldi.map(s => <div key={s.anno} className="mini-stat hr-mini"><span>Saldo {s.anno} oggi <b>{num(s.saldo)}</b></span><span>Dopo questa <b className={s.saldo_dopo < 0 ? 'hr-neg' : ''}>{num(s.saldo_dopo)}</b></span></div>)}
            {tipo && !tipo.con_saldo && ant.ok && <p className="sub">Questa assenza non tocca il saldo di ferie e permessi.</p>}
            {ant.errori.map((x, i) => <div key={i} className="msg ko" role="alert">{x}</div>)}
            {ant.avvisi.filter(x => !x.startsWith('Festività non conteggiate')).map((x, i) => <div key={i} className="msg warn">{x}</div>)}
          </>}
        </div>

        <div className="field"><label htmlFor="ins-note">{mal ? 'Numero di protocollo del certificato (se c\'è)' : 'Nota (facoltativa)'}</label>
          <input id="ins-note" value={f.note} maxLength={500} onChange={e => setF({ ...f, note: e.target.value })} placeholder={mal ? 'Es. 123456789' : 'Es. comunicata al telefono'} />
          {mal && <span className="hint" style={{ marginTop: 0 }}>Mai la diagnosi: basta il numero di protocollo.</span>}</div>
        <label className="chk"><input type="checkbox" checked={f.approva} onChange={e => setF({ ...f, approva: e.target.checked })} /> Approvata subito</label>
        <p className="hint" style={{ marginTop: 0 }}>Il dipendente riceve una notifica nell'app.</p>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={!ant?.ok || invio || calcolo}>{invio ? 'Salvataggio…' : 'Salva assenza'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

/** Ordina per primo giorno (la più vicina in alto). */
export const perPrimoGiorno = (a: Richiesta, b: Richiesta) => a.primo_giorno.localeCompare(b.primo_giorno) || a.id - b.id;
