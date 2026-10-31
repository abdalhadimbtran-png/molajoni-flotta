import { FormEvent, useMemo, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { fmtQ, nomeCategoria, nomeTipo, num, testoQuando, type Richiesta, type SaldiDipendente, type Saldo, type Unita } from './comune';
import { erroreHR } from './componenti';

const TIPI: [string, string][] = [['FERIE', 'Ferie'], ['ROL', 'Permessi ROL'], ['EXF', 'Ex festività']];
const mesiNomi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Saldi di tutti, movimenti e rettifiche tracciate. I numeri arrivano dal server (privato.saldo). */
export default function Saldi() {
  const oggi = oggiISO();
  const [anno, setAnno] = useState(Number(oggi.slice(0, 4)));
  const [tipo, setTipo] = useState('FERIE');
  const [rett, setRett] = useState<{ dip?: number } | null>(null);
  const [mov, setMov] = useState<SaldiDipendente | null>(null);
  const [iniziali, setIniziali] = useState(false);
  const { data, errore, reload } = useLoad(async () => {
    const [s, si] = await Promise.all([
      rpc<SaldiDipendente[]>('hr_saldi', { p_anno: anno }),
      supabase.from('saldi_iniziali').select('dipendente_id,tipo').eq('anno', anno),
    ]);
    return { righe: s, conIniziale: new Set((si.data ?? []).map((x: { dipendente_id: number }) => x.dipendente_id)) };
  }, [anno]);
  const righe = useMemo(() => (data?.righe ?? []).map(d => ({ d, s: d.saldi.find(x => x.tipo === tipo) })).filter(x => x.s) as { d: SaldiDipendente; s: Saldo }[], [data, tipo]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const unita: Unita = tipo === 'FERIE' ? 'giorni' : 'ore';
  const somma = (k: keyof Saldo) => righe.reduce((a, x) => a + Number(x.s[k] ?? 0), 0);
  const negativi = righe.filter(x => x.s.saldo < 0).length;
  const senza = (data?.righe ?? []).filter(d => d.attivo && !data!.conIniziale.has(d.dipendente_id)).length;
  const [y, m] = oggi.split('-').map(Number);
  const prossima = m === 12 ? `1 gennaio ${y + 1}` : `1 ${mesiNomi[m]} ${y}`;
  const daConfermare = righe.some(x => x.s.spettanza_da_confermare);

  return (
    <>
      <div className="page-hero">
        <div><h1>Saldi</h1><p className="sub">Ferie e permessi di tutti. Le correzioni si fanno con una rettifica e restano nello storico.</p></div>
        <button className="btn" onClick={() => setRett({})}>Rettifica un saldo</button>
      </div>
      {senza > 0 && anno === y && <Banner s="warn"><div className="row-flex"><span>{senza} {senza === 1 ? 'dipendente non ha' : 'dipendenti non hanno'} ancora il saldo di partenza.</span>
        <button className="btn btn-sm" onClick={() => setIniziali(true)}>Inserisci i saldi di partenza</button></div></Banner>}
      {daConfermare && <Banner s="warn">Le spettanze annue di {anno} sono valori di esempio da confermare col contratto: controllale in «Festività e regole».</Banner>}
      <div className="hr-barra">
        <select aria-label="Anno" value={anno} onChange={e => setAnno(Number(e.target.value))}>{[y - 1, y, y + 1].map(a => <option key={a}>{a}</option>)}</select>
        <div className="segmented" role="group" aria-label="Tipo">{TIPI.map(([k, l]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{l}</button>)}</div>
      </div>
      {!data ? <Caricamento /> : <>
        <div className="rep-riepilogo hr-riep">
          <div><span>Dipendenti</span><b>{righe.length}</b></div>
          <div><span>{unita === 'giorni' ? 'Giorni maturati' : 'Ore maturate'}</span><b>{num(somma('maturato'), 1)}</b></div>
          <div><span>{unita === 'giorni' ? 'Giorni usati e approvati' : 'Ore usate e approvate'}</span><b>{num(somma('goduto'), 1)}</b></div>
          <div className={negativi ? 'hr-riep-ko' : ''}><span>Saldi negativi</span><b>{negativi}</b></div>
        </div>
        <div className="table-wrap"><table className="hr-tab">
          <thead><tr><th>Dipendente</th><th className="num-c">Saldo di partenza</th><th className="num-c">Maturati</th><th className="num-c">Usati e approvati</th><th className="num-c">In valutazione</th><th className="num-c">Rettifiche</th><th className="num-c">Saldo</th></tr></thead>
          <tbody>{righe.length ? righe.map(({ d, s }) => (
            <tr key={d.dipendente_id} className={`hr-click ${d.attivo ? '' : 'muted'}`} onClick={() => setMov(d)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setMov(d); }}>
              <td><b>{d.nome}</b><div className="sub">{nomeCategoria(d.categoria)}{d.reparto ? ` · ${d.reparto}` : ''}{d.contratto === 'part-time' ? ' · part-time' : ''}</div></td>
              <td className="num-c mono">{num(s.saldo_iniziale)}<div className="sub">{s.origine === 'saldo_iniziale' ? `al ${testoQuando(s.data_riferimento!)}` : s.origine === 'riporto_anno_precedente' ? 'dall\'anno scorso' : '—'}</div></td>
              <td className="num-c mono">{num(s.maturato)}<div className="sub">{s.mesi_maturati} mesi</div></td>
              <td className="num-c mono">{num(s.goduto)}</td>
              <td className="num-c mono">{s.in_attesa ? num(s.in_attesa) : '—'}</td>
              <td className="num-c mono">{s.rettifiche ? (s.rettifiche > 0 ? '+' : '') + num(s.rettifiche) : '—'}</td>
              <td className="num-c">{s.saldo < 0 ? <Pill s="ko">{num(s.saldo)}</Pill> : <b className="mono">{num(s.saldo)}</b>}</td>
            </tr>)) : <tr><td colSpan={7} className="sub">Nessun dipendente.</td></tr>}</tbody>
        </table></div>
        <p className="hint">Valori in {unita}. La maturazione è automatica: un dodicesimo della spettanza annua per ogni mese lavorato. Prossima maturazione: {prossima}. «Usati e approvati» comprende anche le assenze approvate future dell'anno.</p>
      </>}
      {rett && data && <ModaleRettifica righe={data.righe} anno={anno} tipo={tipo} dip={rett.dip} onClose={() => setRett(null)} onSalvato={() => { setRett(null); reload(); }} />}
      {mov && <ModaleMovimenti d={mov} anno={anno} tipo={tipo} onClose={() => setMov(null)} onRettifica={() => { setRett({ dip: mov.dipendente_id }); setMov(null); }} />}
      {iniziali && data && <ModaleIniziali righe={data.righe.filter(d => d.attivo && !data.conIniziale.has(d.dipendente_id))} anno={anno} onClose={() => setIniziali(false)} onSalvato={() => { setIniziali(false); reload(); }} />}
    </>
  );
}

function ModaleRettifica({ righe, anno, tipo: t0, dip, onClose, onSalvato }: { righe: SaldiDipendente[]; anno: number; tipo: string; dip?: number; onClose: () => void; onSalvato: () => void }) {
  const [f, setF] = useState({ dip: dip ? String(dip) : '', tipo: t0, segno: 1, q: '', ore: '', min: '0', motivo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const d = righe.find(x => String(x.dipendente_id) === f.dip);
  const s = d?.saldi.find(x => x.tipo === f.tipo);
  const ore = f.tipo !== 'FERIE';
  const quant = ore ? (Number(f.ore || 0) + Number(f.min) / 60) : Number(f.q.replace(',', '.'));
  const valida = quant > 0 && f.motivo.trim().length >= 5 && !!d;
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const x = await rpc<{ saldo: Saldo }>('hr_rettifica_saldo', { p_dipendente: Number(f.dip), p_anno: anno, p_tipo: f.tipo, p_quantita: f.segno * Math.round(quant * 100) / 100, p_motivo: f.motivo.trim() });
      toast(`Rettifica salvata. Saldo di ${d!.nome}: ${fmtQ(x.saldo.saldo, x.saldo.unita)}.`); onSalvato();
    } catch (x) { setErr(erroreHR(x)); setInvio(false); }
  }
  return (
    <Modal titolo="Rettifica un saldo" onClose={onClose}>
      <form className="form grid2" onSubmit={salva}>
        <div className="field span2"><label htmlFor="r-dip">Dipendente</label>
          <select id="r-dip" required value={f.dip} onChange={e => setF({ ...f, dip: e.target.value })}><option value="">Scegli…</option>
            {righe.filter(x => x.attivo).map(x => <option key={x.dipendente_id} value={x.dipendente_id}>{x.nome} · {x.codice}</option>)}</select></div>
        <div className="field"><label htmlFor="r-tipo">Cosa</label>
          <select id="r-tipo" value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}>{TIPI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><span className="lbl-sm">Operazione</span>
          <div className="segmented" role="group" aria-label="Operazione"><button type="button" className={f.segno === 1 ? 'on' : ''} onClick={() => setF({ ...f, segno: 1 })}>Aggiungi</button>
            <button type="button" className={f.segno === -1 ? 'on' : ''} onClick={() => setF({ ...f, segno: -1 })}>Togli</button></div></div>
        {ore ? <div className="row-flex span2">
          <div className="field"><label htmlFor="r-ore">Ore</label><input id="r-ore" inputMode="numeric" value={f.ore} onChange={e => setF({ ...f, ore: e.target.value.replace(/\D/g, '') })} style={{ width: 110 }} /></div>
          <div className="field"><label htmlFor="r-min">Minuti</label><select id="r-min" value={f.min} onChange={e => setF({ ...f, min: e.target.value })}>{['0', '15', '30', '45'].map(x => <option key={x}>{x}</option>)}</select></div>
        </div> : <div className="field span2"><label htmlFor="r-q">Giorni (anche mezzi: 0,5)</label><input id="r-q" inputMode="decimal" value={f.q} onChange={e => setF({ ...f, q: e.target.value.replace(/[^0-9.,]/g, '') })} style={{ maxWidth: 160 }} /></div>}
        <div className="field span2"><label htmlFor="r-mot">Motivo (obbligatorio)</label><input id="r-mot" required value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} placeholder="Es. Saldo iniziale, Correzione errore, Giorno di recupero" /></div>
        {s && quant > 0 && <div className="span2 ph-msg info" aria-live="polite">Il saldo {anno} di {d!.nome} passa da <b>{num(s.saldo)}</b> a <b>{num(s.saldo + f.segno * quant)} {ore ? 'ore' : 'giorni'}</b>.</div>}
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn" disabled={!valida || invio}>{invio ? 'Salvataggio…' : 'Salva rettifica'}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

interface Mov { data: string; cosa: string; q: number | null }
function ModaleMovimenti({ d, anno, tipo, onClose, onRettifica }: { d: SaldiDipendente; anno: number; tipo: string; onClose: () => void; onRettifica: () => void }) {
  const s = d.saldi.find(x => x.tipo === tipo)!;
  const { data, errore } = useLoad(async () => {
    const [r, x] = await Promise.all([
      rpc<Richiesta[]>('hr_richieste', { p_stato: 'approvata', p_da: `${anno}-01-01`, p_a: `${anno}-12-31`, p_dipendente: d.dipendente_id }),
      supabase.from('rettifiche_saldo').select('creato_il,quantita,motivo').eq('dipendente_id', d.dipendente_id).eq('anno', anno).eq('tipo', tipo),
    ]);
    const l: Mov[] = [];
    if (s.origine !== 'da_inizio_anno') l.push({ data: s.data_riferimento ?? `${anno}-01-01`, cosa: s.origine === 'saldo_iniziale' ? 'Saldo di partenza' : 'Riporto dall\'anno scorso', q: s.saldo_iniziale });
    l.push({ data: s.alla_data, cosa: `Maturazione: ${s.mesi_maturati} mesi × ${num(s.quota_mensile)}${s.fattore_part_time < 1 ? ` (part-time ${Math.round(s.fattore_part_time * 100)}%)` : ''}`, q: s.maturato });
    r.filter(y => y.tipo === tipo).forEach(y => { const qa = y.per_anno?.find(p => p.anno === anno)?.quantita ?? y.quantita; l.push({ data: y.primo_giorno, cosa: `${nomeTipo(y.tipo_descrizione)} (richiesta ${y.numero})`, q: -qa }); });
    (x.data ?? []).forEach((y: { creato_il: string; quantita: number; motivo: string }) => l.push({ data: y.creato_il.slice(0, 10), cosa: `Rettifica: ${y.motivo}`, q: Number(y.quantita) }));
    return l.sort((a, b) => a.data.localeCompare(b.data));
  }, [d.dipendente_id, anno, tipo]);
  return (
    <Modal titolo={`Movimenti di ${d.nome}`} onClose={onClose}>
      <div className="form">
        <p className="sub" style={{ marginTop: -8 }}>{nomeTipo(s.descrizione)} · {anno} · valori in {s.unita}</p>
        {errore && <Banner s="ko">{errore}</Banner>}
        {!data ? <p className="sub">Caricamento…</p> : <div className="table-wrap"><table className="rep-tab">
          <thead><tr><th>Data</th><th>Cosa</th><th className="num-c">Quantità</th></tr></thead>
          <tbody>{data.map((x, i) => <tr key={i}><td className="mono">{testoQuando(x.data).slice(0, 5)}</td><td>{x.cosa}</td><td className="num-c mono">{x.q != null && x.q > 0 ? '+' : ''}{num(x.q)}</td></tr>)}
            <tr className="hr-tot"><td></td><td><b>Saldo</b>{s.in_attesa ? <span className="sub"> · in valutazione {num(s.in_attesa)}</span> : null}</td><td className="num-c mono"><b>{num(s.saldo)}</b></td></tr></tbody>
        </table></div>}
        <div className="row-flex"><button className="btn" onClick={onRettifica}>Rettifica questo saldo</button></div>
      </div>
    </Modal>
  );
}

/** Primo avvio: saldo residuo alla data dell'ultimo cedolino, per ogni persona. */
function ModaleIniziali({ righe, anno, onClose, onSalvato }: { righe: SaldiDipendente[]; anno: number; onClose: () => void; onSalvato: () => void }) {
  const [data, setData] = useState(oggiISO().slice(0, 4) === String(anno) ? oggiISO() : `${anno}-01-01`);
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva() {
    setErr(null); setInvio(true);
    const rec = righe.flatMap(d => TIPI.map(([t]) => ({ k: `${d.dipendente_id}-${t}`, d, t })).filter(x => (v[x.k] ?? '').trim() !== '')
      .map(x => ({ dipendente_id: x.d.dipendente_id, anno, tipo: x.t, data_riferimento: data, residuo: Number(v[x.k].replace(',', '.')), goduto_anno: 0, fonte: 'Inserimento ufficio personale' })));
    if (!rec.length) { setErr('Scrivi almeno un valore.'); setInvio(false); return; }
    if (rec.some(r => Number.isNaN(r.residuo))) { setErr('Controlla i numeri: usa solo cifre e la virgola.'); setInvio(false); return; }
    const { error } = await supabase.from('saldi_iniziali').insert(rec);
    if (error) { setErr(erroreHR(error)); setInvio(false); return; }
    toast(`Saldi di partenza salvati per ${new Set(rec.map(r => r.dipendente_id)).size} dipendenti.`); onSalvato();
  }
  return (
    <Modal titolo="Saldi di partenza" onClose={onClose}>
      <div className="form">
        <p className="sub" style={{ marginTop: -8 }}>Scrivi quanto resta a ciascuno alla data dell'ultimo cedolino. Da quella data il sistema calcola da solo maturazioni e assenze.</p>
        <div className="field"><label htmlFor="si-data">Saldo al giorno</label><input id="si-data" type="date" min={`${anno}-01-01`} max={`${anno}-12-31`} value={data} onChange={e => setData(e.target.value)} style={{ maxWidth: 200 }} /></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Dipendente</th><th className="num-c">Ferie (giorni)</th><th className="num-c">ROL (ore)</th><th className="num-c">Ex festività (ore)</th></tr></thead>
          <tbody>{righe.map(d => <tr key={d.dipendente_id}><td>{d.nome}</td>{TIPI.map(([t]) => (
            <td key={t} className="num-c"><input className="hr-num-in" inputMode="decimal" aria-label={`${t} ${d.nome}`} value={v[`${d.dipendente_id}-${t}`] ?? ''} onChange={e => setV({ ...v, [`${d.dipendente_id}-${t}`]: e.target.value.replace(/[^0-9.,-]/g, '') })} /></td>))}</tr>)}</tbody>
        </table></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={salva} disabled={invio}>{invio ? 'Salvataggio…' : 'Salva tutti'}</button><button className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </div>
    </Modal>
  );
}
