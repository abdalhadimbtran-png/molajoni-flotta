import { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { Banner, Caricamento, Errore, Pill, toast, useLoad } from '../ui';
import { giornoLungo, nomeTipo, type TipoAssenza } from './comune';
import { erroreHR } from './componenti';

interface Festa { data: string; nome: string; origine: 'nazionale' | 'patrono' | 'altro'; attiva: boolean }
interface Spettanza { anno: number; tipo: string; quantita: number; nota_ccnl: string | null; da_confermare: boolean }
interface Config { chiave: string; valore: string | null; descrizione: string; da_confermare: boolean }

/** Festività, spettanze annue, tipi di assenza attivi e configurazione aziendale. */
export default function Impostazioni() {
  return (
    <>
      <div className="page-hero"><div><h1>Festività e regole</h1><p className="sub">Le regole che il sistema usa per contare giorni e saldi. Di solito si controllano una volta all'anno.</p></div></div>
      <div className="hr-imp">
        <Festivita />
        <Spettanze />
        <TipiAssenza />
        <ConfigAzienda />
      </div>
    </>
  );
}

function Festivita() {
  const [anno, setAnno] = useState(Number(oggiISO().slice(0, 4)));
  const [f, setF] = useState({ data: '', nome: '', origine: 'patrono' as 'patrono' | 'altro' });
  const [err, setErr] = useState<string | null>(null);
  const [annulla, setAnnulla] = useState<Festa | null>(null);
  const timer = useRef<number>();
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('festivita').select('data,nome,origine,attiva').gte('data', `${anno}-01-01`).lte('data', `${anno}-12-31`).order('data');
    if (error) throw error; return data as Festa[];
  }, [anno]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function genera() {
    try { const n = await rpc<number>('hr_genera_festivita', { p_anno: anno }); toast(n ? `Aggiunte ${n} festività nazionali.` : 'Le festività nazionali ci sono già.'); reload(); }
    catch (e) { toast(erroreHR(e)); }
  }
  async function aggiungi(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const esiste = data?.find(x => x.data === f.data);
    const r = esiste ? await supabase.from('festivita').update({ nome: f.nome.trim(), origine: f.origine, attiva: true }).eq('data', f.data)
      : await supabase.from('festivita').insert({ data: f.data, nome: f.nome.trim(), origine: f.origine });
    if (r.error) { setErr(erroreHR(r.error)); return; }
    toast('Festività aggiunta.'); setF({ data: '', nome: '', origine: 'patrono' }); reload();
  }
  async function attiva(x: Festa, v: boolean) {
    const { error } = await supabase.from('festivita').update({ attiva: v }).eq('data', x.data);
    if (error) { toast(erroreHR(error)); return; }
    reload();
    window.clearTimeout(timer.current);
    if (!v) { setAnnulla(x); timer.current = window.setTimeout(() => setAnnulla(null), 8000); } else setAnnulla(null);
  }
  const attive = (data ?? []).filter(x => x.attiva);
  const patrono = attive.some(x => x.origine === 'patrono');
  const naz = attive.filter(x => x.origine === 'nazionale').length;
  return (
    <section className="panel">
      <div className="hr-panel-h"><h2>Festività {anno}</h2>
        <select aria-label="Anno" value={anno} onChange={e => setAnno(Number(e.target.value))}>{[-1, 0, 1, 2].map(d => { const a = Number(oggiISO().slice(0, 4)) + d; return <option key={a}>{a}</option>; })}</select>
        <span className="spacer" />{naz < 12 && <button className="btn-ghost btn-sm" onClick={genera}>Aggiungi le festività nazionali</button>}</div>
      {errore && <Errore testo={errore} onRetry={reload} />}
      {!patrono && data && <Banner s="warn">Aggiungi il santo patrono della sede, se è un giorno di festa.</Banner>}
      {annulla && <Banner s="ok"><div className="row-flex">Festività tolta: {annulla.nome}. <button className="btn-ghost btn-sm" onClick={() => attiva(annulla, true)}>Annulla</button></div></Banner>}
      {!data ? <Caricamento /> : <ul className="hr-feste">
        {data.filter(x => x.attiva).map(x => (
          <li key={x.data}><span className="hr-feste-d">{giornoLungo(x.data)}</span><span>{x.nome}</span>
            {x.origine === 'nazionale' ? <Pill s="na">Nazionale</Pill> : <Pill s="info">{x.origine === 'patrono' ? 'Santo patrono' : 'Aziendale / locale'}</Pill>}
            <span className="spacer" />{x.origine !== 'nazionale' && <button className="btn-ghost btn-sm" onClick={() => attiva(x, false)}>Togli</button>}</li>))}
        {!attive.length && <li className="sub">Nessuna festività per il {anno}. Usa «Aggiungi le festività nazionali».</li>}
      </ul>}
      <form className="row-flex wrap-end hr-add" onSubmit={aggiungi}>
        <div className="field"><label htmlFor="fe-d">Data</label><input id="fe-d" type="date" required min={`${anno}-01-01`} max={`${anno}-12-31`} value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="fe-n">Nome</label><input id="fe-n" required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder="Es. Santo patrono, Chiusura aziendale" /></div>
        <div className="field"><label htmlFor="fe-o">Tipo</label><select id="fe-o" value={f.origine} onChange={e => setF({ ...f, origine: e.target.value as 'patrono' | 'altro' })}><option value="patrono">Santo patrono</option><option value="altro">Aziendale / locale</option></select></div>
        <button className="btn">Aggiungi festività</button>
      </form>
      {err && <Banner s="ko">{err}</Banner>}
      <p className="hint">Le nazionali non si tolgono. Le festività valgono per tutti: quei giorni non contano nelle richieste.</p>
    </section>
  );
}

