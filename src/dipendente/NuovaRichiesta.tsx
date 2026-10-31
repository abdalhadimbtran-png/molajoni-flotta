import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { CHIAVE_BOZZA, nomeTipo, sessioneScaduta, sottotitoloTipo, useSessione, type Anteprima, type TipoAssenza } from './api';
import { Attesa, IcoSpunta, PassiRichiesta, RiepilogoRichiesta } from './componenti';
import {
  addGiorni, eLavorativo, eRiposo, festivitaDi, fmtQuantita, giornoLungo, giorniRiposoTesto, intervallo, minuti, piuOre, prossimoLavorativo, type Calendario,
} from './periodo';

interface Bozza {
  tipo: string | null; modo: 'giorni' | 'mezza'; primo: string; rientro: string; rientroManuale: boolean;
  meta: 'mattina' | 'pomeriggio'; dalle: string; alle: string; note: string;
}
const VUOTA: Bozza = { tipo: null, modo: 'giorni', primo: '', rientro: '', rientroManuale: false, meta: 'mattina', dalle: '', alle: '', note: '' };
function leggiBozza(): Bozza {
  try { const s = localStorage.getItem(CHIAVE_BOZZA); return s ? { ...VUOTA, ...JSON.parse(s) } : VUOTA; } catch { return VUOTA; }
}
function salvaBozza(b: Bozza | null) {
  try { if (b) localStorage.setItem(CHIAVE_BOZZA, JSON.stringify(b)); else localStorage.removeItem(CHIAVE_BOZZA); } catch { /* bozza solo in memoria */ }
}

interface Msg { l: 'ko' | 'warn' | 'info'; testo: ReactNode; azione?: ReactNode }

