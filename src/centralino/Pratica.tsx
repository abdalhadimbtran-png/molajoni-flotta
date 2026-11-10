import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { fmtEuro, fmtOra } from '../lib/format';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { REGOLA_ANAGRAFICA, ESITI, FASCE, NOME_TIPO, RUOLI_ASSEGNA, STATI_CLIENTE, eCliente, nomeCanale, prossimoStadio, senzaRiepilogo, type Pratica as P, type StatoCliente, type Trasferimento, type Commerciale } from '../lib/centralino/tipi';
import { dataLunga } from '../lib/centralino/modelli';
import { ESTENSIONI, apriAllegato, caricaAllegato, pratica, useAdesso, useAggiornamento, useConfig } from './comune';
import { ChiBadge, Ic, SlaChip, Trascorso, regolaDi, Stepper, Timeline, iconaCanale, iconaTipo, nomeStadio } from './componenti';
import Avanza, { avanzaDiretto, prossimoDi } from './Avanza';
import Appunti from './Appunti';
import ModaleEmail from './ModaleEmail';
import EmailTrasferimento from './EmailTrasferimento';
import { ModaleTrasferimento, RigaTrasf, segnaRichiamato, trasferimenti } from './Trasferimento';
import { useCtx } from './ShellCentralino';

