import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Caricamento, Errore, Pill, useLoad } from '../ui';
import { CANALI, ESITI, NOME_TIPO, STATI_CLIENTE, type Pratica } from '../lib/centralino/tipi';
import { CAMPI_PRATICA, useAdesso, useConfig } from './comune';
import { SlaChip, nomeStadio } from './componenti';
import { useCtx } from './ShellCentralino';

/** Tutte le pratiche del periodo, con filtri. */
export default function Pratiche() {
  const ctx = useCtx();
  const ora = useAdesso();
  const { config } = useConfig();
  const oggi = new Date();
  const [da, setDa] = useState(new Date(oggi.getFullYear(), oggi.getMonth(), 1).toISOString().slice(0, 10));
  const [a, setA] = useState(oggi.toISOString().slice(0, 10));
  const [tipo, setTipo] = useState(''); const [esito, setEsito] = useState(''); const [canale, setCanale] = useState(''); const [q, setQ] = useState(''); const [stato, setStato] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('pratiche').select(CAMPI_PRATICA).gte('created_at', `${da}T00:00:00`).lte('created_at', `${a}T23:59:59`).order('created_at', { ascending: false }).limit(2000);
    if (error) throw error; return (data ?? []) as Pratica[];
  }, [da, a, ctx.versione]);
  const righe = useMemo(() => (data ?? []).filter(p => (!tipo || p.tipo === tipo) && (!esito || p.esito === esito) && (!canale || p.canale === canale) && (!stato || p.stato_cliente === stato)
    && (!q || `${p.numero} ${p.cliente_nome} ${p.contatto_nome ?? ''} ${p.telefono ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, tipo, esito, canale, stato, q]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Caricamento />;
  const fl = (t: string) => config.flussi.find(f => f.tipo === t);
  return (
    <>
      <div className="page-hero"><div><h1>Pratiche</h1><p className="sub">{righe.length} nel periodo</p></div></div>
      <div className="row-flex ct-filtri">
        <input type="date" aria-label="Dal" value={da} onChange={e => setDa(e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => setA(e.target.value)} />
        <select aria-label="Tipo" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Tutti i tipi</option>{Object.entries(NOME_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Esito" value={esito} onChange={e => setEsito(e.target.value)}><option value="">Aperte e chiuse</option>{Object.entries(ESITI).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        <select aria-label="Canale" value={canale} onChange={e => setCanale(e.target.value)}><option value="">Tutti i canali</option>{CANALI.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select>
        <select aria-label="Stato cliente" value={stato} onChange={e => setStato(e.target.value)}><option value="">Tutti i clienti</option>{Object.entries(STATI_CLIENTE).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        <input type="search" aria-label="Filtra" placeholder="Filtra…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Numero</th><th>Aperta</th><th>Cliente</th><th>Tipo</th><th>Stadio</th><th>SLA</th><th>Esito</th></tr></thead>
        <tbody>{righe.slice(0, 500).map(p => (
          <tr key={p.id}>
            <td><Link to={`${ctx.base}/pratica/${p.id}`} className="ct-num">{p.numero}</Link></td>
            <td>{fmtOra(p.created_at)}</td>
            <td><b>{p.cliente_nome}</b>{p.stato_cliente && <span className={`pill ${STATI_CLIENTE[p.stato_cliente][0]}`} style={{ marginInlineStart: 6 }}>{STATI_CLIENTE[p.stato_cliente][1]}</span>}</td>
            <td>{NOME_TIPO[p.tipo]}{p.sottotipo ? ` · ${p.sottotipo}` : ''}</td>
            <td>{nomeStadio(fl(p.tipo), p.stato_corrente)}</td>
            <td><SlaChip p={p} ora={ora} /></td>
            <td><Pill s={ESITI[p.esito][0] as 'ok'}>{ESITI[p.esito][1]}</Pill></td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}
