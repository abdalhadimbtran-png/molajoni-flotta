import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc, supabase, testoErrore } from '../../lib/supabase';
import { oggiISO } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Caricamento, Errore, Modal, Pill, toast, useLoad } from '../../ui';
import { SceltaAttivita } from '../Settimana';
import { hm } from '../../lib/percorsi/ottimizza';
import { anteprimaUrgenza, capDa, MOTIVI_RITARDO, suggerisciRiassegnazione, suggerisciTecnici, type Carico, type Compito, type StimaTecnico } from '../../lib/variazioni/giornata';

interface DatiGiorno { data: string; oggi: string; ora: string; soglia: string; tecnici: StimaTecnico[]; cap_zone: Record<string, number>;
  da_ripianificare: { id: number; data: string; tecnico_id: number; luogo: string; attivita: string; origine: string }[]; da_inviare: number }
interface Pendenti { pendenti: Record<string, string[]>; registro: { id: number; tecnico_id: number; tipo: string; da: string; a: string; titolo: string; inviata_at: string; letta_at: string | null }[] }

const MOTIVO: Record<string, string> = Object.fromEntries(MOTIVI_RITARDO);
const ora = (ts: string) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

/** Variazioni della giornata (/giornata): stato dei tecnici, ritardi, urgenze, pubblicazione del piano, riassegnazioni. */
export default function Giornata() {
  const { t } = useT();
  const [sp, setSp] = useSearchParams();
  const vista = sp.get('vista') === 'riassegna' ? 'riassegna' : 'oggi';
  const vai = (v: string) => { const n = new URLSearchParams(sp); if (v === 'oggi') n.delete('vista'); else n.set('vista', v); setSp(n, { replace: true }); };
  return (
    <>
      <div className="page-hero"><div><h1>{t('Variazioni della giornata')}</h1><p className="sub">{t('Ritardi, fine giornata, urgenze e riassegnazioni')}</p></div></div>
      <div className="wk-seg wk-vista" role="tablist">
        <button role="tab" aria-selected={vista === 'oggi'} className={vista === 'oggi' ? 'on' : ''} onClick={() => vai('oggi')}>{t('Giornata')}</button>
        <button role="tab" aria-selected={vista === 'riassegna'} className={vista === 'riassegna' ? 'on' : ''} onClick={() => vai('riassegna')}>{t('Da riassegnare')}</button>
      </div>
      {vista === 'oggi' ? <VistaGiorno /> : <DaRiassegnare />}
    </>
  );
}

