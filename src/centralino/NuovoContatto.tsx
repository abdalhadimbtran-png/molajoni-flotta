import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal } from '../ui';
import { CANALI, RICHIESTE, STATI_CLIENTE, type StatoCliente, SCRIPT_TELEFONO, richiedeAppuntamento, type Canale, type Flusso, type TipoPratica } from '../lib/centralino/tipi';
import { giornoRoma, lavorativo, prossimoLavorativo, scadenzaSla, testoResiduo, type RegolaSla } from '../lib/centralino/sla';
import { useConfig } from './comune';
import { Ic, iconaCanale } from './componenti';

interface Cliente { codice: string | null; nome: string; stato_cliente?: StatoCliente | null; sedi?: number; fonte: 'taylor' | 'pratiche'; contatto?: string | null; telefono?: string | null; email?: string | null; indirizzo?: string | null; cap?: string | null; comune?: string | null }
interface Sede { impianto: string; indirizzo: string; cap: string | null; comune: string | null }

/** Primo obiettivo SLA del flusso (per l'anteprima nel modulo). */
function primoSla(f: Flusso | undefined, sottotipo: string): RegolaSla | null {
  if (!f) return null;
  for (const s of f.stadi.slice(1)) { const r = f.sla_sottotipi?.[sottotipo]?.[s.key] ?? s.sla; if (r) return r; }
  return null;
}

