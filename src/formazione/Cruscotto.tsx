import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { fmtData } from '../lib/format';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { STATO_CORSO, apriAttestato, caricaTutto, type Richiesta, type StatoCorso, type Tutto } from './comune';

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const Kpi = ({ n, l, s, cls }: { n: ReactNode; l: string; s?: string; cls?: string }) => (
  <div className={`kpi ${cls ?? ''}`}><div className="num">{n}</div><div className="lbl">{l}</div>{s && <div className="sub">{s}</div>}</div>);

export function kpi(t: Tutto) {
  const tec = t.dip.filter(d => d.categoria === 'TEC');
  const nonInRegola = new Set(t.righe.filter(r => r.obbligatorio && r.categoria === 'TEC' && (r.stato === 'scaduto' || r.stato === 'mancante')).map(r => r.dipendente_id));
  const inRegola = tec.filter(d => !nonInRegola.has(d.id)).length;
  const entro = (g: number) => t.righe.filter(r => r.giorni != null && r.giorni >= 0 && r.giorni <= g).length;
  return { tec: tec.length, inRegola, s30: entro(30), s90: entro(90), s180: entro(180),
    scaduti: t.righe.filter(r => r.stato === 'scaduto').length, mancanti: t.righe.filter(r => r.stato === 'mancante').length,
    senzaAtt: t.registrazioni.filter(r => r.attuale && r.attivo && r.n_attestati === 0).length };
}

function Barra({ v, max, colore }: { v: number; max: number; colore: string }) {
  return <div style={{ height: 14, background: 'var(--surface-2)', borderRadius: 7, overflow: 'hidden' }}><div style={{ width: `${max ? (v / max) * 100 : 0}%`, height: '100%', background: colore }} /></div>;
}