function VistaGiorno() {
  const { t, tm } = useT();
  const [sp, setSp] = useSearchParams();
  const giorno = sp.get('data') || oggiISO();
  const [urg, setUrg] = useState(sp.get('urgenza') === '1');
  const { data, errore, reload } = useLoad(async () => {
    const [g, p] = await Promise.all([rpc<DatiGiorno>('variazioni_giornata', { p_data: giorno }), rpc<Pendenti>('piano_modifiche_pendenti', {})]);
    return { g, p };
  }, [giorno]);
  const nomi = useMemo(() => Object.fromEntries((data?.g.tecnici ?? []).map(x => [x.tecnico_id, x.sigla || x.nome])), [data]);

  async function az(f: () => Promise<unknown>, ok: string) {
    try { await f(); toast(ok); reload(); } catch (e) { toast(tm(testoErrore(e))); }
  }
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const { g, p } = data;
  const soglia = hm(g.soglia);
  const nPend = Object.values(p.pendenti).reduce((s, r) => s + r.length, 0);

  const stato = (x: StimaTecnico) => {
    if (x.assente) return <Pill s="na">{t('Assente')}</Pill>;
    if (x.finita) return <Pill s={x.finita.tutto_fatto ? 'ok' : 'warn'}>{t('Finito alle {o}', { o: x.finita.alle })}</Pill>;
    if (!x.tappe.length) return <Pill s="na">{t('Nessun intervento')}</Pill>;
    if (g.data < g.oggi || (g.data === g.oggi && x.fine_stimata && hm(g.ora) > hm(x.fine_stimata))) return <Pill s="warn">{t('Fine non segnalata')}</Pill>;
    if (g.data === g.oggi && hm(g.ora) >= hm(x.tappe[0].arrivo_stimato)) return <Pill s="info">{t('In giro')}</Pill>;
    return <Pill s="na">{t('Da iniziare')}</Pill>;
  };

  return (
    <div className="percorsi">
      <div className="perc-bar">
        <input type="date" value={giorno} onChange={e => e.target.value && setSp({ data: e.target.value })} />
        <button className="btn brand" onClick={() => setUrg(true)}>{t('Nuova urgenza')}</button>
        <label className="row-flex">{t('Soglia fine giornata')}
          <input type="time" defaultValue={g.soglia} onBlur={e => e.target.value && e.target.value !== g.soglia && az(() => rpc('variazioni_imposta_soglia', { p_soglia: e.target.value }), t('Soglia salvata'))} /></label>
      </div>

      <div className="card">
        <div className="perc-card-h"><strong>{t('Pubblica il piano ai tecnici')}</strong>
          {nPend > 0 ? <Pill s="warn">{t('{n} modifiche non inviate', { n: nPend })}</Pill> : <Pill s="ok">{t('Tutto inviato')}</Pill>}</div>
        <div className="perc-bar">
          <button className="btn btn-sm" onClick={() => az(() => rpc('pubblica_piano', { p_tipo: 'giorno', p_data: giorno }), t('Piano del giorno pubblicato'))}>{t('Pubblica giorno')}</button>
          <button className="btn btn-sm" onClick={() => az(() => rpc('pubblica_piano', { p_tipo: 'settimana', p_data: giorno }), t('Piano della settimana pubblicato'))}>{t('Pubblica settimana')}</button>
          <button className="btn btn-sm" onClick={() => az(() => rpc('pubblica_piano', { p_tipo: 'mese', p_data: giorno }), t('Piano del mese pubblicato'))}>{t('Pubblica mese')}</button>
          <button className="btn brand btn-sm" disabled={!nPend} onClick={() => az(() => rpc('variazioni_invia_aggiornamenti', {}), t('Aggiornamenti inviati'))}>{t('Invia aggiornamenti')}</button>
        </div>
        <p className="hint">{t('Una sola notifica per tecnico. Le urgenze si inviano a parte con «Invia urgente al tecnico».')}</p>
        {Object.entries(p.pendenti).map(([id, r]) => <details key={id}><summary>{nomi[Number(id)] ?? id}: {t('{n} modifiche non inviate', { n: r.length })}</summary>{r.map((x, k) => <div key={k} className="sub">· {x}</div>)}</details>)}
        {p.registro.length > 0 && <details><summary>{t('Ultime notifiche del piano')}</summary>
          <div className="table-wrap"><table><tbody>{p.registro.slice(0, 20).map(r => (
            <tr key={r.id}><td>{nomi[r.tecnico_id] ?? r.tecnico_id}</td><td>{r.titolo}</td><td className="nowrap">{ora(r.inviata_at)}</td>
              <td>{r.letta_at ? <Pill s="ok">{t('Letta alle {o}', { o: ora(r.letta_at) })}</Pill> : <Pill s="na">{t('Non letta')}</Pill>}</td></tr>))}</tbody></table></div></details>}
      </div>

      <div className="perc-griglia">
        {g.tecnici.filter(x => x.tappe.length || x.finita || x.n_ritardi).map(x => {
          const oltre = x.fine_stimata != null && hm(x.fine_stimata) > soglia;
          const pend = p.pendenti[String(x.tecnico_id)]?.length ?? 0;
          return (
            <div key={x.tecnico_id} className="card perc-card">
              <div className="perc-card-h"><strong>{x.sigla ? `${x.sigla} · ` : ''}{x.nome}</strong>{stato(x)}</div>
              <div className="perc-card-n">
                <span>{t('{n} interventi', { n: x.tappe.length })}</span>
                <span>{t('fine stimata {o}', { o: x.fine_stimata ?? '—' })}</span>
                {x.n_ritardi > 0 && <span>{t('{n} ritardi · {m} min', { n: x.n_ritardi, m: x.ritardo_tot })}</span>}
                {pend > 0 && <Pill s="warn">{t('{n} modifiche non inviate', { n: pend })}</Pill>}
              </div>
              {oltre && !x.finita && <div className="perc-avv">⚠ {t('Oltre la soglia delle {o}: valuta di spostare l\'ultimo intervento', { o: g.soglia })}</div>}
              <ol className="perc-card-l">{x.tappe.map(s => (
                <li key={s.key} style={s.key === x.corrente && !x.finita ? { fontWeight: 600 } : undefined}>
                  {s.arrivo_stimato !== s.arrivo ? <><s className="sub">{s.arrivo}</s> {s.arrivo_stimato}</> : s.arrivo} {s.urgente && <span className="badge-urg">{t('URGENTE')}</span>} {s.luogo}
                  {s.attivita ? <span className="sub"> · {s.attivita}</span> : null}</li>))}</ol>
              {x.ritardi.map((r, k) => <div key={k} className="sub">⏱ {r.alle} +{r.minuti} min · {t(MOTIVO[r.motivo] ?? r.motivo)}{r.nota ? ` · ${r.nota}` : ''}</div>)}
              {x.urgenze.map(u => (
                <div key={u.id} className="row-flex">
                  <span className="badge-urg">{t('URGENTE')}</span> {u.luogo} ({u.arrivo})
                  {u.stato === 'confermata' ? <button className="btn brand btn-sm" onClick={() => az(() => rpc('variazioni_invia_urgenza', { p_id: u.id }), t('Urgenza inviata'))}>{t('Invia urgente al tecnico')}</button>
                    : u.letta_at ? <Pill s="ok">{t('Letta alle {o}', { o: ora(u.letta_at) })}</Pill> : <Pill s="warn">{t('Inviata, non letta')}</Pill>}
                  <button className="btn-ghost btn-sm" onClick={() => confirm(t('Annullare l\'urgenza?')) && az(() => rpc('variazioni_annulla_urgenza', { p_id: u.id }), t('Urgenza annullata'))}>{t('Annulla')}</button>
                </div>))}
              {x.finita && !x.finita.tutto_fatto && <div className="perc-avv">{t('Non tutto fatto')}{x.finita.nota ? `: ${x.finita.nota}` : ''}</div>}
            </div>);
        })}
      </div>

      {g.da_ripianificare.length > 0 && <div className="card">
        <strong>{t('Da ripianificare')}</strong>
        {g.da_ripianificare.map(r => (
          <div key={r.id} className="row-flex">{r.data} · {nomi[r.tecnico_id] ?? ''} · {r.luogo} <span className="sub">{r.attivita}</span>
            <Link className="btn-ghost btn-sm" to={`/piano?data=${r.data}`}>{t('Apri pianificazione')}</Link>
            <button className="btn-ghost btn-sm" onClick={() => az(() => rpc('variazioni_ripianificato', { p_id: r.id }), t('Fatto'))}>{t('Gestito')}</button></div>))}
      </div>}

      {urg && <NuovaUrgenza dati={g} onClose={() => { setUrg(false); const n = new URLSearchParams(sp); n.delete('urgenza'); setSp(n, { replace: true }); }} onFatto={reload} />}
    </div>
  );
}