/** Scheda pratica: intestazione, avanzamento, storia completa, azioni (sola lettura per la direzione). */
export default function Pratica() {
  const { id } = useParams();
  const ctx = useCtx();
  const ora = useAdesso();
  const [qs, setQs] = useSearchParams();
  const { config } = useConfig();
  const { data, errore, reload } = useLoad(async () => {
    const [d, tr, pr] = await Promise.all([pratica(Number(id)), trasferimenti(undefined, Number(id)), prossimoDi(Number(id)).catch(() => null)]);
    return { ...d, tr, pr };
  }, [id, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r);
  const [modale, setModale] = useState<'' | 'avanza' | 'nota' | 'chiamata' | 'email' | 'dati' | 'chiudi' | 'trasf' | 'sposta' | 'commerciale'>('');
  const [codiceEmail, setCodiceEmail] = useState<string | undefined>(undefined);
  const [riep, setRiep] = useState<Trasferimento | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const nuova = qs.get('nuova') === '1';
  // dopo un passo si apre subito il successivo (una schermata per passo, nessun clic in più)
  const [continua, setContinua] = useState<string | null>(null);
  useEffect(() => {
    if (!continua || !data) return;
    if (data.pratica.stato_corrente === continua) return;
    setContinua(null);
    if (data.pratica.esito === 'aperta') setModale('avanza');
  }, [continua, data]);
  useEffect(() => {
    if (!ctx.scrive) return;
    if (qs.get('avanza') === '1') { setModale('avanza'); qs.delete('avanza'); setQs(qs, { replace: true }); }
    else if (qs.get('trasferisci') === '1') { setModale('trasf'); qs.delete('trasferisci'); setQs(qs, { replace: true }); }
    else if (qs.get('email')) { setCodiceEmail(qs.get('email') || undefined); setModale('email'); qs.delete('email'); setQs(qs, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // scorciatoia: «A» = prossimo passo (fuori dai campi di testo)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'a' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (ctx.scrive && !modale && data?.pratica.esito === 'aperta') { e.preventDefault(); setModale('avanza'); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [ctx.scrive, modale, data]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Caricamento />;
  const p = data.pratica;
  const f = config.flussi.find(x => x.tipo === p.tipo);
  const prossimo = prossimoStadio(f, p);
  const aperta = p.esito === 'aperta';
  const scrive = ctx.scrive && aperta;
  const fatto = () => { setModale(''); reload(); ctx.aggiorna(); };

  async function avanzaUno() {
    if (!prossimo) return;
    if (!avanzaDiretto(prossimo) || (data?.pr?.mancanti.length ?? 0) > 0) { setModale('avanza'); return; }
    try { await rpc('centralino_avanza', { p_id: p.id, p_stadio: prossimo.key, p_dati: {}, p_testo: null }); toast(prossimo.nome); fatto(); } catch (e) { toast(testoErrore(e)); }
  }
  async function carica(l: FileList | null) {
    if (!l) return;
    for (const x of Array.from(l)) { try { await caricaAllegato(p.id, x); toast(`Allegato: ${x.name}`); } catch (e) { toast(testoErrore(e)); } }
    if (file.current) file.current.value = ''; reload();
  }
  async function statoCliente(v: string) {
    try { await rpc('centralino_imposta_stato_cliente', { p_id: p.id, p_stato: v || null }); reload(); } catch (e) { toast(testoErrore(e)); }
  }
  const apri = (path: string) => apriAllegato(path).catch(e => toast(testoErrore(e)));
  const senzaEmail = data.tr.filter(senzaRiepilogo);

  return (
    <div className="ct-pratica">
      <Link to={`${ctx.base}/pratiche`} className="ct-indietro ct-solo-stretto">← Elenco</Link>
      {nuova && aperta && ctx.scrive && (
        <div className="ct-dopo">
          <div><b>Pratica {p.numero} aperta.</b> {prossimo ? <>Prossimo passo: <b>{prossimo.nome}</b>.</> : null}</div>
          <div className="row-flex">
            {prossimo && <button className="btn btn-sm" onClick={avanzaUno}>Prossimo passo: {prossimo.nome} <kbd>A</kbd></button>}
            <button className="btn-ghost btn-sm" onClick={() => { setCodiceEmail(undefined); setModale('email'); }}>Invia email al cliente</button>
            <button className="btn-ghost btn-sm" onClick={() => setModale('trasf')}>Chiamata per un responsabile</button>
            <button className="btn-ghost btn-sm" onClick={() => { qs.delete('nuova'); setQs(qs); }}>Chiudi</button>
          </div>
        </div>)}
      {senzaEmail.length > 0 && <div className="ct-flag-bar">Email di riepilogo non inviata per {senzaEmail.length === 1 ? 'la chiamata trasferita' : `${senzaEmail.length} chiamate trasferite`}.
        {ctx.scrive && <button className="btn btn-sm" onClick={() => setRiep(senzaEmail[0])}>Scrivi il riepilogo</button>}</div>}

      <header className={`ct-testa ${p.priorita === 'urgente' ? 'urgente' : ''}`}>
        <span className="ct-testa-ic"><Ic n={p.priorita === 'urgente' && p.tipo === 'manutenzione' ? 'allarme' : iconaTipo(p.tipo)} size={26} /></span>
        <div className="ct-testa-c">
          <div className="ct-testa-r"><span className="ct-num">{p.numero}</span><Pill s={ESITI[p.esito][0] as 'ok'}>{ESITI[p.esito][1]}</Pill>
            {p.priorita === 'urgente' && <span className="ct-sla rosso">urgente</span>}<SlaChip p={p} regola={regolaDi(f, p)} /><Trascorso da={p.created_at} fino={p.closed_at} /></div>
          {aperta && regolaDi(f, p) && <div className="sub ct-regola">Procedura: {regolaDi(f, p)}</div>}
          <h1>{p.cliente_nome} <ChiBadge t={p.tipo_contatto} /></h1>
          <div className="sub">{NOME_TIPO[p.tipo]}{p.sottotipo ? ` · ${p.sottotipo}` : ''} · <Ic n={iconaCanale(p.canale)} size={14} /> {nomeCanale(p.canale)} · {fmtOra(p.created_at)}</div>
        </div>
        <div className="ct-stato-sel">
          {eCliente(p) && p.stato_cliente && <span className={`pill ${STATI_CLIENTE[p.stato_cliente][0]}`}>{STATI_CLIENTE[p.stato_cliente][1]}</span>}
          {ctx.scrive && eCliente(p) && <select aria-label="Stato del cliente" value={p.stato_cliente_manuale ? p.stato_cliente ?? '' : ''} onChange={e => statoCliente(e.target.value)}>
            <option value="">{p.stato_cliente_manuale ? 'Torna a proposta automatica' : 'Proposta automatica'}</option>
            {(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(k => <option key={k} value={k}>{STATI_CLIENTE[k][1]}</option>)}
          </select>}
        </div>
      </header>

      <Stepper f={f} p={p} eventi={data.eventi} />
      {aperta && data.pr && <div className={`ct-prossimo ${data.pr.mancanti.length ? 'manca' : 'ok'}`}><b>Prossimo passo: {data.pr.nome}</b>{data.pr.mancanti.length ? <span> · manca: {data.pr.mancanti.join(', ')}</span> : <span> · tutto pronto</span>}</div>}

      {ctx.scrive && (
        <div className="ct-azioni">
          {aperta && prossimo && <button className="btn" onClick={avanzaUno}>Avanza: {prossimo.nome}</button>}
          <button className="btn-ghost" onClick={() => { setCodiceEmail(prossimo?.template); setModale('email'); }}><Ic n="email" size={16} /> Invia email</button>
          {aperta && p.appuntamento_data && <button className="btn-ghost" onClick={() => setModale('sposta')}>Sposta appuntamento</button>}
          <button className="btn-ghost" onClick={() => setModale('chiamata')}><Ic n="telefono" size={16} /> Registra chiamata</button>
          {aperta && p.tipo === 'offerta_piccola' && <button className="btn-ghost" onClick={() => setModale('commerciale')}>Passa al Tecnico Commerciale</button>}
          <button className="btn-ghost" onClick={() => setModale('trasf')}>Chiamata per un responsabile</button>
          <button className="btn-ghost" onClick={() => setModale('nota')}>Aggiungi nota</button>
          <button className="btn-ghost" onClick={() => setModale('dati')}>Dati e assegnazione</button>
          <button className="btn-ghost" onClick={() => file.current?.click()}>Allegati</button>
          <input ref={file} type="file" hidden multiple accept={ESTENSIONI} onChange={e => carica(e.target.files)} />
          {scrive && <button className="btn-ghost ct-chiudi" onClick={() => setModale('chiudi')}>Annulla pratica</button>}
        </div>)}

      <div className="ct-dett">
        <section className="ct-blocco">
          <h2>Storia</h2>
          <Timeline eventi={data.eventi} f={f} onApri={apri} />
        </section>
        <aside>
          {ctx.scrive && <section className="ct-blocco"><Appunti chiave={`p:${p.id}`} /></section>}
          <section className="ct-blocco ct-dati">
            <h2>Cliente</h2>
            <dl>
              {p.cliente_codice && <><dt>Codice</dt><dd>{p.cliente_codice}</dd></>}
              {p.sede && <><dt>Impianto</dt><dd>{p.sede}</dd></>}
              <dt>Contatto</dt><dd>{p.contatto_nome || '—'}</dd>
              <dt>Telefono</dt><dd>{p.telefono ? <a href={`tel:${p.telefono}`}>{p.telefono}</a> : '—'}</dd>
              <dt>Email</dt><dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : '—'}</dd>
              {(p.indirizzo || p.comune) && <><dt>Indirizzo</dt><dd>{[p.indirizzo, [p.cap, p.comune].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</dd></>}
            </dl>
          </section>
          <section className="ct-blocco ct-dati">
            <h2>Lavoro</h2>
            <dl>
              <dt>Stadio</dt><dd>{nomeStadio(f, p.stato_corrente)}</dd>
              {p.appuntamento_data && <><dt>Appuntamento</dt><dd>{dataLunga(p.appuntamento_data)}, {p.appuntamento_fascia ? FASCE[p.appuntamento_fascia] : ''}</dd></>}
              <dt>Assegnata a</dt><dd>{p.tecnico_nome || p.commerciale_nome || p.assegnato_nome || '—'}{(p.tecnico_nome || p.commerciale_nome) && p.assegnato_nome ? <span className="sub"> · {p.assegnato_nome}</span> : null}</dd>
              {p.commerciale_nome && <><dt>Commerciale</dt><dd>{p.commerciale_nome}</dd></>}
              {p.importo_stimato != null && <><dt>Importo stimato</dt><dd>{fmtEuro(p.importo_stimato)}</dd></>}
              {p.tipo === 'manutenzione' && <><dt>Alert Taylor</dt><dd>{p.alert_taylor ? `Inviato${p.documento_intervento ? ` · doc. ${p.documento_intervento}` : ''}` : 'No'}</dd></>}
              {p.sottotipo === 'Allarme sonoro attivo' && <><dt>Tacitazione</dt><dd>{p.tacitazione_tentata ? 'Tentata al telefono' : 'Non tentata'}</dd></>}
              {p.urgenza && <><dt>Urgenza</dt><dd>{p.urgenza === 'urgente' ? 'Urgente (oggi)' : 'Ordinario (entro 2 gg lav.)'}</dd></>}
              {p.coordinatore_nome && <><dt>Coordinatore</dt><dd>{p.coordinatore_nome}{p.coordinatore_telefonato ? ' · telefonato' : ''}</dd></>}
              {p.tecnico_quando && <><dt>Tecnico</dt><dd>{p.assegnato_nome} · {p.tecnico_quando}</dd></>}
              {p.descrizione && <><dt>Richiesta</dt><dd>{p.descrizione}</dd></>}
            </dl>
          </section>
          {data.tr.length > 0 && <section className="ct-blocco"><h2>Chiamate per responsabili</h2>
            {data.tr.map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} onRiepilogo={ctx.scrive ? setRiep : undefined} onRichiamato={ctx.scrive ? async x => { if (await segnaRichiamato(x)) reload(); } : undefined} />)}</section>}
          {data.allegati.length > 0 && <section className="ct-blocco"><h2>Allegati</h2>
            <ul className="ct-allegati">{data.allegati.map(a => <li key={a.id}><button className="ct-link" onClick={() => apri(a.path)}>{a.nome_file ?? 'file'}</button><span className="sub"> · {fmtOra(a.created_at)}</span></li>)}</ul></section>}
        </aside>
      </div>

      {modale === 'avanza' && f && <Avanza p={p} f={f} onClose={() => setModale('')} onFatto={() => { setContinua(p.stato_corrente); fatto(); }} onEmail={t => { setCodiceEmail(t); setModale('email'); }} />}
      {modale === 'sposta' && <ModaleSposta p={p} onClose={() => setModale('')} onFatto={fatto} />}
      {(modale === 'nota' || modale === 'chiamata') && <ModaleNota p={p} tipo={modale} onClose={() => setModale('')} onFatto={fatto} />}
      {modale === 'email' && <ModaleEmail pratica={p} codice={codiceEmail} onClose={() => setModale('')} onFatto={fatto} />}
      {modale === 'dati' && <ModaleDati p={p} onClose={() => setModale('')} onFatto={fatto} />}
      {modale === 'chiudi' && <ModaleChiudi p={p} onClose={() => setModale('')} onFatto={fatto} />}
      {modale === 'commerciale' && <ModalePassaCommerciale p={p} onClose={() => setModale('')} onFatto={fatto} />}
      {modale === 'trasf' && <ModaleTrasferimento pratica={p} onClose={() => setModale('')} onFatto={fatto} />}
      {riep && <EmailTrasferimento trasf={riep} pratica={p} onClose={() => { setRiep(null); reload(); }} onFatto={() => { setRiep(null); reload(); }} />}
    </div>
  );
}

function ModaleNota({ p, tipo, onClose, onFatto }: { p: P; tipo: 'nota' | 'chiamata'; onClose: () => void; onFatto: () => void }) {
  const [t, setT] = useState(''); const [dir, setDir] = useState<'uscita' | 'entrata'>('uscita'); const [err, setErr] = useState<string | null>(null);
  async function salva(e: FormEvent) {
    e.preventDefault();
    try { await rpc('centralino_nota', { p_id: p.id, p_tipo: tipo, p_testo: t, p_dati: tipo === 'chiamata' ? { direzione: dir } : {} }); toast('Registrata'); onFatto(); } catch (x) { setErr(testoErrore(x)); }
  }
  return (
    <Modal titolo={tipo === 'nota' ? 'Aggiungi nota' : 'Registra chiamata'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        {tipo === 'chiamata' && <div className="segmented" role="group"><button type="button" className={dir === 'uscita' ? 'on' : ''} onClick={() => setDir('uscita')}>Ho chiamato io</button><button type="button" className={dir === 'entrata' ? 'on' : ''} onClick={() => setDir('entrata')}>Ha chiamato il cliente</button></div>}
        <textarea rows={4} autoFocus value={t} onChange={e => setT(e.target.value)} aria-label="Testo" placeholder={tipo === 'chiamata' ? 'Cosa vi siete detti' : 'Nota'} />
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function ModaleDati({ p, onClose, onFatto }: { p: P; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const [f, setF] = useState({
    cliente_nome: p.cliente_nome, contatto_nome: p.contatto_nome ?? '', telefono: p.telefono ?? '', email: p.email ?? '', indirizzo: p.indirizzo ?? '', cap: p.cap ?? '', comune: p.comune ?? '',
    descrizione: p.descrizione ?? '', priorita: p.priorita, importo_stimato: p.importo_stimato == null ? '' : String(p.importo_stimato),
    assegnato_ruolo: p.assegnato_ruolo ?? '', assegnato_nome: p.assegnato_nome ?? '', tecnico_nome: p.tecnico_nome ?? '', commerciale_nome: p.commerciale_nome ?? '', commerciale_email: p.commerciale_email ?? '',
    appuntamento_data: p.appuntamento_data ?? '', appuntamento_fascia: p.appuntamento_fascia ?? '', nota: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const comm = p.tipo === 'offerta_grande' ? (config?.impostazioni.commerciali_offerte_grandi ?? []) : [...(config?.impostazioni.commerciali ?? []), ...(config?.impostazioni.commerciali_offerte_grandi ?? [])];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('centralino_aggiorna', { p_id: p.id, p: f }); toast('Pratica aggiornata'); onFatto(); } catch (x) { setErr(testoErrore(x)); }
  }
  return (
    <Modal titolo="Dati e assegnazione" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="d-cli">Cliente</label><input id="d-cli" value={f.cliente_nome} onChange={set('cliente_nome')} /></div>
          <div className="field"><label htmlFor="d-con">Contatto</label><input id="d-con" value={f.contatto_nome} onChange={set('contatto_nome')} /></div>
          <div className="field"><label htmlFor="d-tel">Telefono</label><input id="d-tel" value={f.telefono} onChange={set('telefono')} /></div>
          <div className="field"><label htmlFor="d-em">Email</label><input id="d-em" type="email" value={f.email} onChange={set('email')} /></div>
          <div className="field"><label htmlFor="d-ind">Indirizzo</label><input id="d-ind" value={f.indirizzo} onChange={set('indirizzo')} /></div>
          <div className="field"><label htmlFor="d-com">Comune</label><input id="d-com" value={f.comune} onChange={set('comune')} /></div>
        </div>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="d-ruolo">Assegnata a (ruolo)</label>
            <select id="d-ruolo" value={f.assegnato_ruolo} onChange={set('assegnato_ruolo')}><option value="">—</option>{RUOLI_ASSEGNA.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></div>
          <div className="field"><label htmlFor="d-nome">Persona</label><input id="d-nome" value={f.assegnato_nome} onChange={set('assegnato_nome')} /></div>
          <div className="field"><label htmlFor="d-tec">Tecnico</label><input id="d-tec" value={f.tecnico_nome} onChange={set('tecnico_nome')} /></div>
          <div className="field"><label htmlFor="d-cm">Commerciale</label>
            <select id="d-cm" value={f.commerciale_nome} onChange={e => { const c = comm.find(x => x.nome === e.target.value); setF({ ...f, commerciale_nome: e.target.value, commerciale_email: c?.email ?? f.commerciale_email }); }}>
              <option value="">—</option>{comm.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}{f.commerciale_nome && !comm.some(c => c.nome === f.commerciale_nome) && <option value={f.commerciale_nome}>{f.commerciale_nome}</option>}
            </select></div>
          <div className="field"><label htmlFor="d-cme">Email commerciale</label><input id="d-cme" type="email" value={f.commerciale_email} onChange={set('commerciale_email')} /></div>
          <div className="field"><label htmlFor="d-imp">Importo stimato €</label><input id="d-imp" inputMode="decimal" value={f.importo_stimato} onChange={set('importo_stimato')} /></div>
        </div>
        <div className="ct-riga">
          {!p.appuntamento_data && <><input type="date" aria-label="Appuntamento" value={f.appuntamento_data} onChange={set('appuntamento_data')} />
          <select aria-label="Fascia" value={f.appuntamento_fascia} onChange={set('appuntamento_fascia')}><option value="">—</option><option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option></select></>}
          <select aria-label="Priorità" value={f.priorita} onChange={set('priorita')}><option value="normale">Normale</option><option value="urgente">Urgente</option></select>
        </div>
        <p className="hint">{REGOLA_ANAGRAFICA}</p>
        <div className="field"><label htmlFor="d-desc">Richiesta</label><textarea id="d-desc" rows={2} value={f.descrizione} onChange={set('descrizione')} /></div>
        <div className="field"><label htmlFor="d-nota">Motivo del cambio (facoltativo)</label><input id="d-nota" value={f.nota} onChange={set('nota')} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function ModaleChiudi({ p, onClose, onFatto }: { p: P; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const motivi = config?.impostazioni.motivi_annullamento ?? ['Altro'];
  const [m, setM] = useState(''); const [t, setT] = useState(''); const [err, setErr] = useState<string | null>(null);
  async function salva(x: FormEvent) {
    x.preventDefault();
    const motivo = m === 'Altro' ? (t.trim() ? `Altro: ${t.trim()}` : '') : [m, t.trim()].filter(Boolean).join(' · ');
    try { await rpc('centralino_chiudi', { p_id: p.id, p_esito: 'annullata', p_testo: motivo }); toast('Pratica annullata'); onFatto(); } catch (y) { setErr(testoErrore(y)); }
  }
  return (
    <Modal titolo={`Annulla ${p.numero}`} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="hint">Una pratica si chiude completando tutti i passi. Prima della fine si può solo annullare.</p>
        <div className="field"><label htmlFor="ch-m">Motivo</label><select id="ch-m" value={m} onChange={e => setM(e.target.value)} required><option value="">— scegli —</option>{motivi.map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="ch-t">{m === 'Altro' ? 'Spiega (obbligatorio)' : 'Dettaglio (facoltativo)'}</label><input id="ch-t" value={t} onChange={x => setT(x.target.value)} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Annulla la pratica</button><button type="button" className="btn-ghost" onClick={onClose}>Indietro</button></div>
      </form>
    </Modal>
  );
}

/** Offerta gestita da Jennifer che si rivela complessa: passa al Tecnico Commerciale (ripartono i passi dalla «ricevuta»). */
function ModalePassaCommerciale({ p, onClose, onFatto }: { p: P; onClose: () => void; onFatto: () => void }) {
  const [comms, setComms] = useState<Commerciale[]>([]); const [c, setC] = useState(''); const [err, setErr] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  useEffect(() => { rpc<Commerciale[]>('centralino_commerciali', {}).then(l => { setComms(l); setC((l.find(x => x.disponibile) ?? l[0])?.nome ?? ''); }, e => setErr(testoErrore(e))); }, []);
  async function salva(x: FormEvent) {
    x.preventDefault(); if (!c) { setErr('Scegli il Tecnico Commerciale.'); return; }
    setInvio(true);
    try { await rpc('centralino_passa_commerciale', { p_id: p.id, p_commerciale: c }); toast(`Passata a ${c}`); onFatto(); } catch (y) { setErr(testoErrore(y)); setInvio(false); }
  }
  return (
    <Modal titolo="Passa al Tecnico Commerciale" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="hint">L'offerta passa al Tecnico Commerciale: email al cliente («entro 2 ore la contatterà…»), riepilogo al commerciale e richiamo entro 2 ore per lui.</p>
        <div className="field"><label htmlFor="pc-c">Tecnico Commerciale</label>
          <select id="pc-c" value={c} onChange={e => setC(e.target.value)} autoFocus><option value="">— scegli —</option>
            {comms.map(x => <option key={x.nome} value={x.nome}>{x.nome} · {x.disponibile ? 'disponibile' : x.assente ? 'assente oggi' : 'occupato'}</option>)}</select></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>Passa al Tecnico Commerciale</button><button type="button" className="btn-ghost" onClick={onClose}>Indietro</button></div>
      </form>
    </Modal>
  );
}

/** Spostamento dell'appuntamento: solo concordato al telefono e confermato per iscritto. */
function ModaleSposta({ p, onClose, onFatto }: { p: P; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const motivi = config?.impostazioni.motivi_spostamento ?? ['Altro'];
  const [f, setF] = useState({ data: '', fascia: '', motivo: '', tel: false, scritto: false });
  const [err, setErr] = useState<string | null>(null);
  async function salva(e: FormEvent) {
    e.preventDefault();
    try { await rpc('centralino_sposta', { p_id: p.id, p_data: f.data || null, p_fascia: f.fascia, p_motivo: f.motivo, p_concordato: f.tel, p_confermato: f.scritto }); toast('Appuntamento spostato'); onFatto(); }
    catch (x) { setErr(testoErrore(x)); }
  }
  return (
    <Modal titolo="Sposta appuntamento" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="hint">Ora: {dataLunga(p.appuntamento_data)}, {p.appuntamento_fascia}.</p>
        <div className="ct-riga">
          <input type="date" aria-label="Nuova data" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} />
          <select aria-label="Fascia" value={f.fascia} onChange={e => setF({ ...f, fascia: e.target.value })}><option value="">— fascia —</option><option value="mattina">Mattina</option><option value="pomeriggio">Pomeriggio</option></select>
          <select aria-label="Motivo" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })}><option value="">— motivo —</option>{motivi.map(m => <option key={m}>{m}</option>)}</select>
        </div>
        <label className="check"><input type="checkbox" checked={f.tel} onChange={e => setF({ ...f, tel: e.target.checked })} /> Concordato al telefono con il cliente</label>
        <label className="check"><input type="checkbox" checked={f.scritto} onChange={e => setF({ ...f, scritto: e.target.checked })} /> Confermato per iscritto (email)</label>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Sposta</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