const SPETT: [string, string, string][] = [['FERIE', 'Giorni di ferie all\'anno (tempo pieno)', 'giorni'], ['ROL', 'Ore di permesso ROL all\'anno (tempo pieno)', 'ore'], ['EXF', 'Ore di ex festività all\'anno (tempo pieno)', 'ore']];
function Spettanze() {
  const y = Number(oggiISO().slice(0, 4));
  const [anno, setAnno] = useState(y);
  const [v, setV] = useState<Record<string, string>>({});
  const [conf, setConf] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('spettanze').select('*').eq('anno', anno);
    if (error) throw error; return data as Spettanza[];
  }, [anno]);
  useEffect(() => {
    if (!data) return;
    setV(Object.fromEntries(SPETT.map(([k]) => [k, String(data.find(x => x.tipo === k)?.quantita ?? '').replace('.', ',')])));
    setConf(data.length > 0 && data.every(x => !x.da_confermare));
  }, [data]);
  const cambiate = data && SPETT.some(([k]) => String(data.find(x => x.tipo === k)?.quantita ?? '').replace('.', ',') !== (v[k] ?? ''));
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    for (const [k] of SPETT) {
      const q = Number((v[k] ?? '').replace(',', '.'));
      if (!(v[k] ?? '').trim() || Number.isNaN(q) || q < 0) { setErr('Scrivi tutti i valori (numeri, anche con la virgola).'); return; }
      const c = data?.find(x => x.tipo === k);
      const r = c ? await supabase.from('spettanze').update({ quantita: q, da_confermare: !conf }).eq('anno', anno).eq('tipo', k)
        : await supabase.from('spettanze').insert({ anno, tipo: k, quantita: q, da_confermare: !conf });
      if (r.error) { setErr(erroreHR(r.error)); return; }
    }
    toast('Spettanze salvate.'); reload();
  }
  return (
    <section className="panel">
      <div className="hr-panel-h"><h2>Ferie e permessi all'anno</h2>
        <select aria-label="Anno" value={anno} onChange={e => setAnno(Number(e.target.value))}>{[y - 1, y, y + 1].map(a => <option key={a}>{a}</option>)}</select></div>
      {errore && <Errore testo={errore} onRetry={reload} />}
      {data && data.some(x => x.da_confermare) && <Banner s="warn">I valori del {anno} sono di esempio: confermali con il contratto collettivo applicato.</Banner>}
      {!data ? <Caricamento /> : <form className="form" onSubmit={salva}>
        <div className="form grid2">{SPETT.map(([k, l, u]) => (
          <div key={k} className="field"><label htmlFor={`sp-${k}`}>{l}</label>
            <div className="row-flex"><input id={`sp-${k}`} inputMode="decimal" value={v[k] ?? ''} onChange={e => setV({ ...v, [k]: e.target.value.replace(/[^0-9.,]/g, '') })} style={{ maxWidth: 140 }} /><span className="sub">{u}</span></div></div>))}</div>
        <label className="chk"><input type="checkbox" checked={conf} onChange={e => setConf(e.target.checked)} /> Valori controllati con il contratto collettivo</label>
        {cambiate && anno === y && <Banner s="warn">Attenzione: il saldo si ricalcola subito con il nuovo valore, anche per i mesi già maturati di quest'anno.</Banner>}
        <p className="hint" style={{ marginTop: 0 }}>Per i part-time il sistema calcola la parte in proporzione alle ore. Ogni mese matura un dodicesimo. Il saldo non usato passa all'anno dopo.</p>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button></div>
      </form>}
    </section>
  );
}