/** Nuova richiesta in 3 passi (UX § 2.4): tipo → quando → controlla e invia. Il passo sta in ?passo=. */
export default function NuovaRichiesta() {
  const { token, home, errore, scaduta, ricarica } = useSessione();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [b, setB] = useState<Bozza>(leggiBozza);
  const [ant, setAnt] = useState<Anteprima | null>(null);
  const [calcolo, setCalcolo] = useState(false);
  const [errAnt, setErrAnt] = useState<string | null>(null);
  const [inviata, setInviata] = useState<{ numero: string } | null>(null);
  const [invio, setInvio] = useState(false); const [errInvio, setErrInvio] = useState<string | null>(null);
  const [altri, setAltri] = useState(false);
  const titolo = useRef<HTMLHeadingElement>(null);

  const tipi = home?.tipi ?? [];
  const tipo: TipoAssenza | undefined = tipi.find(x => x.codice === b.tipo);
  const richiesto = Number(sp.get('passo')) || 1;
  const passo: 1 | 2 | 3 = !tipo ? 1 : richiesto === 3 ? 3 : richiesto === 2 ? 2 : 1;
  const vai = (p: 1 | 2 | 3) => setSp(p === 1 ? {} : { passo: String(p) });
  const aggiorna = (x: Partial<Bozza>) => setB(v => { const n = { ...v, ...x }; salvaBozza(n); return n; });

  useEffect(() => { window.scrollTo(0, 0); titolo.current?.focus(); }, [passo, inviata]);

  const cal: Calendario = useMemo(() => ({ riposo: home?.profilo.giorni_riposo ?? '0000011', festivita: home?.festivita ?? [] }), [home]);
  const aOre = tipo?.unita === 'ore';
  const mezza = !aOre && b.modo === 'mezza' && !!tipo?.mezza_giornata;

  // controlli immediati sul telefono (il conteggio vero lo fa il server)
  const msgs: Msg[] = [];
  const oggi = oggiISO();
  const nomeGiornoMaiusc = (d: string) => { const s = giornoLungo(d); return s.charAt(0).toUpperCase() + s.slice(1); };
  if (tipo && b.primo) {
    if (b.primo < oggi) msgs.push({ l: 'warn', testo: "Questa data è già passata. Puoi inviarla lo stesso: l'ufficio personale la vedrà come comunicazione." });
    if (!eLavorativo(cal, b.primo)) {
      const f = festivitaDi(cal, b.primo);
      msgs.push({ l: 'warn', testo: aOre || mezza ? `${nomeGiornoMaiusc(b.primo)} ${f ? `è festa (${f})` : 'è un tuo giorno di riposo'}: scegli un giorno in cui lavori.`
        : `${nomeGiornoMaiusc(b.primo)} non lavori già${f ? ` (${f})` : ''}. Scegli il primo giorno in cui saresti al lavoro.` });
    }
    if (!aOre && !mezza && b.rientro) {
      if (b.rientro <= b.primo) msgs.push({ l: 'ko', testo: 'Il giorno in cui torni deve essere dopo il primo giorno di assenza.' });
      else if (!eLavorativo(cal, b.rientro)) {
        const giusto = prossimoLavorativo(cal, addGiorni(b.rientro, -1));
        const f = festivitaDi(cal, b.rientro);
        msgs.push({ l: 'warn', testo: `${nomeGiornoMaiusc(b.rientro)} ${f ? `è festa (${f})` : eRiposo(cal, b.rientro) ? 'è un giorno di riposo' : 'non lavori'}. Di solito si torna ${giornoLungo(giusto)}.`,
          azione: <button type="button" className="btn-ghost btn-sm" onClick={() => aggiorna({ rientro: giusto, rientroManuale: true })}>Usa {giornoLungo(giusto)}</button> });
      }
    }
    if (aOre && b.dalle && b.alle) {
      const m = minuti(b.dalle, b.alle);
      if (m <= 0) msgs.push({ l: 'ko', testo: "L'ora di fine deve essere dopo l'ora di inizio." });
      else if (home && m > Number(home.profilo.ore_giornaliere) * 60) msgs.push({ l: 'warn', testo: `Sono più ore della tua giornata di lavoro (${Number(home.profilo.ore_giornaliere).toLocaleString('it-IT')} ore). Forse ti serve un giorno di ferie?` });
    }
  }
  const completo = !!tipo && !!b.primo && (aOre ? !!b.dalle && !!b.alle : mezza || !!b.rientro);
  const bloccato = msgs.some(m => m.l === 'ko');

  // anteprima dal server, 300 ms dopo l'ultima modifica
  const args = completo && !bloccato ? {
    p_token: token, p_tipo: tipo!.codice, p_primo_giorno: b.primo,
    p_rientro: aOre || mezza ? null : b.rientro,
    p_ora_inizio: aOre ? b.dalle : null, p_ora_fine: aOre ? b.alle : null, p_mezza_giornata: mezza,
  } : null;
  const chiave = args ? JSON.stringify(args) : '';
  useEffect(() => {
    setAnt(null); setErrAnt(null);
    if (!chiave) { setCalcolo(false); return; }
    setCalcolo(true);
    let vivo = true;
    const k = window.setTimeout(() => {
      rpc<Anteprima>('dipendente_anteprima', JSON.parse(chiave)).then(r => { if (vivo) setAnt(r); })
        .catch(e => { if (!vivo) return; if (sessioneScaduta(e)) scaduta(); else setErrAnt(testoErrore(e)); })
        .finally(() => { if (vivo) setCalcolo(false); });
    }, 300);
    return () => { vivo = false; window.clearTimeout(k); };
  }, [chiave, scaduta]);

  if (!home) return errore ? <div className="ph-msg ko">{errore}</div> : <Attesa />;

  const esci = () => { salvaBozza(null); nav('/t/ferie'); };
  const notaFinale = () => [mezza ? `Mezza giornata: ${b.meta}` : '', b.note.trim()].filter(Boolean).join(' · ') || null;

  async function invia(e: FormEvent) {
    e.preventDefault(); if (!args) return;
    setInvio(true); setErrInvio(null);
    try {
      const r = await rpc<{ ok: boolean; numero: string }>('dipendente_invia_richiesta', { ...args, p_note: notaFinale() });
      salvaBozza(null); setB(VUOTA); setInviata({ numero: r.numero }); ricarica();
    } catch (x) {
      if (sessioneScaduta(x)) { scaduta(); return; }
      const t = testoErrore(x);
      setErrInvio(t.startsWith('Connessione') ? 'La richiesta non è stata inviata. Controlla la connessione e premi di nuovo Invia.' : t);
    } finally { setInvio(false); }
  }

  /* ---------- Dopo l'invio ---------- */
  if (inviata) return (
    <div className="inviata">
      <span className="inviata-ico"><IcoSpunta /></span>
      <h1 className="tec-h1" ref={titolo} tabIndex={-1}>Richiesta inviata</h1>
      <p>L'ufficio personale ti risponde qui e con una notifica. Di solito entro 2 giorni lavorativi.</p>
      <span className="sub">Numero della richiesta: {inviata.numero}</span>
      <Link className="btn brand big" to="/t">Torna alla home</Link>
      <Link className="back-link" to="/t/ferie">Vedi le mie richieste</Link>
    </div>
  );

  /* ---------- Passo 1 · Cosa ti serve? ---------- */
  if (passo === 1) {
    const PRIMARI = ['FERIE', 'ROL', 'MAL'];
    const primari = tipi.length <= 4 ? tipi : tipi.filter(x => PRIMARI.includes(x.codice)).slice(0, 3);
    const resto = tipi.filter(x => !primari.includes(x));
    const scegli = (c: string) => { aggiorna({ tipo: c, ...(c !== b.tipo ? { modo: 'giorni' as const, dalle: '', alle: '' } : {}) }); vai(2); };
    return (
      <>
        <PassiRichiesta passo={1} />
        <h1 className="tec-h1" ref={titolo} tabIndex={-1}>Cosa ti serve?</h1>
        <div className="tiles tiles-tipi">
          {primari.map(x => <button key={x.codice} className={`tile${b.tipo === x.codice ? ' sel' : ''}`} onClick={() => scegli(x.codice)}>
            <span>{nomeTipo(x.codice, x.descrizione)}</span><span className="sub">{sottotitoloTipo(x)}</span></button>)}
          {resto.length > 0 && <button className={`tile${altri ? ' sel' : ''}`} aria-expanded={altri} onClick={() => setAltri(!altri)}>
            <span>Altro motivo</span><span className="sub">Visita, lutto, altri permessi</span></button>}
        </div>
        {altri && <fieldset className="seg"><legend className="lbl-sm">Scegli il motivo</legend>
          {resto.map(x => <label key={x.codice}><input type="radio" name="tipo" checked={b.tipo === x.codice} onChange={() => scegli(x.codice)} />
            <span style={{ flex: 1 }}>{nomeTipo(x.codice, x.descrizione)}<span className="sub" style={{ display: 'block' }}>{x.unita === 'ore' ? 'A ore' : 'A giorni'}</span></span></label>)}
        </fieldset>}
        {!tipi.length && <div className="ph-msg warn">In questo momento non ci sono tipi di assenza da chiedere. Chiama l'ufficio personale.</div>}
        <button className="back-link" onClick={esci}>Annulla</button>
      </>
    );
  }

  const nomeT = nomeTipo(tipo!.codice, tipo!.descrizione);
  const etichettaConteggio = (q: number) => tipo!.unita === 'ore' ? `${fmtQuantita(q, 'ore')} di ${nomeT.toLowerCase().startsWith('permesso') ? nomeT.toLowerCase() : `permesso (${nomeT.toLowerCase()})`}`
    : q === 0.5 ? `Mezza giornata di ${nomeT.toLowerCase()}` : `${fmtQuantita(q, 'giorni')} di ${nomeT.toLowerCase()}`;
  const avvisiServer = (ant?.avvisi ?? []).filter(a => !/^Festività non conteggiate|giorni già passati|^Saldo \d{4} insufficiente/.test(a));

  /* ---------- Passo 3 · Controlla e invia ---------- */
  if (passo === 3) {
    return (
      <form className="passo" onSubmit={invia}>
        <PassiRichiesta passo={3} />
        <h1 className="tec-h1" ref={titolo} tabIndex={-1}>Controlla e invia</h1>
        {!ant ? (calcolo ? <p className="sub">Calcolo…</p> : errAnt ? <div className="ph-msg ko">{errAnt}</div> : <div className="ph-msg warn">Mancano le date: torna indietro e completale.</div>)
          : !ant.ok ? <div className="ph-msg ko" role="alert">{ant.errori.join(' ')}</div>
          : <RiepilogoRichiesta conSaldo={tipo!.con_saldo} saldi={ant.saldi} modificabile={p => vai(p)}
              d={{ tipo: tipo!.codice, tipoDescrizione: tipo!.descrizione, unita: tipo!.unita, primo: ant.primo_giorno, ultimo: ant.ultimo_giorno, rientro: ant.rientro,
                oraInizio: ant.ora_inizio, oraFine: ant.ora_fine, mezza: ant.mezza_giornata, meta: mezza ? b.meta : null,
                quantita: Number(ant.quantita), festivitaEscluse: ant.festivita_escluse, note: b.note.trim() || null }} />}
        {avvisiServer.map((a, i) => <div key={i} className="ph-msg warn">{a}</div>)}
        {errInvio && <div className="ph-msg ko" role="alert">{errInvio}</div>}
        <button className="btn brand big" disabled={invio || !ant?.ok}>{invio ? 'Invio…' : 'Invia richiesta'}</button>
        <button type="button" className="back-link" onClick={() => vai(2)}>Indietro</button>
      </form>
    );
  }

  /* ---------- Passo 2 · Quando? ---------- */
  const ultimo = b.rientro && b.primo && b.rientro > b.primo ? addGiorni(b.rientro, -1) : null;
  let frase: ReactNode = null;
  if (b.primo) {
    if (aOre) frase = b.dalle && b.alle && minuti(b.dalle, b.alle) > 0 ? <><b>{nomeGiornoMaiusc(b.primo)}</b> dalle <b>{b.dalle}</b> alle <b>{b.alle}</b>.</> : null;
    else if (mezza) frase = <>Sei assente <b>{giornoLungo(b.primo)}, la {b.meta}</b>. {b.meta === 'mattina' ? 'Il pomeriggio' : 'La mattina'} lavori.</>;
    else if (ultimo) frase = <>Sei assente <b>{intervallo(b.primo, ultimo)}</b>. Torni al lavoro <b>{giornoLungo(b.rientro)}</b>.</>;
  }
  const riposiEsclusi = ant?.ok && ant.modalita === 'giorni' ? ant.giorni_calendario - ant.giorni.length - ant.festivita_escluse.length : 0;
  const cambiaPrimo = (v: string) => {
    if (aOre || mezza) { aggiorna({ primo: v }); return; }
    aggiorna({ primo: v, ...(!b.rientroManuale || !b.rientro || b.rientro <= v ? { rientro: v ? prossimoLavorativo(cal, v) : '', rientroManuale: false } : {}) });
  };
  return (
    <form className="passo" onSubmit={e => { e.preventDefault(); if (ant?.ok) vai(3); }}>
      <PassiRichiesta passo={2} />
      <h1 className="tec-h1" ref={titolo} tabIndex={-1}>Quando?</h1>
      <span className="sub tipo-scelto">{nomeT} · <button type="button" className="link" onClick={() => vai(1)}>Cambia</button></span>

      {!aOre && tipo!.mezza_giornata && <div className="segmented" role="group" aria-label="Durata">
        <button type="button" className={!mezza ? 'on' : ''} aria-pressed={!mezza} onClick={() => aggiorna({ modo: 'giorni' })}>Giorni interi</button>
        <button type="button" className={mezza ? 'on' : ''} aria-pressed={mezza} onClick={() => aggiorna({ modo: 'mezza' })}>Mezza giornata</button>
      </div>}

      <div className="field"><label htmlFor="primo">{aOre || mezza ? 'Giorno' : 'Primo giorno di assenza'}</label>
        <input id="primo" type="date" value={b.primo} min={addGiorni(oggi, -31)} onChange={e => cambiaPrimo(e.target.value)} /></div>

      {!aOre && !mezza && <div className="field"><label htmlFor="rientro">Giorno in cui torni al lavoro</label>
        <input id="rientro" type="date" value={b.rientro} min={b.primo ? addGiorni(b.primo, 1) : undefined} onChange={e => aggiorna({ rientro: e.target.value, rientroManuale: true })} />
        {b.primo && !b.rientroManuale && b.rientro && <span className="sub">Il primo giorno di lavoro dopo l'assenza. Puoi cambiarlo.</span>}</div>}

      {mezza && <div className="segmented" role="group" aria-label="Quale metà">
        <button type="button" className={b.meta === 'mattina' ? 'on' : ''} aria-pressed={b.meta === 'mattina'} onClick={() => aggiorna({ meta: 'mattina' })}>Mattina</button>
        <button type="button" className={b.meta === 'pomeriggio' ? 'on' : ''} aria-pressed={b.meta === 'pomeriggio'} onClick={() => aggiorna({ meta: 'pomeriggio' })}>Pomeriggio</button>
      </div>}

      {aOre && <>
        <div className="due-campi">
          <div className="field"><label htmlFor="dalle">Dalle</label><input id="dalle" type="time" step={900} value={b.dalle} onChange={e => aggiorna({ dalle: e.target.value })} /></div>
          <div className="field"><label htmlFor="alle">Alle</label><input id="alle" type="time" step={900} value={b.alle} onChange={e => aggiorna({ alle: e.target.value })} /></div>
        </div>
        <div className="scelte scelte-ore">{[1, 2, 4].map(h => <button type="button" key={h} disabled={!b.dalle} className={b.dalle && b.alle === piuOre(b.dalle, h) ? 'on' : ''}
          onClick={() => aggiorna({ alle: piuOre(b.dalle, h) })}>{h === 1 ? '1 ora' : `${h} ore`}</button>)}</div>
        {!b.dalle && <span className="sub">Scegli prima l'ora di inizio: le scorciatoie riempiono l'ora di fine.</span>}
      </>}

      {frase && <div className="ph-msg info" aria-live="polite">{frase}</div>}
      <div className="conteggio" aria-live="polite">
        {calcolo ? <span className="sub">Calcolo…</span>
          : ant?.ok ? <>
              <b>{etichettaConteggio(Number(ant.quantita))}</b>
              {ant.festivita_escluse.length > 0 && <span className="sub">Non contano: {ant.festivita_escluse.map(f => `${giornoLungo(f.data)} (${f.nome})`).join(', ')}.</span>}
              {riposiEsclusi > 0 && <span className="sub">Non contano i giorni di riposo ({giorniRiposoTesto(cal.riposo)}).</span>}
            </>
          : null}
      </div>
      {msgs.map((m, i) => <div key={i} className={`ph-msg ${m.l}`} role={m.l === 'ko' ? 'alert' : undefined}>{m.testo}{m.azione && <div style={{ marginTop: 8 }}>{m.azione}</div>}</div>)}
      {ant && !ant.ok && <div className="ph-msg ko" role="alert">{ant.errori.join(' ')}</div>}
      {errAnt && <div className="ph-msg ko">{errAnt}</div>}
      {avvisiServer.map((a, i) => <div key={`s${i}`} className="ph-msg warn">{a}</div>)}

      <div className="field"><label htmlFor="nota">{tipo!.codice === 'MAL' ? "Numero di protocollo del certificato (se ce l'hai)" : 'Vuoi aggiungere una nota? (facoltativo)'}</label>
        <textarea id="nota" rows={2} maxLength={450} value={b.note} onChange={e => aggiorna({ note: e.target.value })}
          placeholder={tipo!.codice === 'MAL' ? 'Es. 123456789' : 'Es. visita medica, matrimonio di mio fratello'} />
        <span className="sub">Non vuoi scrivere? Premi il microfono sulla tastiera e parla.</span></div>

      <button className="btn brand big" disabled={!ant?.ok || calcolo}>Avanti</button>
      <button type="button" className="back-link" onClick={() => vai(1)}>Indietro</button>
    </form>
  );
}
