import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtOra } from '../lib/format';
import { conto, orologio, semaforo, testoRegola } from '../lib/centralino/sla';
import { useAdesso, useConfig } from './comune';
import { ESITI, FASCE, NOME_TIPO, STATI_CLIENTE, nomeCanale, prossimoStadio, stadioDi, type Evento, type Flusso, type Pratica } from '../lib/centralino/tipi';
import { dataLunga } from '../lib/centralino/modelli';

/** Icone del centralino (canali e tipi di richiesta), tratto 1.75. */
const I: Record<string, ReactNode> = {
  telefono: <path d="M5 3.5h3.5l1.5 4.5-2.2 1.4a11 11 0 0 0 4.8 4.8l1.4-2.2 4.5 1.5V17a2 2 0 0 1-2 2A15.5 15.5 0 0 1 3 5.5a2 2 0 0 1 2-2Z" />,
  whatsapp: <><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20Z" /><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.2 1.8.8c-.3 1.2-1.3 1.9-2.6 1.6A6.5 6.5 0 0 1 8.3 10c-.3-1.3.4-2.3 1.6-2.6l.8 1.8L9 9.5Z" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 7 8.5-7" /></>,
  collega: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.5a6.5 6.5 0 0 1 3 5.5" /></>,
  tablet: <><rect x="4.5" y="2.5" width="15" height="19" rx="2" /><path d="M10.5 18.5h3" /></>,
  altro: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  manutenzione: <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2ZM6 18l-2.5 2.5" />,
  sopralluogo: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  offerta: <><path d="M6 2.5h9l3.5 3.5v15.5H6Z" /><path d="M14.5 2.5V6.5h4M9 11.5h6M9 15h6M9 18h3.5" /></>,
  modifica: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 15l2 2 4-4" /></>,
  amministrazione: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2v-19Z" /><path d="M9 7.5h6M9 11h6M9 14.5h3.5" /></>,
  fornitori: <><path d="M2.5 16.5V7a1 1 0 0 1 1-1h10v10.5M13.5 9.5h4l3.5 3.5v3.5h-2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>,
  informazione: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.8v.2" /></>,
  allarme: <><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0M3 6l2 1.5M21 6l-2 1.5" /></>,
  trasferta: <><path d="M3 20V9l9-5 9 5v11" /><path d="M9 20v-6h6v6" /></>,
  abbigliamento: <path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0Z" />,
  cerca: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  piu: <path d="M12 5v14M5 12h14" />,
};
export const Ic = ({ n, size = 20 }: { n: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n] ?? I.altro}</svg>
);
export const iconaTipo = (t: string) => (t.startsWith('offerta') ? 'offerta' : t);
export const iconaCanale = (c: string) => ({ telefono: 'telefono', whatsapp: 'whatsapp', email: 'email', collega: 'collega', tablet_tmq: 'tablet' } as Record<string, string>)[c] ?? 'altro';

/** Conto alla rovescia vivo (ogni secondo): ore d'ufficio, pausa fuori orario, ritardo in rosso. */
export function Conto({ inizio, scadenza, regola, soglia }: { inizio: string; scadenza: string | null; regola?: string; soglia?: number }) {
  const ora = useAdesso(1000);
  const { config } = useConfig();
  const c = conto(inizio, scadenza, ora, config?.festivi ?? new Set(), config?.impostazioni.orario, soglia ?? Number(config?.impostazioni.soglia_arancio ?? 0.25));
  if (!c) return <span className="ct-sla nessuno">senza scadenza</span>;
  return (
    <span className={`ct-sla ct-conto ${c.colore} ${c.pausa ? 'pausa' : ''}`} title={[regola && `Procedura: ${regola}`, scadenza && `Scadenza ${fmtOra(scadenza)}`, c.pausa].filter(Boolean).join(' · ')}>
      <i />{c.testo}{c.pausa && <em> · {c.pausa}</em>}
    </span>
  );
}

/** Tempo trascorso dalla ricezione, vivo. */
export function Trascorso({ da, fino }: { da: string; fino?: string | null }) {
  const ora = useAdesso(1000);
  return <span className="ct-trascorso">ricevuta da {orologio(((fino ? new Date(fino) : ora).getTime() - new Date(da).getTime()) / 1000)}</span>;
}

/** Regola della procedura per il prossimo obiettivo SLA della pratica («Offerta inviata entro 60 min»). */
export function regolaDi(f: Flusso | undefined, p: Pick<Pratica, 'sottotipo' | 'sla_stadio'>): string {
  if (!f || !p.sla_stadio) return '';
  const s = f.stadi.find(x => x.key === p.sla_stadio);
  const r = f.sla_sottotipi?.[p.sottotipo ?? '']?.[p.sla_stadio] ?? s?.sla;
  return s ? `${s.nome} ${testoRegola(r)}` : '';
}