function TipiAssenza() {
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('tipi_assenza').select('*').order('ordine');
    if (error) throw error; return data as TipoAssenza[];
  });
  async function cambia(t: TipoAssenza, campo: 'attivo' | 'richiedibile', v: boolean) {
    const { error } = await supabase.from('tipi_assenza').update({ [campo]: v }).eq('codice', t.codice);
    if (error) toast(erroreHR(error)); else reload();
  }
  const fissi = ['FERIE', 'ROL'];
  return (
    <section className="panel">
      <div className="hr-panel-h"><h2>Tipi di assenza</h2></div>
      {errore && <Errore testo={errore} onRetry={reload} />}
      {!data ? <Caricamento /> : <div className="table-wrap"><table>
        <thead><tr><th>Tipo</th><th>Si conta in</th><th>Attivo</th><th>Lo chiede anche il dipendente dall'app</th></tr></thead>
        <tbody>{data.map(t => (
          <tr key={t.codice} className={t.attivo ? '' : 'muted'}>
            <td><b>{nomeTipo(t.descrizione)}</b><div className="sub">{t.descrizione !== nomeTipo(t.descrizione) ? t.descrizione : ''}{t.con_saldo ? ' · scala dal saldo' : ''}</div></td>
            <td>{t.unita}{t.mezza_giornata ? ' · anche mezza giornata' : ''}</td>
            <td><label className="chk"><input type="checkbox" checked={t.attivo} disabled={fissi.includes(t.codice)} onChange={e => cambia(t, 'attivo', e.target.checked)} /> {t.attivo ? 'Sì' : 'No'}</label></td>
            <td><label className="chk"><input type="checkbox" checked={t.richiedibile} disabled={!t.attivo || fissi.includes(t.codice)} onChange={e => cambia(t, 'richiedibile', e.target.checked)} /> {t.richiedibile ? 'Sì' : 'Solo l\'ufficio'}</label></td>
          </tr>))}</tbody>
      </table></div>}
      <p className="hint">Ferie e permesso ROL restano sempre attivi. Un tipo non attivo non si può più scegliere; le richieste già fatte restano.</p>
    </section>
  );
}

const ETICHETTE: Record<string, [string, string]> = {
  comune_sede: ['Comune della sede', 'Serve a ricordare il santo patrono.'],
  ccnl: ['Contratto collettivo applicato', 'Es. Metalmeccanico industria.'],
  maturazione_giorni_minimi: ['Giorni minimi per maturare il mese', 'Un mese matura ferie e permessi se il rapporto copre almeno questi giorni.'],
  ore_giornaliere_full_time: ['Ore di una giornata a tempo pieno', 'Base per la proporzione dei part-time.'],
};
function ConfigAzienda() {
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('config_azienda').select('chiave,valore,descrizione,da_confermare').order('chiave');
    if (error) throw error; return data as Config[];
  });
  useEffect(() => { if (data) setV(Object.fromEntries(data.map(c => [c.chiave, c.valore ?? '']))); }, [data]);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    for (const c of data ?? []) {
      const nv = (v[c.chiave] ?? '').trim();
      if (nv === (c.valore ?? '')) continue;
      const { error } = await supabase.from('config_azienda').update({ valore: nv || null, da_confermare: false }).eq('chiave', c.chiave);
      if (error) { setErr(/check/.test(error.message) ? `Valore non valido per «${ETICHETTE[c.chiave]?.[0] ?? c.chiave}».` : erroreHR(error)); return; }
    }
    toast('Impostazioni salvate.'); reload();
  }
  return (
    <section className="panel">
      <div className="hr-panel-h"><h2>Azienda</h2></div>
      {errore && <Errore testo={errore} onRetry={reload} />}
      {!data ? <Caricamento /> : <form className="form" onSubmit={salva}>
        <div className="form grid2">{data.map(c => (
          <div key={c.chiave} className="field"><label htmlFor={`cf-${c.chiave}`}>{ETICHETTE[c.chiave]?.[0] ?? c.descrizione} {c.da_confermare && <Pill s="warn">da confermare</Pill>}</label>
            <input id={`cf-${c.chiave}`} value={v[c.chiave] ?? ''} onChange={e => setV({ ...v, [c.chiave]: e.target.value })} />
            <span className="sub">{ETICHETTE[c.chiave]?.[1] ?? ''}</span></div>))}</div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button></div>
      </form>}
    </section>
  );
}