interface Importato { id: number; cliente: string | null; via: string | null; civico: string | null; cap: string | null; comune: string | null; lat: number | null; lon: number | null; tipo: string | null }

function NuovaUrgenza({ dati, onClose, onFatto }: { dati: DatiGiorno; onClose: () => void; onFatto: () => void }) {
  const { t, tm } = useT();
  const [cerca, setCerca] = useState(''); const [imp, setImp] = useState<Importato | null>(null);
  const [luogo, setLuogo] = useState(''); const [indirizzo, setIndirizzo] = useState(''); const [cap, setCap] = useState('');
  const [attivita, setAttivita] = useState(''); const [durata, setDurata] = useState(60); const [note, setNote] = useState('');
  const [tec, setTec] = useState<number | null>(null);
  const [spost, setSpost] = useState<Record<string, { azione: 'domani' | 'tecnico'; tecnico_id?: number }>>({});
  const [salvata, setSalvata] = useState<number | null>(null); const [invio, setInvio] = useState(false);
  const { data: lista } = useLoad(async () => {
    if (cerca.trim().length < 2) return [] as Importato[];
    const q = `%${cerca.trim()}%`;
    const r = await supabase.from('interventi_importati').select('id,cliente,via,civico,cap,comune,lat,lon,tipo').eq('stato', 'da_pianificare').eq('fuori_lazio', false)
      .or(`cliente.ilike.${q},via.ilike.${q},comune.ilike.${q}`).limit(8);
    return (r.data ?? []) as Importato[];
  }, [cerca]);
  const punto = { lat: imp?.lat ?? null, lon: imp?.lon ?? null, cap: cap || capDa({ indirizzo }) };
  const sugg = useMemo(() => suggerisciTecnici(dati.tecnici, punto, dati.cap_zone), [dati, punto.lat, punto.lon, punto.cap]); // eslint-disable-line react-hooks/exhaustive-deps
  const scelto = dati.tecnici.find(x => x.tecnico_id === (tec ?? sugg[0]?.tecnico_id));
  const ant = scelto ? anteprimaUrgenza(scelto, { ...punto, durata }, dati.data === dati.oggi ? dati.ora : '08:00', new Set(Object.keys(spost)), dati.data === dati.oggi ? scelto.corrente : null) : null;

  function scegliImp(i: Importato) {
    setImp(i); setLuogo(i.cliente ?? ''); setIndirizzo([i.via, i.civico].filter(Boolean).join(' ') + (i.cap ? `, ${i.cap}` : '') + (i.comune ? ` ${i.comune}` : ''));
    setCap(i.cap ?? ''); if (i.tipo && !attivita) setAttivita(i.tipo); setCerca('');
  }
  async function conferma() {
    if (!scelto || !ant) return;
    setInvio(true);
    try {
      const r = await rpc<{ id: number }>('variazioni_crea_urgenza', {
        p_data: dati.data, p_tecnico: scelto.tecnico_id, p_dopo_key: ant.dopo_key, p_luogo: luogo || indirizzo, p_indirizzo: indirizzo || null, p_cap: punto.cap,
        p_lat: punto.lat, p_lon: punto.lon, p_attivita: attivita, p_durata: durata, p_note: note || null, p_arrivo: ant.arrivo, p_partenza: ant.partenza,
        p_spostamento: ant.spostamento, p_ritardo_base: ant.ritardo_base, p_importato: imp?.id ?? null,
        p_spostamenti: Object.entries(spost).map(([key, v]) => ({ key, ...v })) });
      setSalvata(r.id); onFatto(); toast(t('Urgenza confermata. Ora inviala al tecnico.'));
    } catch (e) { toast(tm(testoErrore(e))); } finally { setInvio(false); }
  }
  async function invia() {
    if (!salvata) return;
    try { await rpc('variazioni_invia_urgenza', { p_id: salvata }); toast(t('Urgenza inviata')); onFatto(); onClose(); } catch (e) { toast(tm(testoErrore(e))); }
  }

  return (
    <Modal titolo={t('Nuova urgenza')} onClose={onClose}>
      {salvata ? <>
        <p>{t('Urgenza salvata nel piano di {n}.', { n: scelto?.nome ?? '' })}</p>
        <button className="btn brand" onClick={invia}>{t('Invia urgente al tecnico')}</button>
      </> : <>
        <div className="field"><label>{t('Cerca tra gli interventi da pianificare')}</label><input value={cerca} onChange={e => setCerca(e.target.value)} placeholder={t('Cliente, via o comune')} />
          {(lista ?? []).map(i => <button key={i.id} className="btn-ghost btn-sm" onClick={() => scegliImp(i)}>{i.cliente} · {i.via} {i.civico} {i.comune}</button>)}</div>
        <div className="field"><label>{t('Cliente / luogo')}</label><input value={luogo} onChange={e => setLuogo(e.target.value)} /></div>
        <div className="field"><label>{t('Indirizzo')}</label><input value={indirizzo} onChange={e => { setIndirizzo(e.target.value); setImp(null); }} placeholder="Via …, 00185 Roma" /></div>
        <SceltaAttivita valore={attivita} onChange={(n, d) => { setAttivita(n); if (d) setDurata(d); }} />
        <div className="field"><label>{t('Durata (minuti)')}</label><input type="number" min={5} max={600} value={durata} onChange={e => setDurata(Number(e.target.value) || 60)} /></div>
        <div className="field"><label>{t('Note')}</label><input value={note} onChange={e => setNote(e.target.value)} /></div>
        <div className="field"><label>{t('Tecnico')}</label>
          <select value={scelto?.tecnico_id ?? ''} onChange={e => { setTec(Number(e.target.value)); setSpost({}); }}>
            {sugg.map((s, k) => <option key={s.tecnico_id} value={s.tecnico_id}>{k === 0 ? '★ ' : ''}{s.nome} — {s.motivo}</option>)}
          </select></div>
        {ant && scelto && <div className="card">
          <strong>{t('Anteprima')}</strong>
          <div className="sub">{ant.dopo_key ? t('Dopo: {l}', { l: scelto.tappe.find(x => x.key === ant.dopo_key)?.luogo ?? '' }) : t('Primo intervento')} · {t('viaggio ~{n} min', { n: ant.viaggio })}</div>
          <div><b>{ant.arrivo}–{ant.partenza}</b> {luogo || indirizzo}</div>
          {ant.nuove.map(n => (
            <div key={n.key} className="row-flex">
              <span className={ant.non_entrano.includes(n.key) ? 'neg' : ''}>{n.prima} → {n.arrivo} {n.luogo}</span>
              {ant.non_entrano.includes(n.key) && <>
                <button className="btn-ghost btn-sm" onClick={() => setSpost({ ...spost, [n.key]: { azione: 'domani' } })}>{t('Sposta a domani')}</button>
                <select defaultValue="" onChange={e => e.target.value && setSpost({ ...spost, [n.key]: { azione: 'tecnico', tecnico_id: Number(e.target.value) } })}>
                  <option value="">{t('Ad altro tecnico…')}</option>
                  {sugg.filter(s => s.tecnico_id !== scelto.tecnico_id).map(s => <option key={s.tecnico_id} value={s.tecnico_id}>{s.nome}</option>)}
                </select></>}
            </div>))}
          {Object.entries(spost).map(([k, v]) => <div key={k} className="sub">↪ {scelto.tappe.find(x => x.key === k)?.luogo}: {v.azione === 'domani' ? t('domani') : dati.tecnici.find(x => x.tecnico_id === v.tecnico_id)?.nome}
            <button className="btn-ghost btn-sm" onClick={() => { const c = { ...spost }; delete c[k]; setSpost(c); }}>×</button></div>)}
          <div>{t('Fine giornata: {a} → {b}', { a: ant.fine_prima ?? '—', b: ant.fine_nuova })}{hm(ant.fine_nuova) > hm(dati.soglia) ? ` ⚠ ${t('oltre le {o}', { o: dati.soglia })}` : ''}</div>
        </div>}
        <button className="btn brand" disabled={invio || !scelto || attivita.trim().length < 2 || (luogo || indirizzo).trim().length < 2} onClick={conferma}>{t('Conferma urgenza')}</button>
        <p className="hint">{t('Il tecnico riceve la notifica solo quando premi «Invia urgente al tecnico».')}</p>
      </>}
    </Modal>
  );
}