export function SlaChip({ p, soglia, regola }: { p: Pick<Pratica, 'created_at' | 'sla_scadenza' | 'esito' | 'sla_rispettato'>; ora?: Date; soglia?: number; regola?: string }) {
  if (p.esito !== 'aperta') return p.sla_rispettato == null ? null : <span className={`ct-sla ${p.sla_rispettato ? 'verde' : 'rosso'}`}>{p.sla_rispettato ? 'SLA rispettato' : 'SLA mancato'}</span>;
  return <Conto inizio={p.created_at} scadenza={p.sla_scadenza} regola={regola} soglia={soglia} />;
}

export const nomeStadio = (f: Flusso | undefined, k: string | null) => stadioDi(f, k)?.nome ?? k ?? '';

export function CardPratica({ p, f, ora, base, onAvanza, soglia }: { p: Pratica; f?: Flusso; ora: Date; base: string; onAvanza?: (p: Pratica) => void; soglia?: number }) {
  const prossimo = prossimoStadio(f, p);
  const urg = p.priorita === 'urgente';
  return (
    <div className={`ct-card ${urg ? 'urgente' : ''} sla-${p.esito === 'aperta' ? semaforo(p.created_at, p.sla_scadenza, ora, soglia) : 'chiusa'}`}>
      <Link to={`${base}/pratica/${p.id}`} className="ct-card-main">
        <span className="ct-card-ic"><Ic n={urg && p.tipo === 'manutenzione' ? 'allarme' : iconaTipo(p.tipo)} /></span>
        <span className="ct-card-body">
          <span className="ct-card-top"><b className="ct-card-cli">{p.cliente_nome}</b><SlaChip p={p} soglia={soglia} regola={regolaDi(f, p)} /></span>
          <span className="ct-card-sub">
            <span className="ct-num">{p.numero}</span> · {NOME_TIPO[p.tipo]}{p.sottotipo ? ` · ${p.sottotipo}` : ''}{p.stato_cliente ? <span className={`ct-mini ${p.stato_cliente}`}>{STATI_CLIENTE[p.stato_cliente][1]}</span> : null}
          </span>
          <span className="ct-card-meta">
            <span className="ct-stadio">{nomeStadio(f, p.stato_corrente)}</span>
            {p.appuntamento_data && <span>{dataLunga(p.appuntamento_data).replace(/\/\d{4}$/, '')} · {p.appuntamento_fascia}</span>}
            {p.esito !== 'aperta' && <span className={`pill ${ESITI[p.esito][0]}`}>{ESITI[p.esito][1]}</span>}
          </span>
        </span>
      </Link>
      {onAvanza && p.esito === 'aperta' && prossimo && (
        <button className="ct-card-next" onClick={() => onAvanza(p)} title={`Avanza a «${prossimo.nome}»`}>
          <span className="sub">Prossimo</span><span>{prossimo.nome} →</span>
        </button>)}
    </div>
  );
}

/** Stepper orizzontale degli stadi, con chi/quando. */
export function Stepper({ f, p, eventi }: { f?: Flusso; p: Pratica; eventi: Evento[] }) {
  if (!f) return null;
  const idx = f.stadi.findIndex(s => s.key === p.stato_corrente);
  const quando = (k: string) => [...eventi].reverse().find(e => (e.tipo === 'stato' || e.tipo === 'creata') && e.a_stato === k);
  return (
    <ol className="ct-step" aria-label="Avanzamento">
      {f.stadi.map((s, i) => {
        const e = quando(s.key);
        const stato = i < idx || (i === idx && p.esito !== 'aperta') ? 'fatto' : i === idx ? 'ora' : 'poi';
        const target = p.esito === 'aperta' && p.sla_stadio === s.key;
        return (
          <li key={s.key} className={`ct-step-i ${stato} ${target ? 'target' : ''}`}>
            <span className="ct-step-dot">{stato === 'fatto' ? '✓' : i + 1}</span>
            <span className="ct-step-n">{s.nome}</span>
            {e ? <span className="ct-step-w">{fmtOra(e.at)}{e.autore_nome ? ` · ${e.autore_nome}` : ''}</span>
              : target && p.sla_scadenza ? <span className="ct-step-w">entro {fmtOra(p.sla_scadenza)}</span> : null}
          </li>);
      })}
    </ol>
  );
}

const TITOLO_EV: Record<string, string> = {
  creata: 'Pratica aperta', stato: 'Avanzamento', nota: 'Nota', email_inviata: 'Email', chiamata: 'Chiamata', assegnata: 'Assegnazione',
  appuntamento: 'Appuntamento', allegato: 'Allegato', sla_scaduto: 'SLA scaduto', chiusa: 'Chiusura', modifica: 'Dati modificati',
};
const NOMI_CAMPI: Record<string, string> = { cliente_nome: 'Cliente', cliente_codice: 'Codice', sede: 'Sede', contatto_nome: 'Contatto', telefono: 'Telefono', email: 'Email', indirizzo: 'Indirizzo', cap: 'CAP', comune: 'Comune', descrizione: 'Descrizione', priorita: 'Priorità', importo_stimato: 'Importo', tacitazione_tentata: 'Tacitazione tentata', alert_taylor: 'Alert su Taylor' };

