import { FormEvent, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { NOME_TIPO, senzaCliente, senzaReferente, senzaRiepilogo, type Commerciale, type Pratica, type Trasferimento } from '../lib/centralino/tipi';
import { daRoma, giornoRoma, partiRoma, prossimoLavorativo, scadenzaSla, semaforo, testoResiduo } from '../lib/centralino/sla';
import { useAdesso, useAggiornamento, useConfig } from './comune';
import EmailTrasferimento from './EmailTrasferimento';
import { useCtx } from './ShellCentralino';
import { Conto } from './componenti';

const ARGOMENTI = ['Offerta fino a 999,99 €', 'Offerta da 1.000 €', 'Sopralluogo', 'Manutenzione / guasto', 'Fatture / amministrazione', 'Fornitori', 'Reclamo', 'Informazione'];
type Entro = '30m' | '1h' | '2h' | 'pom' | 'dom' | 'scelta';
const ENTRO: { v: Entro; l: string }[] = [
  { v: '30m', l: '30 minuti' }, { v: '1h', l: '1 ora' }, { v: '2h', l: '2 ore' }, { v: 'pom', l: 'Oggi pomeriggio' }, { v: 'dom', l: 'Domani mattina' }, { v: 'scelta', l: 'Quando preferisce il cliente' },
];

/** Scadenza del richiamo promesso al cliente (orario d'ufficio per 30 min/1 h/2 h). */
function scadenzaEntro(v: Entro, scelta: string, fest: Set<string>, orario: { inizio: string; fine: string }): { quando: Date; testo: string } | null {
  const ora = new Date();
  const hhmm = (d: Date) => { const p = partiRoma(d); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
  if (v === '30m' || v === '1h' || v === '2h') {
    const d = scadenzaSla(ora, v === '30m' ? { tipo: 'minuti', valore: 30 } : { tipo: 'ore', valore: v === '1h' ? 1 : 2 }, fest, orario);
    return { quando: d, testo: giornoRoma(d) === giornoRoma(ora) ? `entro le ${hhmm(d)}` : `entro ${testoResiduo(d, ora)}` };
  }
  if (v === 'pom') { const [y, m, g] = giornoRoma(ora).split('-').map(Number); const [h, mi] = orario.fine.split(':').map(Number); return { quando: daRoma(y, m, g, h, mi), testo: 'oggi pomeriggio' }; }
  if (v === 'dom') { const [y, m, g] = prossimoLavorativo(giornoRoma(ora), fest).split('-').map(Number); return { quando: daRoma(y, m, g, 13, 0), testo: 'domani in mattinata' }; }
  if (!scelta) return null;
  const [d, t] = scelta.split('T'); const [y, m, g] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  const q = daRoma(y, m, g, h, mi);
  return { quando: q, testo: `${String(g).padStart(2, '0')}/${String(m).padStart(2, '0')} alle ${t}` };
}

/**
 * Chiamata per un responsabile. Due esiti:
 *  A) «Trasferita»: risponde / non risponde / occupato / richiamerà (non risposto → richiamo entro la soglia SLA)
 *  B) «Responsabile non disponibile»: si promette un richiamo entro… (scadenza = SLA del richiamo, campanella, promemoria 15 min prima)
 * In entrambi i casi dopo il salvataggio si apre l'email di riepilogo al cliente (obbligatoria).
 */
export function ModaleTrasferimento({ pratica, onClose, onFatto }: { pratica?: Pratica | null; onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const dest = config?.impostazioni.destinatari_trasferimento ?? [];
  const [modo, setModo] = useState<'trasferita' | 'richiamo'>('trasferita');
  const [a, setA] = useState(''); const [altro, setAltro] = useState('');
  const [tipo, setTipo] = useState(pratica ? NOME_TIPO[pratica.tipo] : '');
  const [arg, setArg] = useState('');
  const [entro, setEntro] = useState<Entro | ''>('2h');
  const [scelta, setScelta] = useState('');
  const [cli, setCli] = useState({ nome: pratica?.cliente_nome ?? '', telefono: pratica?.telefono ?? '', email: pratica?.email ?? '' });
  const [err, setErr] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  const [riepilogo, setRiepilogo] = useState<Trasferimento | null>(null);
  const sc = entro && config ? scadenzaEntro(entro, scelta, config.festivi, config.impostazioni.orario) : null;

  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const nome = a === 'Altro' ? altro.trim() : a;
    if (!nome) { setErr('Indica il responsabile.'); return; }
    if (modo === 'richiamo' && !sc) { setErr('Indica entro quando lo ricontatteremo.'); return; }
    const d = dest.find(x => x.nome === a);
    setInvio(true);
    try {
      const r = await rpc<{ id: number; notificato: boolean; richiamo_scadenza: string | null }>('centralino_trasferisci', { p: {
        pratica_id: pratica?.id ?? null, cliente_nome: cli.nome, telefono: cli.telefono, cliente_email: cli.email, destinatario_nome: nome, destinatario_ruolo: d?.ruolo ?? 'altro',
        argomento: arg, tipo_argomento: tipo, modalita: modo, esito: modo === 'trasferita' ? 'risposto' : null,
        scadenza: modo === 'richiamo' ? sc!.quando.toISOString() : null, entro_testo: modo === 'richiamo' ? sc!.testo : null } });
      toast(r.richiamo_scadenza ? `Richiamo ${testoResiduo(r.richiamo_scadenza)}${r.notificato ? ' · responsabile avvisato' : ''}` : 'Trasferimento registrato');
      const { data } = await supabase.from('chiamate_trasferite').select('*').eq('id', r.id).single();
      setRiepilogo(data as Trasferimento); // email di riepilogo obbligatoria
    } catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }
  if (riepilogo) return <EmailTrasferimento trasf={riepilogo} pratica={pratica} onClose={onFatto} onFatto={onFatto} />;
  return (
    <Modal titolo="Chiamata per un responsabile" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="segmented ct-seg-xl" role="group" aria-label="Modalità">
          <button type="button" className={modo === 'trasferita' ? 'on' : ''} onClick={() => setModo('trasferita')}>Trasferita</button>
          <button type="button" className={modo === 'richiamo' ? 'on' : ''} onClick={() => setModo('richiamo')}>Responsabile non disponibile</button>
        </div>
        {!pratica && <div className="ct-griglia">
          <div className="field"><label htmlFor="tr-cli">Cliente</label><input id="tr-cli" value={cli.nome} onChange={e => setCli({ ...cli, nome: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-tel">Telefono</label><input id="tr-tel" type="tel" value={cli.telefono} onChange={e => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-em">Email (per il riepilogo)</label><input id="tr-em" type="email" value={cli.email} onChange={e => setCli({ ...cli, email: e.target.value })} /></div>
        </div>}
        <div className="ct-sez"><b>{modo === 'trasferita' ? 'A chi' : 'Chi deve richiamare'}</b></div>
        <select aria-label="Responsabile" value={a} onChange={e => setA(e.target.value)}><option value="">— scegli —</option>{dest.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.nota ? ` · ${d.nota}` : ''}</option>)}</select>
        {dest.find(d => d.nome === a)?.nota && <p className="hint">{dest.find(d => d.nome === a)!.nota}</p>}
        {a === 'Altro' && <div className="field"><label htmlFor="tr-altro">Nome</label><input id="tr-altro" value={altro} onChange={e => setAltro(e.target.value)} /></div>}
        <div className="ct-sez"><b>Di cosa</b></div>
        <select aria-label="Argomento" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">— scegli —</option>{[...new Set([...(tipo && !ARGOMENTI.includes(tipo) ? [tipo] : []), ...ARGOMENTI])].map(x => <option key={x}>{x}</option>)}</select>
        <div className="field"><label htmlFor="tr-arg">In breve</label><input id="tr-arg" value={arg} onChange={e => setArg(e.target.value)} placeholder="es. preventivo per 3 estintori" /></div>
        {modo === 'trasferita' ? (<p className="hint">Si registra il trasferimento e si inviano le due email (al responsabile e al cliente).</p>) : (<>
          <div className="ct-sez"><b>«Vi ricontatteremo entro…»</b><span className="sub">Quando preferisce essere richiamato?</span></div>
          <select aria-label="Vi ricontatteremo entro" value={entro} onChange={e => setEntro(e.target.value as Entro)}><option value="">— scegli —</option>{ENTRO.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
          {entro === 'scelta' && <input type="datetime-local" aria-label="Data e ora scelte dal cliente" value={scelta} onChange={e => setScelta(e.target.value)} />}
          {sc && <p className="hint">Scadenza del richiamo: <b>{fmtOra(sc.quando.toISOString())}</b> · promemoria 15 minuti prima · se scade avvisa te e la direzione.</p>}
        </>)}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{invio ? 'Salvo…' : 'Salva e scrivi il riepilogo'}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

export async function trasferimenti(da?: string, praticaId?: number): Promise<Trasferimento[]> {
  let q = supabase.from('chiamate_trasferite').select('*').order('at', { ascending: false }).limit(500);
  if (da) q = q.gte('at', da);
  if (praticaId) q = q.eq('pratica_id', praticaId);
  const { data, error } = await q; if (error) throw error; return (data ?? []) as Trasferimento[];
}
export const daRichiamare = (l: Trasferimento[]) => l.filter(t => t.richiamo_scadenza && !t.richiamato_at);

export function RigaTrasf({ t, ora, onRichiamato, onRiepilogo, base }: { t: Trasferimento; ora: Date; onRichiamato?: (t: Trasferimento) => void; onRiepilogo?: (t: Trasferimento) => void; base: string }) {
  const aperto = !!t.richiamo_scadenza && !t.richiamato_at;
  const s = aperto ? semaforo(t.at, t.richiamo_scadenza, ora) : 'nessuno';
  return (
    <div className={`ct-trasf sla-${s}`}>
      <div><b>{t.cliente_nome || t.telefono || 'Cliente'}</b>{t.telefono && t.cliente_nome ? <span className="sub"> · {t.telefono}</span> : null}
        <div className="sub">{t.modalita === 'richiamo' ? `${t.destinatario_nome} richiamerà ${t.entro_testo ?? ''}` : `→ ${t.destinatario_nome}`}{t.tipo_argomento ? ` · ${t.tipo_argomento}` : ''}{t.argomento ? ` · ${t.argomento}` : ''} · {fmtOra(t.at)}{t.pratica_id ? <> · <Link to={`${base}/pratica/${t.pratica_id}`}>pratica</Link></> : null}</div>
        {t.esito_richiamo && <div className="sub">Esito richiamo: {t.esito_richiamo}</div>}
        {t.email_non_disponibile && <div className="sub">Email non disponibile: {t.email_non_disponibile}</div>}
      </div>
      <div className="ct-trasf-dx">
        <Pill s={t.modalita === 'richiamo' ? 'info' : 'ok'}>{t.modalita === 'richiamo' ? 'Non disponibile' : 'Trasferita'}</Pill>
        {senzaRiepilogo(t) && (() => { const txt = [senzaReferente(t) && 'al referente', senzaCliente(t) && 'al cliente'].filter(Boolean).join(' e '); return onRiepilogo ? <button className="ct-flag-email" onClick={() => onRiepilogo(t)}>Email {txt} non inviata</button> : <span className="ct-flag-email">Email {txt} non inviata</span>; })()}
        {aperto && <Conto inizio={t.at} scadenza={t.richiamo_scadenza} regola={t.modalita === 'richiamo' ? `richiamo promesso ${t.entro_testo ?? ''}` : 'richiamo entro 2 ore'} />}
        {t.richiamato_at && <span className="sub">richiamato {fmtOra(t.richiamato_at)}{t.richiamato_da ? ` · ${t.richiamato_da}` : ''}</span>}
        {aperto && onRichiamato && <button className="btn-ghost btn-sm" onClick={() => onRichiamato(t)}>Richiamato</button>}
      </div>
    </div>
  );
}

/** «Richiamato» con breve esito. */
export async function segnaRichiamato(t: Trasferimento): Promise<boolean> {
  const nota = window.prompt('Richiamato: com\'è andata? (breve)', '');
  if (nota === null) return false;
  try { await rpc('centralino_richiamato', { p_id: t.id, p_nota: nota }); toast('Segnato come richiamato'); return true; } catch (e) { toast(testoErrore(e)); return false; }
}

/** /centralino/trasferimenti: richiami da fare (anche per chi li deve fare), riepiloghi mancanti, storico. */
export default function Trasferimenti() {
  const ctx = useCtx();
  const ora = useAdesso();
  const { data, errore, reload } = useLoad(() => trasferimenti(new Date(Date.now() - 30 * 864e5).toISOString()), [ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r);
  const [nuovo, setNuovo] = useState(false);
  const [riep, setRiep] = useState<Trasferimento | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const aperti = daRichiamare(data);
  const senza = data.filter(senzaRiepilogo);
  const ric = async (t: Trasferimento) => { if (await segnaRichiamato(t)) reload(); };
  return (
    <>
      <div className="page-hero"><div><h1>Chiamate trasferite</h1><p className="sub">Ultimi 30 giorni. Chi non ha risposto o non era disponibile va richiamato entro la scadenza.</p></div>
        {ctx.scrive && <button className="btn" onClick={() => setNuovo(true)}>Chiamata per un responsabile</button>}</div>
      <Disponibilita />
      <h2 className="section-title">Da richiamare ({aperti.length})</h2>
      {aperti.length ? aperti.map(t => <RigaTrasf key={t.id} t={t} ora={ora} onRichiamato={ric} onRiepilogo={ctx.scrive ? setRiep : undefined} base={ctx.base} />) : <p className="ct-vuoto">Nessun richiamo in sospeso.</p>}
      {senza.length > 0 && <><h2 className="section-title">Email di riepilogo da inviare ({senza.length})</h2>
        {senza.filter(t => !aperti.includes(t)).map(t => <RigaTrasf key={t.id} t={t} ora={ora} onRiepilogo={ctx.scrive ? setRiep : undefined} base={ctx.base} />)}</>}
      <h2 className="section-title">Tutte</h2>
      {data.filter(t => !aperti.includes(t) && !senza.includes(t)).map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} />)}
      {nuovo && <ModaleTrasferimento onClose={() => setNuovo(false)} onFatto={() => { setNuovo(false); reload(); }} />}
      {riep && <EmailTrasferimento trasf={riep} onClose={() => { setRiep(null); reload(); }} onFatto={() => { setRiep(null); reload(); }} />}
    </>
  );
}

/** Disponibilità di L. Esposito, A. Chiaradonna, A. Querini per le offerte da 1.000 € (le imposta il centralino o la persona stessa). */
function Disponibilita() {
  const { data, reload } = useLoad(() => rpc<Commerciale[]>('centralino_commerciali', {}).catch(() => null));
  if (!data?.length) return null;
  async function cambia(c: Commerciale) {
    try { await rpc('centralino_imposta_disponibile', { p_nome: c.nome, p_disponibile: c.occupato }); reload(); } catch (e) { toast(testoErrore(e)); }
  }
  return (
    <section className="ct-blocco"><h2>Commerciali per offerte da 1.000 €</h2>
      <div className="ct-disp">{data.map(c => (
        <div key={c.nome} className={`ct-disp-i ${c.disponibile ? 'si' : 'no'}`}>
          <b>{c.nome}</b><span className="sub">{c.assente ? 'assente oggi (ferie/permesso)' : c.occupato ? 'occupato' : c.disponibile ? 'disponibile' : 'non disponibile'}{!c.email ? ' · email da inserire' : ''}</span>
          {!c.assente && <button className="btn-ghost btn-sm" onClick={() => cambia(c)}>{c.occupato ? 'Segna disponibile' : 'Segna occupato'}</button>}
        </div>))}</div>
    </section>
  );
}