interface DatiRiass { compiti: (Compito & { arrivo: string; partenza: string })[]; carico: Carico[]; rientri: Record<string, { rientro: string; primo_libero: string | null }>;
  importati: { id: number; cliente: string; comune: string; cap: string | null; via: string; civico: string; tecnico_id: number; tecnico_sigla: string; lat: number | null; lon: number | null }[];
  cap_zone: Record<string, number>; tecnici: { id: number; nome: string; sigla: string | null }[] }
type Scelta = { azione: 'assegna' | 'rimanda' | 'lascia'; a_tecnico?: number; a_data?: string };

function DaRiassegnare() {
  const { t, tm } = useT();
  const [da, setDa] = useState(oggiISO());
  const [a, setA] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); });
  const [ind, setInd] = useState<{ tec: string; dal: string; al: string }>({ tec: '', dal: oggiISO(), al: oggiISO() });
  const [scelte, setScelte] = useState<Record<string, Scelta>>({});
  const { data, errore, reload } = useLoad(() => rpc<DatiRiass>('variazioni_da_riassegnare', { p_da: da, p_a: a }), [da, a]);
  const nomi = useMemo(() => Object.fromEntries((data?.tecnici ?? []).map(x => [x.id, x.sigla || x.nome])), [data]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const id = (c: Compito) => `${c.data}|${c.tecnico_id}|${c.key}`;
  const sugg = (c: Compito) => suggerisciRiassegnazione(c, data.carico, data.cap_zone, nomi);
  const suggImp = (i: DatiRiass['importati'][number]) => suggerisciRiassegnazione({ key: `imp:${i.id}`, data: '', tecnico_id: i.tecnico_id, luogo: i.cliente, cap: i.cap, lat: i.lat, lon: i.lon },
    data.carico.map(x => ({ ...x, data: '' })), data.cap_zone, nomi);

  function applicaSuggerimenti() {
    const n: Record<string, Scelta> = { ...scelte };
    for (const c of data!.compiti) { const s = sugg(c); if (s && !n[id(c)]) n[id(c)] = { azione: 'assegna', a_tecnico: s.tecnico_id }; }
    for (const i of data!.importati) { const s = suggImp(i); if (s && !n[`imp:${i.id}`]) n[`imp:${i.id}`] = { azione: 'assegna', a_tecnico: s.tecnico_id }; }
    setScelte(n);
  }
  async function applica() {
    const azioni = [
      ...data!.compiti.filter(c => scelte[id(c)]).map(c => ({ tipo: 'tappa', data: c.data, tecnico_id: c.tecnico_id, key: c.key, luogo: c.luogo, attivita: c.attivita, ...scelte[id(c)] })),
      ...data!.importati.filter(i => scelte[`imp:${i.id}`]).map(i => ({ tipo: 'importato', id: i.id, ...scelte[`imp:${i.id}`] })),
    ];
    if (!azioni.length) { toast(t('Nessuna scelta da applicare.')); return; }
    try { const r = await rpc<{ applicate: number }>('variazioni_applica', { p_azioni: azioni }); toast(t('{n} modifiche applicate. Premi «Invia aggiornamenti» per avvisare i tecnici.', { n: r.applicate })); setScelte({}); reload(); }
    catch (e) { toast(tm(testoErrore(e))); }
  }
  async function indisponibile() {
    if (!ind.tec) return;
    try { await rpc('variazioni_indisponibile', { p_tecnico: Number(ind.tec), p_dal: ind.dal, p_al: ind.al }); toast(t('Tecnico segnato indisponibile')); reload(); }
    catch (e) { toast(tm(testoErrore(e))); }
  }
  const sel = (k: string, s: Scelta | null) => { const n = { ...scelte }; if (s) n[k] = s; else delete n[k]; setScelte(n); };

  return (
    <div className="percorsi">
      <div className="perc-bar">
        <label>{t('Dal')} <input type="date" value={da} onChange={e => e.target.value && setDa(e.target.value)} /></label>
        <label>{t('Al')} <input type="date" value={a} onChange={e => e.target.value && setA(e.target.value)} /></label>
      </div>
      <div className="card">
        <strong>{t('Indisponibile')}</strong>
        <div className="perc-bar">
          <select value={ind.tec} onChange={e => setInd({ ...ind, tec: e.target.value })}><option value="">{t('Tecnico…')}</option>{data.tecnici.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
          <input type="date" value={ind.dal} onChange={e => setInd({ ...ind, dal: e.target.value })} />
          <input type="date" value={ind.al} onChange={e => setInd({ ...ind, al: e.target.value })} />
          <button className="btn btn-sm" disabled={!ind.tec} onClick={() => { const o = oggiISO(); setInd({ ...ind, dal: o, al: o }); }}>{t('Solo oggi')}</button>
          <button className="btn brand btn-sm" disabled={!ind.tec} onClick={indisponibile}>{t('Segna indisponibile')}</button>
        </div>
      </div>
      <div className="perc-bar">
        <button className="btn" onClick={applicaSuggerimenti}>{t('Applica suggerimenti')}</button>
        <button className="btn brand" onClick={applica}>{t('Conferma le scelte')}</button>
        <Link className="btn-ghost" to="/giornata">{t('Poi: Invia aggiornamenti')}</Link>
      </div>
      {!data.compiti.length && !data.importati.length && <p className="sub">{t('Nessuna attività da riassegnare nel periodo.')}</p>}
      {data.compiti.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>{t('Giorno')}</th><th>{t('Tecnico assente')}</th><th>{t('Intervento')}</th><th>{t('Scelta')}</th></tr></thead>
        <tbody>{data.compiti.map(c => {
          const k = id(c); const s = sugg(c); const r = data.rientri[String(c.tecnico_id)]; const sc = scelte[k];
          return (
            <tr key={k}><td className="nowrap">{c.data} {c.arrivo}</td><td>{nomi[c.tecnico_id]}</td><td>{c.luogo}<div className="sub">{c.attivita}</div></td>
              <td>
                <select value={sc ? `${sc.azione}:${sc.a_tecnico ?? sc.a_data ?? ''}` : ''} onChange={e => {
                  const [az, v] = e.target.value.split(':');
                  sel(k, !az ? null : az === 'assegna' ? { azione: 'assegna', a_tecnico: Number(v) } : az === 'rimanda' ? { azione: 'rimanda', a_data: v } : { azione: 'lascia' });
                }}>
                  <option value="">{t('— scegli —')}</option>
                  {s && <option value={`assegna:${s.tecnico_id}`}>★ {t('Assegna a {n}', { n: nomi[s.tecnico_id] })} ({s.motivo})</option>}
                  {data.tecnici.filter(x => x.id !== c.tecnico_id && x.id !== s?.tecnico_id).map(x => <option key={x.id} value={`assegna:${x.id}`}>{t('Assegna a {n}', { n: x.sigla || x.nome })}</option>)}
                  {r?.primo_libero && <option value={`rimanda:${r.primo_libero}`}>{t('Rimanda al {d} (primo giorno libero dopo il rientro)', { d: r.primo_libero })}</option>}
                  <option value="lascia:">{t('Lascia da pianificare')}</option>
                </select>
              </td></tr>);
        })}</tbody></table></div>}
      {data.importati.length > 0 && <div className="card"><strong>{t('Interventi del mese del tecnico assente')}</strong>
        {data.importati.map(i => { const s = suggImp(i); const k = `imp:${i.id}`; return (
          <div key={i.id} className="row-flex">{i.cliente} · {i.via} {i.civico} {i.comune} <span className="sub">{i.tecnico_sigla}</span>
            <select value={scelte[k] ? `${scelte[k].azione}:${scelte[k].a_tecnico ?? ''}` : ''} onChange={e => { const [az, v] = e.target.value.split(':'); sel(k, !az ? null : az === 'assegna' ? { azione: 'assegna', a_tecnico: Number(v) } : { azione: 'lascia' }); }}>
              <option value="">{t('— scegli —')}</option>
              {s && <option value={`assegna:${s.tecnico_id}`}>★ {t('Assegna a {n}', { n: nomi[s.tecnico_id] })} ({s.motivo})</option>}
              {data.tecnici.filter(x => x.id !== i.tecnico_id && x.sigla).map(x => <option key={x.id} value={`assegna:${x.id}`}>{t('Assegna a {n}', { n: x.sigla! })}</option>)}
              <option value="lascia:">{t('Lascia da pianificare')}</option>
            </select></div>); })}
      </div>}
    </div>
  );
}