export default function Cruscotto() {
  const nav = useNavigate();
  const { data, errore, reload } = useLoad(caricaTutto);
  const [prop, setProp] = useState<Richiesta | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const k = kpi(data);
  const perc = k.tec ? Math.round((k.inRegola / k.tec) * 100) : 0;
  const daVerificare = data.richieste.filter(p => p.stato === 'da_verificare');
  const inAttesa = data.richieste.filter(p => p.stato === 'richiesto' || p.stato === 'rifiutato');
  const regDi = (q: Richiesta) => data.registrazioni.find(r => r.id === q.corso_dipendente_id);
  async function ricorda(q: Richiesta) {
    try { await rpc('formazione_ricorda_attestato', { p_id: q.id }); toast('Promemoria inviato'); reload(); } catch (e) { toast(testoErrore(e)); }
  }
  // copertura per corso
  const cop = data.corsi.filter(c => c.attivo).map(c => {
    const r = data.righe.filter(x => x.corso_id === c.id);
    const n = (s: StatoCorso) => r.filter(x => x.stato === s).length;
    return { c, v: n('valido'), w: n('in_scadenza'), k: n('scaduto'), m: n('mancante') };
  }).filter(x => x.v + x.w + x.k + x.m > 0);
  const maxCop = Math.max(1, ...cop.map(x => x.v + x.w + x.k + x.m));
  // trend 12 mesi
  const o = new Date(data.oggi + 'T00:00:00Z');
  const mesi = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(o.getUTCFullYear(), o.getUTCMonth() - 11 + i, 1)); return d.toISOString().slice(0, 7); });
  const trend = mesi.map(m => data.registrazioni.filter(r => r.data_conseguimento.startsWith(m)).length);
  const maxT = Math.max(1, ...trend);
  // ore
  const anni = [...new Set(data.registrazioni.map(r => r.data_conseguimento.slice(0, 4)))].sort().slice(-5);
  const orePerAnno = anni.map(a => ({ a, h: data.registrazioni.filter(r => r.data_conseguimento.startsWith(a)).reduce((s, r) => s + Number(r.ore ?? 0), 0) }));
  const annoCorr = data.oggi.slice(0, 4);
  const orePerDip = Object.entries(data.registrazioni.filter(r => r.data_conseguimento.startsWith(annoCorr) && r.ore)
    .reduce<Record<string, number>>((m, r) => { m[r.nome] = (m[r.nome] ?? 0) + Number(r.ore); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxO = Math.max(1, ...orePerAnno.map(x => x.h), ...orePerDip.map(x => x[1]));
  const azioni = data.righe.filter(r => r.stato !== 'valido').sort((a, b) => (a.giorni ?? -9999) - (b.giorni ?? -9999));
  return (
    <>
      <div className="page-hero"><div><h1>Cruscotto formazione</h1><p className="sub">La situazione di oggi e cosa fare.</p></div></div>

      {daVerificare.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>Da verificare ({daVerificare.length})</h2>
          <p className="sub">Attestati caricati dai dipendenti: non valgono finché non li approvi.</p>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {daVerificare.map(p => (
              <div key={p.id} style={{ border: '2px solid var(--warn-line)', borderRadius: 14, padding: 14, background: 'var(--surface)' }}>
                <Anteprima p={p} />
                <b>{regDi(p)?.nome ?? '—'}</b>
                <div className="sub">{regDi(p)?.corso} · fatto il {fmtData(regDi(p)?.data_conseguimento)}</div>
                <button className="btn" style={{ marginTop: 8 }} onClick={() => setProp(p)}>Verifica</button>
              </div>))}
          </div>
        </section>)}
      {inAttesa.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>Attestati chiesti ai dipendenti ({inAttesa.length})</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Chi</th><th>Corso</th><th>Chiesto il</th><th></th></tr></thead>
            <tbody>{inAttesa.map(q => (
              <tr key={q.id}><td><b>{regDi(q)?.nome}</b></td>
                <td>{regDi(q)?.corso}{q.stato === 'rifiutato' && <div className="sub">Rifiutato: {q.motivo} — in attesa di un nuovo file</div>}</td>
                <td>{fmtData(q.richiesto_il)}{q.ultimo_promemoria && <div className="sub">promemoria {fmtData(q.ultimo_promemoria)}</div>}</td>
                <td><button className="btn-ghost btn-sm" onClick={() => ricorda(q)}>Ricorda</button></td></tr>))}</tbody>
          </table></div>
        </section>)}

      <div className="kpis">
        <Kpi n={`${perc}%`} l="Tecnici in regola" s={`${k.inRegola} su ${k.tec} hanno tutti gli obbligatori validi`} cls={perc === 100 ? 'ok' : 'warn'} />
        <Kpi n={k.scaduti} l="Corsi scaduti" cls={k.scaduti ? 'ko' : 'ok'} />
        <Kpi n={k.mancanti} l="Obbligatori mai fatti" cls={k.mancanti ? 'ko' : 'ok'} />
        <Kpi n={k.senzaAtt} l="Senza attestato" s="corsi da completare con il documento" cls={k.senzaAtt ? 'warn' : 'ok'} />
      </div>
      <div className="kpis">
        <Kpi n={k.s30} l="Scadono entro 30 giorni" cls={k.s30 ? 'ko' : ''} />
        <Kpi n={k.s90} l="Scadono entro 90 giorni" cls={k.s90 ? 'warn' : ''} />
        <Kpi n={k.s180} l="Scadono entro 6 mesi" cls="info" />
      </div>

      <h2>Azioni da fare</h2>
      {azioni.length === 0 ? <p className="sub">Tutto in regola.</p> : (
        <div className="table-wrap" style={{ marginBottom: 28 }}><table>
          <thead><tr><th>Chi</th><th>Cosa</th><th>Entro</th><th></th></tr></thead>
          <tbody>{azioni.slice(0, 40).map((r, i) => (
            <tr key={i}><td><b>{r.nome}</b></td>
              <td>{r.stato === 'mancante' ? 'Fare' : 'Rinnovare'} «{r.corso}» <Pill s={STATO_CORSO[r.stato][0]}>{STATO_CORSO[r.stato][1]}</Pill></td>
              <td>{r.stato === 'in_scadenza' ? fmtData(r.data_scadenza) : <b style={{ color: 'var(--ko)' }}>Subito</b>}</td>
              <td><button className="btn btn-sm" onClick={() => nav(`/formazione/dipendenti?d=${r.dipendente_id}&c=${r.corso_id}`)}>{r.stato === 'mancante' ? 'Registra' : 'Rinnova'}</button></td></tr>))}</tbody>
        </table></div>)}

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <section><h2>Copertura per corso</h2>
          <p className="sub"><span style={{ color: 'var(--ok)' }}>■</span> valido <span style={{ color: 'var(--warn)' }}>■</span> in scadenza <span style={{ color: 'var(--ko)' }}>■</span> scaduto <span style={{ color: 'var(--na)' }}>■</span> mancante</p>
          {cop.length === 0 && <p className="sub">Ancora nessun dato.</p>}
          {cop.map(x => (
            <div key={x.c.id} style={{ marginBottom: 10 }}>
              <div className="row-flex" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>{x.c.nome}</span><span className="sub">{x.v}/{x.v + x.w + x.k + x.m}</span></div>
              <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)', width: `${((x.v + x.w + x.k + x.m) / maxCop) * 100}%` }}>
                {([[x.v, 'var(--ok)'], [x.w, 'var(--warn)'], [x.k, 'var(--ko)'], [x.m, 'var(--na)']] as [number, string][]).map(([n, c], i) => n > 0 && <div key={i} title={String(n)} style={{ flex: n, background: c }} />)}
              </div>
            </div>))}
        </section>
        <section><h2>Corsi fatti negli ultimi 12 mesi</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, borderBottom: '1px solid var(--line)' }}>
            {trend.map((n, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <span className="sub" style={{ fontSize: 12 }}>{n || ''}</span>
                <div style={{ width: '100%', height: `${(n / maxT) * 120}px`, background: 'var(--info)', borderRadius: '4px 4px 0 0', minHeight: n ? 3 : 0 }} />
              </div>))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>{mesi.map(m => <span key={m} className="sub" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>{MESI[Number(m.slice(5)) - 1]}</span>)}</div>
        </section>
        <section><h2>Ore di formazione per anno</h2>
          {orePerAnno.length === 0 && <p className="sub">Nessuna ora registrata.</p>}
          {orePerAnno.map(x => <div key={x.a} style={{ marginBottom: 8 }}><div className="row-flex" style={{ justifyContent: 'space-between' }}><span>{x.a}</span><b>{x.h} h</b></div><Barra v={x.h} max={maxO} colore="var(--info)" /></div>)}
        </section>
        <section><h2>Ore per dipendente · {annoCorr}</h2>
          {orePerDip.length === 0 && <p className="sub">Nessuna ora registrata quest'anno.</p>}
          {orePerDip.map(([n, h]) => <div key={n} style={{ marginBottom: 8 }}><div className="row-flex" style={{ justifyContent: 'space-between' }}><span>{n}</span><b>{h} h</b></div><Barra v={h} max={maxO} colore="var(--ok)" /></div>)}
        </section>
      </div>
      <ImpostazioniAvvisi />
      {prop && <ModaleVerifica p={prop} t={data} onClose={() => setProp(null)} onFatto={() => { setProp(null); reload(); }} />}
    </>
  );
}

