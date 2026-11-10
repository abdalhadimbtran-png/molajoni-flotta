import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { CANALI, REGOLA_ANAGRAFICA, REGOLA_SQUILLI, RICHIESTE, STATI_CLIENTE, TIPI_CONTATTO, type TipoContatto, type Commerciale, type StatoCliente, SCRIPT_TELEFONO, type Canale, type Flusso, type TipoPratica } from '../lib/centralino/tipi';
import { scadenzaSla, testoResiduo, type RegolaSla } from '../lib/centralino/sla';
import { salvaAppunti, useConfig } from './comune';
import Appunti from './Appunti';
import { Ic, iconaCanale } from './componenti';
import { focusGruppo, indiceSuccessivo, tabRoving, tastiRadio } from './tastiera';

interface Cliente { codice: string | null; nome: string; stato_cliente?: StatoCliente | null; sedi?: number; fonte: 'taylor' | 'pratiche' | 'fornitore'; contatto?: string | null; telefono?: string | null; email?: string | null; indirizzo?: string | null; cap?: string | null; comune?: string | null }
interface Contatto { id: number; contatto_nome: string | null; ruolo: string | null; telefono: string | null; cellulare: string | null; email: string | null; preferito: boolean; sede: string | null }
interface Fornitore { id: number; nome: string; piva: string | null; telefono: string | null; email: string | null; referente: string | null }
interface Sede { impianto: string; indirizzo: string; cap: string | null; comune: string | null }

/** Primo obiettivo SLA del flusso (per l'anteprima nel modulo). */
function primoSla(f: Flusso | undefined, sottotipo: string): RegolaSla | null {
  if (!f) return null;
  for (const s of f.stadi.slice(1)) { const r = f.sla_sottotipi?.[sottotipo]?.[s.key] ?? s.sla; if (r) return r; }
  return null;
}