/** Nuovo contatto: una schermata, pochi tocchi (obiettivo < 30 secondi). */
export default function NuovoContatto({ onClose, onCreata }: { onClose: () => void; onCreata: (id: number, trasferisci: boolean) => void }) {
  const { config } = useConfig();
  const [canale, setCanale] = useState<Canale>('telefono');
  const [richiesta, setRichiesta] = useState<TipoPratica | 'offerta' | null>(null);
  const [sottotipo, setSottotipo] = useState('');
  const [grande, setGrande] = useState(false);
  const [importo, setImporto] = useState('');
  const [cli, setCli] = useState<Cliente | null>(null);
  const [q, setQ] = useState('');
  const [sugg, setSugg] = useState<Cliente[]>([]);
  const [sedi, setSedi] = useState<Sede[]>([]);
  const [sede, setSede] = useState('');
  const [f, setF] = useState({ contatto_nome: '', telefono: '', email: '', indirizzo: '', cap: '', comune: '', descrizione: '', commerciale: '' });
  const [data, setData] = useState('');
  const [fascia, setFascia] = useState<'' | 'mattina' | 'pomeriggio'>('');
  const [tacit, setTacit] = useState(false);
  const [urgente, setUrgente] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [senzaApp, setSenzaApp] = useState(false);
  const [invio, setInvio] = useState(false);
  const [stato, setStato] = useState<StatoCliente | null>(null);
  const [statoMan, setStatoMan] = useState(false);
  const [trasf, setTrasf] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);

  const tipo: TipoPratica | null = richiesta === 'offerta' ? (grande || Number(importo) > 1000 ? 'offerta_grande' : 'offerta_piccola') : richiesta;
  const flusso = config?.flussi.find(x => x.tipo === tipo);
  const allarme = tipo === 'manutenzione' && sottotipo === 'Allarme sonoro attivo';
  const fest = config?.festivi ?? new Set<string>();
  const oggi = giornoRoma(new Date());
  const domani = prossimoLavorativo(oggi, fest);
  const dopodomani = prossimoLavorativo(domani, fest);
  const regola = primoSla(flusso, sottotipo);
  const scad = regola && config ? scadenzaSla(new Date(), regola, fest, config.impostazioni.orario) : null;
  const commerciali = config?.impostazioni.commerciali ?? [];

  useEffect(() => { if (allarme) { setData(lavorativo(oggi, fest) ? oggi : domani); setUrgente(true); } }, [allarme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (richiesta === 'offerta' && importo) setGrande(Number(importo) > 1000); }, [importo, richiesta]);

  // suggerimenti clienti (Taylor + pratiche già passate dal centralino)
  useEffect(() => {
    if (cli || q.trim().length < 2) { setSugg([]); return; }
    const k = window.setTimeout(() => { rpc<Cliente[]>('centralino_clienti', { p_q: q }).then(setSugg, () => setSugg([])); }, 200);
    return () => window.clearTimeout(k);
  }, [q, cli]);

  // stato cliente proposto: da Taylor (interventi recenti → attivo) o «nuovo»
  useEffect(() => {
    if (statoMan) return;
    if (cli?.stato_cliente) { setStato(cli.stato_cliente); return; }
    if (q.trim().length < 3) { setStato(null); return; }
    const k = window.setTimeout(() => { rpc<StatoCliente>('centralino_stato_cliente', { p_codice: cli?.codice ?? null, p_nome: q }).then(setStato, () => undefined); }, 400);
    return () => window.clearTimeout(k);
  }, [cli, q, statoMan]);

  function scegli(c: Cliente) {
    setCli(c); setQ(c.nome); setSugg([]); setSede('');
    setF(x => ({ ...x, contatto_nome: x.contatto_nome || c.contatto || '', telefono: x.telefono || c.telefono || '', email: x.email || c.email || '', indirizzo: c.indirizzo || x.indirizzo, cap: c.cap || x.cap, comune: c.comune || x.comune }));
    if (c.codice && c.fonte === 'taylor') rpc<Sede[]>('centralino_sedi', { p_codice: c.codice }).then(setSedi, () => setSedi([])); else setSedi([]);
  }
  function scegliSede(imp: string) {
    setSede(imp);
    const s = sedi.find(x => x.impianto === imp);
    if (s) setF(x => ({ ...x, indirizzo: s.indirizzo, cap: s.cap ?? '', comune: s.comune ?? '' }));
  }

  const manca = useMemo(() => {
    const l: string[] = [];
    if (!tipo) l.push('cosa chiede');
    if (!q.trim()) l.push('cliente');
    if (data && !fascia) l.push('mattina o pomeriggio');
    return l;
  }, [tipo, q, data, fascia]);

  async function salva(e?: FormEvent) {
    e?.preventDefault(); setErr(null);
    if (manca.length) { setErr(`Manca: ${manca.join(', ')}.`); return; }
    if (tipo && richiedeAppuntamento(tipo) && !data && !senzaApp) { setSenzaApp(true); return; }
    setInvio(true);
    const com = commerciali.find(c => c.nome === f.commerciale);
    try {
      const r = await rpc<{ id: number }>('centralino_crea', { p: {
        canale, tipo, sottotipo: sottotipo || null, priorita: urgente ? 'urgente' : 'normale',
        cliente_codice: cli?.codice ?? null, cliente_nome: q.trim(), sede: sede || null,
        contatto_nome: f.contatto_nome, telefono: f.telefono, email: f.email, indirizzo: f.indirizzo, cap: f.cap, comune: f.comune, descrizione: f.descrizione,
        importo_stimato: richiesta === 'offerta' && importo ? Number(importo) : null,
        appuntamento_data: data || null, appuntamento_fascia: data ? fascia || null : null, tacitazione_tentata: tacit,
        commerciale_nome: com?.nome ?? null, commerciale_email: com?.email ?? null,
      } });
      if (statoMan && stato) await rpc('centralino_imposta_stato_cliente', { p_id: r.id, p_stato: stato }).catch(() => undefined);
      onCreata(r.id, trasf);
    } catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }

  return (
    <Modal titolo="Nuovo contatto" onClose={onClose}>
      <form className="ct-nuovo" onSubmit={salva} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salva(); }}>
        {canale === 'telefono' && <p className="ct-script">«{SCRIPT_TELEFONO}»</p>}

        <div className="ct-sez"><span className="ct-sez-n">1</span><b>Canale</b></div>
        <div className="ct-big ct-big-canali" role="radiogroup" aria-label="Canale">
          {CANALI.map(c => (
            <button type="button" key={c.v} role="radio" aria-checked={canale === c.v} className={canale === c.v ? 'on' : ''} onClick={() => setCanale(c.v)}>
              <Ic n={iconaCanale(c.v)} size={22} /><span>{c.l}</span></button>))}
        </div>

        <div className="ct-sez"><span className="ct-sez-n">2</span><b>Cosa chiede?</b></div>
        <div className="ct-big ct-big-tipi" role="radiogroup" aria-label="Tipo di richiesta">
          {RICHIESTE.map(r => (
            <button type="button" key={r.v} role="radio" aria-checked={richiesta === r.v} className={richiesta === r.v ? 'on' : ''}
              onClick={() => { setRichiesta(r.v); setSottotipo(''); setSenzaApp(false); if (r.v !== 'manutenzione') setUrgente(false); }}>
              <Ic n={r.ic} size={22} /><span><b>{r.l}</b><span className="sub">{r.breve}</span></span></button>))}
        </div>
        {flusso && flusso.sottotipi.length > 0 && (
          <div className="ct-chips" role="radiogroup" aria-label="Dettaglio">
            {flusso.sottotipi.map(st => (
              <button type="button" key={st} role="radio" aria-checked={sottotipo === st} className={`${sottotipo === st ? 'on' : ''} ${flusso.sottotipi_urgenti.includes(st) ? 'urg' : ''}`} onClick={() => setSottotipo(sottotipo === st ? '' : st)}>{st}</button>))}
          </div>)}
        {allarme && (
          <div className="ct-allarme">
            <b>Allarme sonoro attivo: intervento in giornata.</b>
            <label className="check"><input type="checkbox" checked={tacit} onChange={e => setTacit(e.target.checked)} /> Tacitazione tentata al telefono</label>
          </div>)}
        {richiesta === 'offerta' && (
          <div className="ct-riga">
            <div className="segmented" role="group" aria-label="Valore">
              <button type="button" className={!grande ? 'on' : ''} onClick={() => { setGrande(false); if (Number(importo) > 1000) setImporto(''); }}>Fino a 1.000 €</button>
              <button type="button" className={grande ? 'on' : ''} onClick={() => setGrande(true)}>Oltre 1.000 €</button>
            </div>
            <div className="field ct-importo"><label htmlFor="ct-imp">Importo stimato (facoltativo)</label>
              <input id="ct-imp" inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="€" /></div>
            {grande && commerciali.length > 0 && (
              <div className="field"><label htmlFor="ct-com">Commerciale</label>
                <select id="ct-com" value={f.commerciale} onChange={e => setF({ ...f, commerciale: e.target.value })}>
                  <option value="">— da assegnare —</option>{commerciali.map(c => <option key={c.nome}>{c.nome}</option>)}
                </select></div>)}
          </div>)}

        <div className="ct-sez"><span className="ct-sez-n">3</span><b>Cliente</b><span className="sub">dati minimi: nome e telefono bastano</span></div>
        <div className="ct-cliente">
          <div className="field ct-ac">
            <label htmlFor="ct-cli">Cliente / condominio / azienda</label>
            <input id="ct-cli" ref={qRef} autoComplete="off" value={q} onChange={e => { setQ(e.target.value); if (cli) { setCli(null); setSedi([]); setSede(''); } }} placeholder="Scrivi il nome o il codice cliente" />
            {stato && <span className={`ct-stato-cli pill ${STATI_CLIENTE[stato][0]}`}>{STATI_CLIENTE[stato][1]}{statoMan ? '' : ' (proposto)'}</span>}
            {cli && <span className="ct-ac-tag">{cli.fonte === 'taylor' ? `Cliente ${cli.codice}` : 'Già contattato'}</span>}
            {sugg.length > 0 && (
              <div className="ct-ac-pop">
                {sugg.map((c, i) => <button type="button" key={i} onClick={() => scegli(c)}><b>{c.nome}</b><span className="sub">{c.fonte === 'taylor' ? `Cod. ${c.codice} · ${c.sedi} ${c.sedi === 1 ? 'sede' : 'sedi'}` : [c.contatto, c.telefono, c.comune].filter(Boolean).join(' · ') || 'già contattato'}</span></button>)}
                <div className="ct-ac-nuovo sub">Non c'è? Continua a scrivere: sarà un nuovo cliente.</div>
              </div>)}
          </div>
          {sedi.length > 0 && (
            <div className="field"><label htmlFor="ct-sede">Sede / impianto</label>
              <select id="ct-sede" value={sede} onChange={e => scegliSede(e.target.value)}>
                <option value="">— scegli la sede ({sedi.length}) —</option>
                {sedi.map(s => <option key={s.impianto} value={s.impianto}>{[s.indirizzo, s.comune].filter(Boolean).join(', ')} · {s.impianto}</option>)}
              </select></div>)}
          <div className="ct-griglia">
            <div className="field"><label htmlFor="ct-con">Persona di contatto</label><input id="ct-con" value={f.contatto_nome} onChange={e => setF({ ...f, contatto_nome: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-tel">Telefono</label><input id="ct-tel" type="tel" value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-em">Email</label><input id="ct-em" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          </div>
          {!sede && (tipo === 'manutenzione' || tipo === 'sopralluogo') && (
            <div className="ct-griglia">
              <div className="field"><label htmlFor="ct-ind">Indirizzo</label><input id="ct-ind" value={f.indirizzo} onChange={e => setF({ ...f, indirizzo: e.target.value })} /></div>
              <div className="field"><label htmlFor="ct-cap">CAP</label><input id="ct-cap" inputMode="numeric" maxLength={5} value={f.cap} onChange={e => setF({ ...f, cap: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="field"><label htmlFor="ct-com2">Comune</label><input id="ct-com2" value={f.comune} onChange={e => setF({ ...f, comune: e.target.value })} /></div>
            </div>)}
        </div>

        {tipo && richiedeAppuntamento(tipo) && (<>
          <div className="ct-sez"><span className="ct-sez-n">4</span><b>Appuntamento</b></div>
          {!data && <div className="ct-promemoria">Dai subito data e fascia al cliente.</div>}
          <div className="ct-riga">
            <div className="ct-chips">
              {[[oggi, 'Oggi'], [domani, 'Prossimo giorno lav.'], [dopodomani, 'Tra 2 giorni lav.']].map(([d, l]) => (
                <button type="button" key={l} className={data === d ? 'on' : ''} onClick={() => setData(d)} disabled={!lavorativo(d, fest)}>{l}</button>))}
            </div>
            <input type="date" aria-label="Data appuntamento" value={data} min={oggi} onChange={e => setData(e.target.value)} />
            <div className="segmented" role="group" aria-label="Fascia">
              <button type="button" className={fascia === 'mattina' ? 'on' : ''} onClick={() => setFascia('mattina')}>Mattina</button>
              <button type="button" className={fascia === 'pomeriggio' ? 'on' : ''} onClick={() => setFascia('pomeriggio')}>Pomeriggio</button>
            </div>
          </div>
          {tipo === 'sopralluogo' && data && data > dopodomani && <Banner s="warn">La procedura chiede il sopralluogo entro 2 giorni lavorativi.</Banner>}
        </>)}

        {q.trim().length >= 3 && <div className="ct-chips" role="radiogroup" aria-label="Stato del cliente">
          {(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(k => <button type="button" key={k} role="radio" aria-checked={stato === k} className={stato === k ? 'on' : ''} onClick={() => { setStato(k); setStatoMan(true); }}>{STATI_CLIENTE[k][1]}</button>)}
        </div>}

        <div className="ct-sez"><span className="ct-sez-n">{tipo && richiedeAppuntamento(tipo) ? 5 : 4}</span><b>Nota</b></div>
        <textarea rows={3} value={f.descrizione} onChange={e => setF({ ...f, descrizione: e.target.value })} placeholder="Cosa ha detto il cliente, in breve" aria-label="Nota" />

        <label className="check ct-trasf-form"><input type="checkbox" checked={trasf} onChange={e => setTrasf(e.target.checked)} /> Chiamata per un responsabile (trasferita o non disponibile): lo registro subito dopo</label>
        {flusso?.nota_procedura && <p className="ct-proc"><b>Procedura:</b> {flusso.nota_procedura}</p>}
        {err && <Banner s="ko">{err}</Banner>}
        {senzaApp && !data && <Banner s="warn">Manca l'appuntamento. Se il cliente non può fissarlo ora, premi di nuovo «Salva».</Banner>}
        <div className="ct-salva">
          <div className="sub">
            {scad && <>Prima scadenza: <b>{testoResiduo(scad)}</b> · </>}
            {tipo === 'manutenzione' && !urgente && <button type="button" className="ct-link" onClick={() => setUrgente(true)}>segna urgente</button>}
            {urgente && <span className="ct-sla rosso">urgente</span>}
            <span className="ct-kbd-h"> · Ctrl+Invio per salvare</span>
          </div>
          <div className="row-flex"><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={invio}>{invio ? 'Salvo…' : 'Salva'}</button></div>
        </div>
      </form>
    </Modal>
  );
}