function Anteprima({ p }: { p: Richiesta }) {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { if (p.path && p.mime?.startsWith('image/') && p.mime !== 'image/heic') supabase.storage.from('attestati').createSignedUrl(p.path, 300).then(r => setU(r.data?.signedUrl ?? null)); }, [p]);
  if (!p.path) return null;
  return u ? <img src={u} alt="Anteprima attestato" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }} onClick={() => apriAttestato(p.path!)} />
    : <button className="btn-ghost" style={{ width: '100%', height: 70, marginBottom: 8 }} onClick={() => apriAttestato(p.path!).catch(e => toast(e.message))}>Apri {p.mime === 'application/pdf' ? 'PDF' : 'file'}</button>;
}

function ModaleVerifica({ p, t, onClose, onFatto }: { p: Richiesta; t: Tutto; onClose: () => void; onFatto: () => void }) {
  const r = t.registrazioni.find(x => x.id === p.corso_dipendente_id);
  const [rifiuto, setRifiuto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function approva(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try { await rpc('formazione_approva_richiesta', { p_id: p.id }); toast('Attestato approvato'); onFatto(); }
    catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }
  async function rifiuta() {
    if (!rifiuto?.trim()) return setErr('Scrivi il motivo.');
    setInvio(true);
    try { await rpc('formazione_rifiuta_richiesta', { p_id: p.id, p_motivo: rifiuto }); toast('Rifiutato: il dipendente riceve il motivo'); onFatto(); }
    catch (x) { setErr(testoErrore(x)); setInvio(false); }
  }
  return (
    <Modal titolo={`Verifica attestato · ${r?.nome ?? ''}`} onClose={onClose}>
      <form className="form" onSubmit={approva}>
        <Anteprima p={p} />
        <p style={{ margin: 0 }}><b>{r?.corso}</b><br /><span className="sub">Fatto il {fmtData(r?.data_conseguimento)} · {r?.data_scadenza ? `scade il ${fmtData(r.data_scadenza)}` : 'non scade'}</span></p>
        <p className="hint">Se corso o data sono sbagliati, correggili dalla scheda del dipendente (Rinnova) dopo l'approvazione.</p>
        {err && <Banner s="ko">{err}</Banner>}
        {rifiuto == null ? (
          <div className="row-flex"><button className="btn" style={{ fontSize: 17 }} disabled={invio}>Approva</button>
            <button type="button" className="btn-ghost" onClick={() => setRifiuto('')}>Rifiuta</button></div>
        ) : (
          <>
            <div className="field"><label htmlFor="v-m">Motivo del rifiuto (lo vede il dipendente)</label><input id="v-m" value={rifiuto} onChange={e => setRifiuto(e.target.value)} autoFocus maxLength={300} /></div>
            <div className="row-flex"><button type="button" className="btn" disabled={invio} onClick={rifiuta}>Conferma rifiuto</button>
              <button type="button" className="btn-ghost" onClick={() => setRifiuto(null)}>Indietro</button></div>
          </>)}
      </form>
    </Modal>
  );
}

function ImpostazioniAvvisi() {
  const [v, setV] = useState<{ soglie_mesi: number[]; email: boolean } | null>(null);
  useEffect(() => { supabase.from('formazione_impostazioni').select('soglie_mesi,email').eq('id', 1).maybeSingle().then(r => setV(r.data as typeof v)); }, []);
  if (!v) return null;
  async function salva(n: typeof v) {
    setV(n);
    const { error } = await supabase.from('formazione_impostazioni').update({ ...n, aggiornato_il: new Date().toISOString() }).eq('id', 1);
    if (error) toast(testoErrore(error)); else { toast('Avvisi aggiornati'); rpc('formazione_controlla', {}).catch(() => undefined); }
  }
  const tocca = (m: number) => salva({ ...v!, soglie_mesi: v!.soglie_mesi.includes(m) ? v!.soglie_mesi.filter(x => x !== m) : [...v!.soglie_mesi, m].sort((a, b) => b - a) });
  return (
    <section style={{ marginTop: 32, border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Avvisi di scadenza</h2>
      <p className="sub">Ricevi un avviso nella campanella quando un corso scade entro:</p>
      <div className="row-flex">
        {[6, 3, 1].map(m => <label key={m} className="row-flex" style={{ fontSize: 16 }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={v.soglie_mesi.includes(m)} onChange={() => tocca(m)} />{m} {m === 1 ? 'mese' : 'mesi'}</label>)}
      </div>
      <label className="row-flex" style={{ fontSize: 16, marginTop: 10 }}><input type="checkbox" style={{ width: 20, height: 20 }} checked={v.email} onChange={e => salva({ ...v, email: e.target.checked })} />
        Mandami anche un'email riassuntiva (al massimo una al giorno)</label>
    </section>
  );
}