/** Nuovo contatto: una schermata, pochi tocchi (obiettivo < 30 secondi). */
export default function NuovoContatto({ cliente, onClose, onCreata }: { cliente?: { codice: string | null; nome: string; fonte?: 'taylor' | 'pratiche' }; onClose: () => void; onCreata: (id: number, dopo: string) => void }) {
  const { config } = useConfig();
  const [chi, setChiStato] = useState<TipoContatto>('cliente');
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
  const [contatti, setContatti] = useState<Contatto[]>([]);
  const [contattoId, setContattoId] = useState<number | null>(null);
  const [aggiornaRubrica, setAggiornaRubrica] = useState(true);
  const [f, setF] = useState({ contatto_nome: '', telefono: '', email: '', indirizzo: '', cap: '', comune: '', descrizione: '', commerciale: '' });
  const [tacit, setTacit] = useState(false);
  const [urgenza, setUrgenza] = useState<'' | 'urgente' | 'ordinario'>('');
  const [err, setErr] = useState<string | null>(null);
  const [appunti, setAppunti] = useState('');
  const [comms, setComms] = useState<Commerciale[]>([]);
  const [nessuno, setNessuno] = useState(false);
  const [invio, setInvio] = useState(false);
  const [stato, setStato] = useState<StatoCliente | null>(null);
  const [statoMan, setStatoMan] = useState(false);
  const [trasf, setTrasf] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const chiRef = useRef<HTMLDivElement>(null);
  const [nuovoForn, setNuovoForn] = useState(false);
  const [suggSel, setSuggSel] = useState(-1);
  const cliente_ = chi === 'cliente';
  const infoChi = TIPI_CONTATTO.find(x => x.v === chi)!;
  // all'apertura: focus su «Chi chiama»
  useEffect(() => { const k = window.setTimeout(() => focusGruppo(chiRef.current), 30); return () => window.clearTimeout(k); }, []);

  /** «Chi chiama» ↔ «Cosa chiede»: Fornitore ⇄ Fornitori. */
  function setChi(v: TipoContatto) {
    if (v === chi) return;
    setChiStato(v); setCli(null); setSugg([]); setSedi([]); setSede(''); setContatti([]); setContattoId(null); setStato(null); setStatoMan(false);
    if (v === 'fornitore') { setRichiesta('fornitori'); setSottotipo(''); }
    else if (richiesta === 'fornitori') { setRichiesta(null); setSottotipo(''); }
  }
  function setRichiestaChi(v: TipoPratica | 'offerta') {
    setRichiesta(v); setSottotipo('');
    if (v === 'fornitori' && chi !== 'fornitore') setChi('fornitore');
  }
  const tipo: TipoPratica | null = richiesta === 'offerta' ? (canale === 'tablet_tmq' ? 'offerta_tablet' : grande || Number(importo) > 1000 ? 'offerta_grande' : 'offerta_piccola') : richiesta;
  const flusso = config?.flussi.find(x => x.tipo === tipo);
  const allarme = tipo === 'manutenzione' && sottotipo === 'Allarme sonoro attivo';
  const fest = config?.festivi ?? new Set<string>();
  const regola = primoSla(flusso, sottotipo);
  const scad = regola && config ? scadenzaSla(new Date(), regola, fest, config.impostazioni.orario) : null;
  useEffect(() => { if (tipo === 'offerta_grande' && !comms.length) rpc<Commerciale[]>('centralino_commerciali', {}).then(setComms, () => undefined); }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const disponibili = comms.filter(c => c.disponibile);
  const nessunoEff = nessuno || (comms.length > 0 && !disponibili.length);

  const conUrgenza = tipo === 'manutenzione' || tipo === 'sopralluogo';
  const urgente = urgenza === 'urgente';
  // urgenza proposta dal sottotipo (allarme sonoro → urgente)
  useEffect(() => { if (!conUrgenza) { setUrgenza(''); return; } if (allarme || (sottotipo && flusso?.sottotipi_urgenti.includes(sottotipo))) setUrgenza('urgente'); else setUrgenza('ordinario'); }, [sottotipo, tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (richiesta === 'offerta' && importo) setGrande(Number(importo) > 1000); }, [importo, richiesta]);
  // commerciale: il primo disponibile già scelto
  useEffect(() => { if (tipo === 'offerta_grande' && !f.commerciale && comms.length) setF(x => ({ ...x, commerciale: (comms.find(c => c.disponibile) ?? comms[0]).nome })); }, [comms, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggerimenti clienti (Taylor + pratiche già passate dal centralino)
  useEffect(() => {
    if (cli || q.trim().length < 2) { setSugg([]); return; }
    if (chi === 'collega' || chi === 'altro') { setSugg([]); return; }
    const k = window.setTimeout(() => {
      if (chi === 'fornitore') rpc<Fornitore[]>('centralino_fornitori', { p_q: q }).then(l => setSugg(l.map(x => ({ codice: null, nome: x.nome, fonte: 'fornitore', telefono: x.telefono, email: x.email, contatto: x.referente }))), () => setSugg([]));
      else rpc<Cliente[]>('centralino_clienti', { p_q: q }).then(setSugg, () => setSugg([]));
    }, 200);
    return () => window.clearTimeout(k);
  }, [q, cli, chi]);

  // stato cliente proposto: da Taylor (interventi recenti → attivo) o «nuovo»
  useEffect(() => {
    if (statoMan) return;
    if (!cliente_) { setStato(null); return; }
    if (cli?.stato_cliente) { setStato(cli.stato_cliente); return; }
    if (q.trim().length < 3) { setStato(null); return; }
    const k = window.setTimeout(() => { rpc<StatoCliente>('centralino_stato_cliente', { p_codice: cli?.codice ?? null, p_nome: q }).then(setStato, () => undefined); }, 400);
    return () => window.clearTimeout(k);
  }, [cli, q, statoMan, cliente_]);

  // «Nuovo contatto per questo cliente» dalla scheda cliente
  useEffect(() => { if (cliente) scegli({ codice: cliente.codice, nome: cliente.nome, fonte: cliente.fonte ?? (cliente.codice ? 'taylor' : 'pratiche') }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function scegli(c: Cliente) {
    setCli(c); setQ(c.nome); setSugg([]); setSede('');
    setF(x => ({ ...x, contatto_nome: x.contatto_nome || c.contatto || '', telefono: x.telefono || c.telefono || '', email: x.email || c.email || '', indirizzo: c.indirizzo || x.indirizzo, cap: c.cap || x.cap, comune: c.comune || x.comune }));
    if (c.fonte === 'fornitore') { setSedi([]); setContatti([]); setContattoId(null); return; }
    if (c.codice && c.fonte === 'taylor') rpc<Sede[]>('centralino_sedi', { p_codice: c.codice }).then(setSedi, () => setSedi([])); else setSedi([]);
    // rubrica: preferito o più recente subito nei campi
    rpc<Contatto[]>('centralino_contatti', { p_codice: c.codice, p_nome: c.nome }).then(l => { setContatti(l); if (l[0]) usaContatto(l[0]); else setContattoId(null); }, () => setContatti([]));
  }
  /** Nuovo fornitore al volo (nome + telefono) nell'anagrafica fornitori. */
  async function aggiungiFornitore() {
    if (!q.trim()) return;
    setNuovoForn(true);
    try {
      const x = await rpc<Fornitore>('centralino_fornitore_salva', { p: { nome: q.trim(), telefono: f.telefono, email: f.email, referente: f.contatto_nome } });
      scegli({ codice: null, nome: x.nome, fonte: 'fornitore', telefono: x.telefono, email: x.email, contatto: x.referente });
      toast(`Fornitore «${x.nome}» in anagrafica`);
    } catch (e) { toast(testoErrore(e)); } finally { setNuovoForn(false); }
  }
  function usaContatto(k: Contatto | undefined) {
    if (!k) { setContattoId(null); return; }
    setContattoId(k.id);
    setF(x => ({ ...x, contatto_nome: k.contatto_nome ?? '', telefono: k.cellulare ?? k.telefono ?? '', email: k.email ?? '' }));
  }
  const scelto = contatti.find(k => k.id === contattoId);
  const norm = (t: string) => t.replace(/[^0-9]/g, '').replace(/^(0039|39)(?=\d{6,})/, '');
  const cambiato = !!scelto && (norm(f.telefono) !== norm(scelto.cellulare ?? scelto.telefono ?? '') || f.email.trim().toLowerCase() !== (scelto.email ?? '') || f.contatto_nome.trim() !== (scelto.contatto_nome ?? ''));
  function scegliSede(imp: string) {
    setSede(imp);
    const s = sedi.find(x => x.impianto === imp);
    if (s) setF(x => ({ ...x, indirizzo: s.indirizzo, cap: s.cap ?? '', comune: s.comune ?? '' }));
  }

  const manca = useMemo(() => {
    const l: string[] = [];
    if (!tipo) l.push('cosa chiede');
    if (!q.trim() && !f.telefono.trim()) l.push(cliente_ ? 'cliente o telefono' : 'nome o telefono');
    if (conUrgenza && !urgenza) l.push('urgenza');
    if (tipo === 'offerta_grande' && !f.commerciale) l.push('commerciale');
    return l;
  }, [tipo, q, f.telefono, urgenza, conUrgenza, f.commerciale]);

  async function salva(e?: FormEvent) {
    e?.preventDefault(); setErr(null);
    if (manca.length) { setErr(`Manca: ${manca.join(', ')}.`); return; }
    setInvio(true);
    try {
      const r = await rpc<{ id: number }>('centralino_crea', { p: {
        canale, tipo, sottotipo: sottotipo || null, priorita: urgente ? 'urgente' : 'normale', urgenza: conUrgenza ? urgenza : null,
        cliente_codice: cli?.codice ?? null, cliente_nome: q.trim(), sede: sede || null,
        contatto_nome: f.contatto_nome, telefono: f.telefono, email: f.email, indirizzo: f.indirizzo, cap: f.cap, comune: f.comune, descrizione: f.descrizione,
        importo_stimato: richiesta === 'offerta' && importo ? Number(importo) : null,
        appuntamento_data: null, appuntamento_fascia: null, tacitazione_tentata: tacit,
        commerciale_nome: tipo === 'offerta_grande' ? f.commerciale || null : null, nessuno_disponibile: tipo === 'offerta_grande' && nessunoEff,
        stato_cliente: cliente_ && statoMan ? stato : null,
      } });
      if (!cliente_) await rpc('centralino_tipo_contatto', { p_pratica_id: r.id, p_trasf_id: null, p_tipo: chi });
      if (cliente_ && cambiato && aggiornaRubrica && scelto) await rpc('centralino_salva_contatto', { p: { id: scelto.id, contatto_nome: f.contatto_nome, telefono: f.telefono, email: f.email, motivo: 'Aggiornato durante la chiamata', pratica_id: r.id } }).catch(e => toast(testoErrore(e)));
      if (appunti.trim()) { await salvaAppunti(`p:${r.id}`, appunti); await salvaAppunti('bozza', ''); }
      // oltre 1.000 €: subito il passo «email al cliente» (richiamo 2 ore per il commerciale già creato)
      onCreata(r.id, tipo === 'offerta_grande' ? 'avanza=1' : conUrgenza ? 'avanza=1' : trasf ? 'trasferisci=1' : '');
    } catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }

  return (
    <Modal titolo="Nuovo contatto" onClose={onClose}>
      <form className="ct-nuovo" onSubmit={salva} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!invio) salva(); } }}>
        {(canale === 'telefono' || canale === 'whatsapp') && <p className="ct-script">{canale === 'telefono' ? `${REGOLA_SQUILLI} ` : ''}«{SCRIPT_TELEFONO}»</p>}
        {canale === 'telefono' && <p className="ct-proc"><b>Risponditore:</b> 1 Manutenzione e Commerciale · 2 Fatture (pomeriggio: cellulare di Simona Colagrossi) · 3 Fornitori lun/ven (Roberta Felci) · <b>4 Emergenze tecniche h24</b> (tel. da definire)</p>}
        {canale === 'tablet_tmq' && tipo === 'offerta_tablet' && <p className="ct-proc"><b>Offerta da tablet TMQ:</b> verifica il preventivo in tutte le sue parti e invialo al cliente entro le 12:00 del giorno lavorativo successivo («PREVENTIVO DA PARTE DEL TMQ VVF», firma del TMQ).</p>}

        <div className="ct-sez"><span className="ct-sez-n">1</span><b>Chi chiama?</b><span className="k-hint"><kbd>←</kbd><kbd>→</kbd> per scegliere · <kbd>Invio</kbd> per confermare · <kbd>1</kbd>–<kbd>9</kbd> scelta rapida</span></div>
        <div className="segmented ct-chips ct-chi-sel" role="radiogroup" aria-label="Chi chiama" ref={chiRef} onKeyDown={tastiRadio}>
          {TIPI_CONTATTO.map((x, i) => (
            <button type="button" key={x.v} role="radio" aria-checked={chi === x.v} tabIndex={tabRoving(chi === x.v, i, true)} className={chi === x.v ? 'on' : ''} onClick={() => setChi(x.v)} title={x.breve}>
              <span className="k-n" aria-hidden>{i + 1}</span>{x.l}</button>))}
        </div>

        <div className="ct-sez"><span className="ct-sez-n">2</span><b>Canale</b></div>
        <div className="ct-big ct-big-canali" role="radiogroup" aria-label="Canale" onKeyDown={tastiRadio}>
          {CANALI.map((c, i) => (
            <button type="button" key={c.v} role="radio" aria-checked={canale === c.v} tabIndex={tabRoving(canale === c.v, i, true)} className={canale === c.v ? 'on' : ''} onClick={() => setCanale(c.v)}>
              <span className="k-n" aria-hidden>{i + 1}</span>
              <Ic n={iconaCanale(c.v)} size={22} /><span>{c.l}</span></button>))}
        </div>

        <div className="ct-sez"><span className="ct-sez-n">3</span><b>Cosa chiede?</b></div>
        <div className="ct-big ct-big-tipi" role="radiogroup" aria-label="Tipo di richiesta" onKeyDown={tastiRadio}>
          {RICHIESTE.map((r, i) => (
            <button type="button" key={r.v} role="radio" aria-checked={richiesta === r.v} tabIndex={tabRoving(richiesta === r.v, i, !!richiesta)} className={richiesta === r.v ? 'on' : ''}
              onClick={() => { if (richiesta !== r.v) setRichiestaChi(r.v); }}>
              <span className="k-n" aria-hidden>{i + 1}</span>
              <Ic n={r.ic} size={22} /><span><b>{r.l}</b><span className="sub">{r.breve}</span></span></button>))}
        </div>
        {tipo === 'fornitori' && <p className="ct-proc"><b>Fornitori:</b> girata a {config?.impostazioni.fornitori?.nome || 'Roberta Felci'}{config?.impostazioni.fornitori?.giorni ? ` · ${config.impostazioni.fornitori.giorni}` : ' · lunedì e venerdì'}. Negli altri giorni: prendi nome e numero e registra il richiamo.</p>}
        {flusso && flusso.sottotipi.length > 0 && (
          <div className="field"><label id="ct-sotto-l">Dettaglio</label>
            <div className="segmented ct-chips" role="radiogroup" aria-labelledby="ct-sotto-l" onKeyDown={tastiRadio}>
              {flusso.sottotipi.map((st, i) => <button type="button" key={st} role="radio" aria-checked={sottotipo === st} tabIndex={tabRoving(sottotipo === st, i, !!sottotipo)} className={sottotipo === st ? 'on' : ''}
                onClick={() => setSottotipo(st)} title={flusso.sottotipi_urgenti.includes(st) ? 'Urgente: in giornata' : undefined}>
                {i < 9 && <span className="k-n" aria-hidden>{i + 1}</span>}{st}{flusso.sottotipi_urgenti.includes(st) ? ' ·!' : ''}</button>)}
            </div></div>)}
        {allarme && (
          <div className="ct-allarme">
            <b>Allarme sonoro attivo: urgente, intervento in giornata.</b>
            <span className="sub">Prova la tacitazione con il cliente (tasto «tacitazione» sulla centrale, poi reset).</span>
            <label className="check"><input type="checkbox" checked={tacit} onChange={e => setTacit(e.target.checked)} /> Tacitazione tentata al telefono</label>
          </div>)}
        {conUrgenza && (<>
          <div className="field"><label id="ct-urg-l">Urgenza</label>
            <div className="segmented" role="radiogroup" aria-labelledby="ct-urg-l" onKeyDown={tastiRadio}>
              {([['urgente', 'Urgente (oggi)'], ['ordinario', 'Ordinario (entro 2 gg lav.)']] as const).map(([v, l], i) => (
                <button type="button" key={v} role="radio" aria-checked={urgenza === v} tabIndex={tabRoving(urgenza === v, i, !!urgenza)} className={urgenza === v ? 'on' : ''} onClick={() => setUrgenza(v)}>
                  <span className="k-n" aria-hidden>{i + 1}</span>{l}</button>))}
            </div></div>
          <p className="ct-script">Nessun appuntamento ora. Di' al cliente: «Entro 1 ora la ricontattiamo per confermarle l'appuntamento».</p>
        </>)}
        {richiesta === 'offerta' && (
          <div className="ct-riga">
            <div className="segmented" role="radiogroup" aria-label="Valore" onKeyDown={tastiRadio}>
              <button type="button" role="radio" aria-checked={!grande} tabIndex={tabRoving(!grande, 0, true)} className={!grande ? 'on' : ''} onClick={() => { setGrande(false); if (Number(importo) > 1000) setImporto(''); }}><span className="k-n" aria-hidden>1</span>Fino a 1.000 €</button>
              <button type="button" role="radio" aria-checked={grande} tabIndex={tabRoving(grande, 1, true)} className={grande ? 'on' : ''} onClick={() => setGrande(true)}><span className="k-n" aria-hidden>2</span>Oltre 1.000 €</button>
            </div>
            <div className="field ct-importo"><label htmlFor="ct-imp">Importo stimato (facoltativo)</label>
              <input id="ct-imp" inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="€" /></div>
          </div>)}
        {tipo === 'offerta_grande' && (
          <div className="ct-allarme ct-grande">
            <b>Oltre 1.000 €: l'offerta la fa un Tecnico Commerciale.</b>
            <div className="field"><label htmlFor="ct-com">Assegna a</label>
              <select id="ct-com" value={f.commerciale} onChange={e => setF({ ...f, commerciale: e.target.value })}>
                <option value="">— scegli —</option>
                {comms.map(c => <option key={c.nome} value={c.nome} >{c.nome} · {c.disponibile ? 'disponibile' : c.assente ? 'assente oggi' : !c.account && c.email ? 'senza account' : 'occupato'}</option>)}
              </select></div>
            <label className="check"><input type="checkbox" checked={nessunoEff} disabled={comms.length > 0 && !disponibili.length} onChange={e => setNessuno(e.target.checked)} /> Nessuno disponibile ora</label>
            <span className="sub">Di' al cliente: «Entro 2 ore la contatterà il nostro Tecnico Commerciale». Dopo il salvataggio: email al cliente, email di riepilogo al commerciale, richiamo entro 2 ore.</span>
          </div>)}

        <div className="ct-sez"><span className="ct-sez-n">4</span><b>{cliente_ ? 'Cliente' : infoChi.l}</b><span className="sub">dati minimi: nome e telefono bastano</span></div>
        <div className="ct-cliente">
          <div className="field ct-ac">
            <label htmlFor="ct-cli">{infoChi.campo}</label>
            <input id="ct-cli" ref={qRef} autoComplete="off" value={q} onChange={e => { setQ(e.target.value); setSuggSel(-1); if (cli) { setCli(null); setSedi([]); setSede(''); } }} placeholder={cliente_ ? 'Scrivi il nome o il codice cliente' : chi === 'fornitore' ? 'Nome del fornitore o P. IVA' : chi === 'collega' ? 'Nome del collega o tecnico' : 'Nome, ente o azienda'}
              role="combobox" aria-expanded={sugg.length > 0} aria-controls="ct-cli-pop" aria-autocomplete="list" aria-activedescendant={suggSel >= 0 ? `ct-cli-o${suggSel}` : undefined}
              onKeyDown={e => {
                if (!sugg.length) return;
                const m = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? indiceSuccessivo(suggSel, sugg.length, e.key) : null;
                if (m !== null) { e.preventDefault(); setSuggSel(m); return; }
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && suggSel >= 0) { e.preventDefault(); scegli(sugg[suggSel]); setSuggSel(-1); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSugg([]); setSuggSel(-1); }
              }} />
            {cliente_ && stato && <span className={`ct-stato-cli pill ${STATI_CLIENTE[stato][0]}`}>{STATI_CLIENTE[stato][1]}{statoMan ? '' : ' (proposto)'}</span>}
            {cli && <span className="ct-ac-tag">{cli.fonte === 'fornitore' ? 'In anagrafica fornitori' : cli.fonte === 'taylor' ? `Cliente ${cli.codice}` : 'Già contattato'}</span>}
            {chi === 'fornitore' && !cli && q.trim().length >= 2 && !sugg.some(x => x.nome.toLowerCase() === q.trim().toLowerCase()) && (
              <button type="button" className="btn-ghost ct-forn-nuovo" disabled={nuovoForn} onClick={aggiungiFornitore}>{nuovoForn ? 'Salvo…' : `+ Aggiungi «${q.trim()}» ai fornitori`}</button>)}
            {sugg.length > 0 && (
              <div className="ct-ac-pop" id="ct-cli-pop" role="listbox">
                {sugg.map((c, i) => <button type="button" key={i} id={`ct-cli-o${i}`} role="option" aria-selected={i === suggSel} tabIndex={-1} className={i === suggSel ? 'sel' : ''} onMouseEnter={() => setSuggSel(i)} onClick={() => scegli(c)}><b>{c.nome}</b><span className="sub">{c.fonte === 'fornitore' ? [c.contatto, c.telefono, c.email].filter(Boolean).join(' · ') || 'fornitore' : c.fonte === 'taylor' ? `Cod. ${c.codice} · ${c.sedi} ${c.sedi === 1 ? 'sede' : 'sedi'}` : [c.contatto, c.telefono, c.comune].filter(Boolean).join(' · ') || 'già contattato'}</span></button>)}
                <div className="ct-ac-nuovo sub">{chi === 'fornitore' ? 'Non c\'è? Aggiungilo ai fornitori con il pulsante.' : 'Non c\'è? Continua a scrivere: sarà un nuovo cliente.'} <span className="k-hint"><kbd>↑</kbd><kbd>↓</kbd> per scegliere · <kbd>Invio</kbd> per confermare</span></div>
              </div>)}
          </div>
          {cliente_ && sedi.length > 0 && (
            <div className="field"><label htmlFor="ct-sede">Sede / impianto</label>
              <select id="ct-sede" value={sede} onChange={e => scegliSede(e.target.value)}>
                <option value="">— scegli la sede ({sedi.length}) —</option>
                {sedi.map(s => <option key={s.impianto} value={s.impianto}>{[s.indirizzo, s.comune].filter(Boolean).join(', ')} · {s.impianto}</option>)}
              </select></div>)}
          <div className="ct-griglia">
            {cliente_ && contatti.length > 0 && <div className="field"><label htmlFor="ct-rub">Contatto in rubrica</label>
              <select id="ct-rub" value={contattoId ?? ''} onChange={e => { const k = contatti.find(x => x.id === Number(e.target.value)); if (k) usaContatto(k); else { setContattoId(null); setF({ ...f, contatto_nome: '', telefono: '', email: '' }); } }}>
                {contatti.map(k => <option key={k.id} value={k.id}>{[k.contatto_nome || 'Senza nome', k.ruolo, k.cellulare || k.telefono, k.preferito ? '★' : ''].filter(Boolean).join(' · ')}</option>)}
                <option value="">+ Nuovo contatto per questo cliente</option>
              </select></div>}
            <div className="field"><label htmlFor="ct-con">Persona di contatto</label><input id="ct-con" value={f.contatto_nome} onChange={e => setF({ ...f, contatto_nome: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-tel">Telefono</label><input id="ct-tel" type="tel" value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} /></div>
            <div className="field"><label htmlFor="ct-em">Email</label><input id="ct-em" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          </div>
          {cliente_ && cambiato && <label className="check ct-agg-rub"><input type="checkbox" checked={aggiornaRubrica} onChange={e => setAggiornaRubrica(e.target.checked)} /> Aggiorna anche nell'anagrafica del cliente? (resta nella storia e conta come aggiornamento anagrafica)</label>}
          {!sede && (tipo === 'manutenzione' || tipo === 'sopralluogo') && (
            <div className="ct-griglia">
              <div className="field"><label htmlFor="ct-ind">Indirizzo</label><input id="ct-ind" value={f.indirizzo} onChange={e => setF({ ...f, indirizzo: e.target.value })} /></div>
              <div className="field"><label htmlFor="ct-cap">CAP</label><input id="ct-cap" inputMode="numeric" maxLength={5} value={f.cap} onChange={e => setF({ ...f, cap: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="field"><label htmlFor="ct-com2">Comune</label><input id="ct-com2" value={f.comune} onChange={e => setF({ ...f, comune: e.target.value })} /></div>
            </div>)}
        </div>


        {cliente_ && q.trim().length >= 3 && <div className="field"><label htmlFor="ct-stato">Il cliente è</label>
          <select id="ct-stato" value={stato ?? ''} onChange={e => { setStato((e.target.value || null) as StatoCliente | null); setStatoMan(!!e.target.value); }}>
            <option value="">{stato ? `Proposto: ${STATI_CLIENTE[stato][1]}` : '— proposta automatica —'}</option>
            {(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(k => <option key={k} value={k}>{STATI_CLIENTE[k][1]}</option>)}
          </select></div>}

        <div className="ct-sez"><span className="ct-sez-n">5</span><b>Nota</b></div>
        <textarea rows={3} value={f.descrizione} onChange={e => setF({ ...f, descrizione: e.target.value })} placeholder={cliente_ ? 'Cosa ha detto il cliente, in breve' : 'Cosa ha detto, in breve'} aria-label="Nota" />

        <Appunti chiave="bozza" righe={4} onTesto={setAppunti} />
        {cliente_ && <p className="hint">{REGOLA_ANAGRAFICA}</p>}
        {tipo !== 'offerta_grande' && <label className="check ct-trasf-form"><input type="checkbox" checked={trasf} onChange={e => setTrasf(e.target.checked)} /> Chiamata per un responsabile (trasferita o non disponibile): lo registro subito dopo</label>}
        {flusso?.nota_procedura && <p className="ct-proc"><b>Procedura:</b> {flusso.nota_procedura}</p>}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="ct-salva">
          <div className="sub">
            {scad && <>Prima scadenza: <b>{testoResiduo(scad)}</b> · </>}
            {urgente && <span className="ct-sla rosso">urgente</span>}
            <span className="ct-kbd-h"> · <kbd>Ctrl</kbd>+<kbd>Invio</kbd> per salvare · <kbd>?</kbd> scorciatoie</span>
          </div>
          <div className="row-flex"><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={invio}>{invio ? 'Salvo…' : 'Salva'}</button></div>
        </div>
      </form>
    </Modal>
  );
}
