import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Errore, useLoad } from '../ui';
import { CANALI, ESITI, NOME_TIPO, STATI_CLIENTE, type Pratica } from '../lib/centralino/tipi';
import { CAMPI_PRATICA, useAdesso, useConfig } from './comune';
import { Ic, SlaChip, iconaTipo, nomeStadio, regolaDi } from './componenti';
import { Scheletro } from './Scheletro';
import DettaglioPratica from './Pratica';
import { useCtx } from './ShellCentralino';

type Vista = 'aperte' | 'oggi' | 'periodo';

/**
 * Pratiche in vista divisa: elenco a sinistra, scheda a destra (niente salti di pagina).
 * /centralino/pratiche e /centralino/pratica/:id usano questo stesso componente.
 */
export default function Pratiche() {
  const ctx = useCtx();
  const { id } = useParams();
  const ora = useAdesso();
  const { config } = useConfig();
  const oggi = new Date();
  const [vista, setVista] = useState<Vista>('aperte');
  const [da, setDa] = useState(new Date(oggi.getFullYear(), oggi.getMonth(), 1).toISOString().slice(0, 10));
  const [a, setA] = useState(oggi.toISOString().slice(0, 10));
  const [tipo, setTipo] = useState(''); const [esito, setEsito] = useState(''); const [canale, setCanale] = useState(''); const [q, setQ] = useState(''); const [stato, setStato] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    let x = supabase.from('pratiche').select(CAMPI_PRATICA);
    if (vista === 'aperte') x = x.eq('esito', 'aperta').order('sla_scadenza', { ascending: true, nullsFirst: false });
    else if (vista === 'oggi') x = x.gte('created_at', `${oggi.toISOString().slice(0, 10)}T00:00:00`).order('created_at', { ascending: false });
    else x = x.gte('created_at', `${da}T00:00:00`).lte('created_at', `${a}T23:59:59`).order('created_at', { ascending: false });
    const { data, error } = await x.limit(2000);
    if (error) throw error; return (data ?? []) as Pratica[];
  }, [vista, da, a, ctx.versione]);
  const righe = useMemo(() => (data ?? []).filter(p => (!tipo || p.tipo === tipo) && (!esito || p.esito === esito) && (!canale || p.canale === canale) && (!stato || p.stato_cliente === stato)
    && (!q || `${p.numero} ${p.cliente_nome} ${p.contatto_nome ?? ''} ${p.telefono ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, tipo, esito, canale, stato, q]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const fl = (t: string) => config?.flussi.find(f => f.tipo === t);
  return (
    <div className={`ct-split ${id ? 'con-dettaglio' : ''}`}>
      <section className="ct-split-l" aria-label="Elenco pratiche">
        <div className="ct-split-h">
          <div className="segmented" role="group" aria-label="Vista">
            {([['aperte', 'Aperte'], ['oggi', 'Di oggi'], ['periodo', 'Periodo']] as const).map(([v, l]) => <button key={v} className={vista === v ? 'on' : ''} onClick={() => setVista(v)}>{l}</button>)}
          </div>
          <input type="search" aria-label="Filtra" placeholder="Filtra per cliente, numero, telefono…" value={q} onChange={e => setQ(e.target.value)} />
          {vista === 'periodo' && <div className="ct-riga"><input type="date" aria-label="Dal" value={da} onChange={e => setDa(e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => setA(e.target.value)} /></div>}
          <div className="ct-split-f">
            <select aria-label="Tipo" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Tutti i tipi</option>{Object.entries(NOME_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Canale" value={canale} onChange={e => setCanale(e.target.value)}><option value="">Canali</option>{CANALI.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select>
            <select aria-label="Stato cliente" value={stato} onChange={e => setStato(e.target.value)}><option value="">Clienti</option>{Object.entries(STATI_CLIENTE).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
            {vista !== 'aperte' && <select aria-label="Stato" value={esito} onChange={e => setEsito(e.target.value)}><option value="">Stato</option>{Object.entries(ESITI).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>}
          </div>
          <span className="sub">{righe.length} pratiche</span>
        </div>
        {!data ? <Scheletro righe={10} /> : (
          <ul className="ct-split-lista">
            {righe.slice(0, 500).map(p => (
              <li key={p.id}>
                <Link to={`${ctx.base}/pratica/${p.id}`} className={`ct-split-i ${String(p.id) === id ? 'sel' : ''} ${p.priorita === 'urgente' ? 'urgente' : ''}`} aria-current={String(p.id) === id ? 'page' : undefined}>
                  <span className="ct-split-ic"><Ic n={iconaTipo(p.tipo)} size={16} /></span>
                  <span className="ct-split-c">
                    <span className="ct-split-r1"><b>{p.cliente_nome}</b>{p.esito === 'aperta' ? <SlaChip p={p} ora={ora} regola={regolaDi(fl(p.tipo), p)} /> : <span className={`pill ${ESITI[p.esito][0]}`}>{ESITI[p.esito][1]}</span>}</span>
                    <span className="sub">{p.numero} · {NOME_TIPO[p.tipo]} · {nomeStadio(fl(p.tipo), p.stato_corrente)} · {fmtOra(p.created_at)}</span>
                  </span>
                </Link>
              </li>))}
            {!righe.length && <li className="ct-vuoto">Nessuna pratica con questi filtri.</li>}
          </ul>)}
      </section>
      <section className="ct-split-r" aria-label="Scheda pratica">
        {id ? <DettaglioPratica key={id} /> : <div className="ct-split-vuoto"><Ic n="pratiche" size={28} /><p>Scegli una pratica dall'elenco.</p><p className="sub">Oppure premi <kbd>N</kbd> per un nuovo contatto.</p></div>}
      </section>
    </div>
  );
}