export function Timeline({ eventi, f, onApri }: { eventi: Evento[]; f?: Flusso; onApri?: (path: string) => void }) {
  // tempo passato nella fase precedente (dall'ingresso nel passo precedente a questo avanzamento)
  const fasi = new Map<number, number>();
  let prec: Evento | null = null;
  for (const e of eventi) if (e.tipo === 'creata' || e.tipo === 'stato') { if (prec && e.tipo === 'stato') fasi.set(e.id, (new Date(e.at).getTime() - new Date(prec.at).getTime()) / 1000); prec = e; }
  return (
    <ol className="ct-tl">
      {[...eventi].reverse().map(e => {
        const d = e.dati ?? {};
        let corpo: ReactNode = e.testo;
        if (e.tipo === 'stato') corpo = <><b>{nomeStadio(f, e.da_stato)} → {nomeStadio(f, e.a_stato)}</b>{d.esito_offerta ? ` · esito ${String(d.esito_offerta).replace('_', ' ')}` : ''}{d.alert_taylor ? ' · alert inviato su Taylor' : ''}{d.sla_rispettato != null ? <span className={`ct-sla ${d.sla_rispettato ? 'verde' : 'rosso'}`} style={{ marginInlineStart: 8 }}>{d.sla_rispettato ? 'in tempo' : 'in ritardo'}</span> : null}{e.testo && <div>{e.testo}</div>}</>;
        if (e.tipo === 'creata') corpo = <>Via {nomeCanale(String(d.canale ?? ''))}{d.sottotipo ? ` · ${d.sottotipo}` : ''}{e.testo && <div>{e.testo}</div>}</>;
        if (e.tipo === 'email_inviata') corpo = <><b>{String(d.oggetto ?? e.testo ?? '')}</b><div className="sub">{d.modo === 'resend' ? 'Inviata dal portale' : d.modo === 'outlook' ? 'Aperta in Outlook' : 'Testo copiato'} · a {String(d.a || '—')}{Array.isArray(d.cc) && d.cc.length ? ` · cc ${(d.cc as string[]).join(', ')}` : ''}</div>{d.testo ? <details><summary>Testo</summary><pre className="ct-pre">{String(d.testo)}</pre></details> : null}</>;
        if (e.tipo === 'appuntamento') { const a = d.a as { data?: string; fascia?: string } | undefined; corpo = <>{a?.data ? `${dataLunga(a.data)}, ${a.fascia ? FASCE[a.fascia as 'mattina'] : ''}` : 'Appuntamento tolto'}{e.testo && <div>{e.testo}</div>}</>; }
        if (e.tipo === 'assegnata') corpo = <>{[d.nome, d.tecnico && `tecnico ${d.tecnico}`, d.commerciale && `commerciale ${d.commerciale}`].filter(Boolean).join(' · ')}{e.testo && <div>{e.testo}</div>}</>;
        if (e.tipo === 'chiusa') corpo = <><b>{ESITI[(d.esito as 'chiusa_ok') ?? 'chiusa_ok']?.[1]}</b>{e.testo && <div>{e.testo}</div>}</>;
        if (e.tipo === 'modifica') corpo = <>{Object.entries(d).map(([k, v]) => { const x = v as { da: unknown; a: unknown }; return <div key={k}>{NOMI_CAMPI[k] ?? k}: <s>{String(x.da ?? '—')}</s> → {String(x.a ?? '—')}</div>; })}</>;
        if (e.tipo === 'allegato') corpo = onApri && d.path ? <button className="ct-link" onClick={() => onApri(String(d.path))}>{e.testo ?? 'File'}</button> : e.testo;
        return (
          <li key={e.id} className={`ct-tl-i t-${e.tipo}`}>
            <span className="ct-tl-dot" />
            <div className="ct-tl-h"><b>{TITOLO_EV[e.tipo] ?? e.tipo}</b><span className="sub">{fmtOra(e.at)} · {e.autore_nome ?? 'Sistema'}</span>{fasi.has(e.id) && <span className="ct-fase" title="Tempo passato nella fase precedente">⏱ {orologio(fasi.get(e.id)!)} in «{nomeStadio(f, e.da_stato)}»</span>}</div>
            {corpo && <div className="ct-tl-c">{corpo}</div>}
          </li>);
      })}
    </ol>
  );
}

export function Vuoto({ children }: { children: ReactNode }) { return <p className="ct-vuoto">{children}</p>; }
