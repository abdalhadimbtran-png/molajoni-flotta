import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Errore, Modal, Banner, toast, useLoad } from '../ui';
import { ESITI, NOME_TIPO, STATI_CLIENTE, type Pratica, type StatoCliente, type Trasferimento } from '../lib/centralino/tipi';
import { CAMPI_PRATICA, useAdesso, useConfig } from './comune';
import { Ic, SlaChip, nomeStadio, regolaDi } from './componenti';
import { RigaTrasf } from './Trasferimento';
import { Scheletro } from './Scheletro';
import { useCtx } from './ShellCentralino';

interface Sugg { codice: string | null; nome: string; sedi?: number; fonte: 'taylor' | 'pratiche'; stato_cliente?: StatoCliente | null; telefono?: string | null; comune?: string | null }
interface Contatto { id: number; contatto_nome: string | null; ruolo: string | null; telefono: string | null; cellulare: string | null; email: string | null; preferito: boolean; sede: string | null; note: string | null; aggiornato_at: string; fonte: string }
interface Sede { impianto: string; indirizzo: string; cap: string | null; comune: string | null }
interface Cliente { cod_cliente: string; nome: string; indirizzo: string | null; cap: string | null; comune: string | null; prov: string | null; telefono: string | null; cellulare: string | null; email: string | null; pec: string | null; referente: string | null; stato_cliente: StatoCliente | null; aggiornato_at: string }

/** Clienti: ricerca, scheda con contatti, sedi, storico pratiche e chiamate, «Nuovo contatto per questo cliente». */
export default function Clienti() {
  const ctx = useCtx();
  const [qs, setQs] = useSearchParams();
  const [q, setQ] = useState(qs.get('q') ?? '');
  const [sugg, setSugg] = useState<Sugg[] | null>(null);
  const cod = qs.get('cod'), nome = qs.get('nome');
  useEffect(() => {
    if (q.trim().length < 2) { setSugg(null); return; }
    const k = window.setTimeout(() => rpc<Sugg[]>('centralino_clienti', { p_q: q }).then(setSugg, () => setSugg([])), 220);
    return () => window.clearTimeout(k);
  }, [q]);
  const apri = (s: Sugg) => setQs({ ...(s.codice ? { cod: s.codice } : {}), nome: s.nome, q });
  return (
    <div className="ct-clienti">
      <div className="page-hero"><div><h1>Clienti</h1><p className="sub">Cerca per nome, codice Taylor, telefono o email.</p></div></div>
      <div className="ct-clienti-g">
        <section className="ct-split-l">
          <div className="ct-split-h"><input type="search" autoFocus aria-label="Cerca cliente" placeholder="Nome, codice, telefono…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <ul className="ct-split-lista">
            {(sugg ?? []).map((s, i) => (
              <li key={i}><button className={`ct-split-i ${(s.codice && s.codice === cod) || (!s.codice && s.nome === nome) ? 'sel' : ''}`} onClick={() => apri(s)}>
                <span className="ct-split-ic"><Ic n="collega" size={16} /></span>
                <span className="ct-split-c"><span className="ct-split-r1"><b>{s.nome}</b>{s.stato_cliente && <span className={`ct-mini ${s.stato_cliente}`}>{STATI_CLIENTE[s.stato_cliente][1]}</span>}</span>
                  <span className="sub">{[s.codice && `Cod. ${s.codice}`, s.sedi ? `${s.sedi} sedi` : null, s.comune, s.telefono].filter(Boolean).join(' · ') || 'già contattato'}</span></span>
              </button></li>))}
            {sugg && !sugg.length && <li className="ct-vuoto">Nessun cliente trovato.{ctx.scrive && <> <button className="ct-link" onClick={() => ctx.nuovo({ codice: null, nome: q.trim() })}>Nuovo contatto per «{q.trim()}»</button></>}</li>}
            {!sugg && <li className="ct-vuoto">Scrivi almeno 2 lettere.</li>}
          </ul>
        </section>
        <section className="ct-split-r">{nome ? <Scheda cod={cod} nome={nome} /> : <div className="ct-split-vuoto"><Ic n="collega" size={28} /><p>Cerca un cliente a sinistra.</p></div>}</section>
      </div>
    </div>
  );
}

function Scheda({ cod, nome }: { cod: string | null; nome: string }) {
  const ctx = useCtx();
  const ora = useAdesso();
  const { config } = useConfig();
  const [modC, setModC] = useState<Contatto | 'nuovo' | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const pr = cod ? supabase.from('pratiche').select(CAMPI_PRATICA).eq('cliente_codice', cod) : supabase.from('pratiche').select(CAMPI_PRATICA).ilike('cliente_nome', nome);
    const tr = cod ? supabase.from('chiamate_trasferite').select('*').eq('cliente_codice', cod) : supabase.from('chiamate_trasferite').select('*').ilike('cliente_nome', nome);
    const [c, k, s, p, t] = await Promise.all([
      cod ? supabase.from('clienti').select('*').eq('cod_cliente', cod).maybeSingle() : Promise.resolve({ data: null, error: null }),
      rpc<Contatto[]>('centralino_contatti', { p_codice: cod, p_nome: nome }),
      cod ? rpc<Sede[]>('centralino_sedi', { p_codice: cod }) : Promise.resolve([] as Sede[]),
      pr.order('created_at', { ascending: false }).limit(200), tr.order('at', { ascending: false }).limit(100),
    ]);
    if (p.error || t.error) throw p.error || t.error;
    return { cliente: c.data as Cliente | null, contatti: k, sedi: s, pratiche: (p.data ?? []) as Pratica[], trasf: (t.data ?? []) as Trasferimento[] };
  }, [cod, nome, ctx.versione]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Scheletro righe={8} />;
  const c = data.cliente;
  const stato = c?.stato_cliente ?? data.pratiche[0]?.stato_cliente ?? null;
  const fl = (t: string) => config?.flussi.find(f => f.tipo === t);
  return (
    <div className="ct-scheda">
      <header className="ct-testa">
        <span className="ct-testa-ic"><Ic n="collega" size={24} /></span>
        <div className="ct-testa-c">
          <div className="ct-testa-r">{cod && <span className="ct-num">Cod. {cod}</span>}{stato && <span className={`pill ${STATI_CLIENTE[stato][0]}`}>{STATI_CLIENTE[stato][1]}</span>}</div>
          <h1>{c?.nome ?? nome}</h1>
          <div className="sub">{[c?.indirizzo, [c?.cap, c?.comune, c?.prov && `(${c.prov})`].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Indirizzo non in anagrafica'}{c?.pec ? ` · PEC ${c.pec}` : ''}</div>
        </div>
        {ctx.scrive && <button className="btn" onClick={() => ctx.nuovo({ codice: cod, nome: c?.nome ?? nome, fonte: cod ? 'taylor' : 'pratiche' })}><Ic n="piu" size={18} /> Nuovo contatto per questo cliente</button>}
      </header>
      <div className="ct-dett">
        <div>
          <section className="ct-blocco"><h2>Pratiche <span className="ct-n">{data.pratiche.length}</span></h2>
            {data.pratiche.length ? <ul className="ct-split-lista">{data.pratiche.map(p => (
              <li key={p.id}><Link to={`${ctx.base}/pratica/${p.id}`} className="ct-split-i">
                <span className="ct-split-c"><span className="ct-split-r1"><b>{NOME_TIPO[p.tipo]}{p.sottotipo ? ` · ${p.sottotipo}` : ''}</b>{p.esito === 'aperta' ? <SlaChip p={p} ora={ora} regola={regolaDi(fl(p.tipo), p)} /> : <span className={`pill ${ESITI[p.esito][0]}`}>{ESITI[p.esito][1]}</span>}</span>
                  <span className="sub">{p.numero} · {fmtOra(p.created_at)} · {nomeStadio(fl(p.tipo), p.stato_corrente)}</span></span></Link></li>))}</ul> : <p className="ct-vuoto">Nessuna pratica per questo cliente.</p>}
          </section>
          {data.trasf.length > 0 && <section className="ct-blocco"><h2>Chiamate per responsabili</h2>{data.trasf.map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} />)}</section>}
        </div>
        <aside>
          <section className="ct-blocco"><div className="ct-blocco-h"><h2>Contatti</h2>{ctx.scrive && <button className="btn-ghost btn-sm" onClick={() => setModC('nuovo')}>Aggiungi</button>}</div>
            {data.contatti.length ? data.contatti.map(k => (
              <div key={k.id} className={`ct-contatto ${ctx.scrive ? 'ct-clic' : ''}`} onClick={() => ctx.scrive && setModC(k)}>
                <b>{k.contatto_nome || 'Senza nome'}</b>{k.preferito && <span className="ct-mini attivo">preferito</span>}{k.ruolo && <span className="sub"> · {k.ruolo}</span>}
                <div className="sub">{[k.telefono, k.cellulare, k.email].filter(Boolean).join(' · ') || '—'}</div>
                {k.note && <div className="sub">{k.note}</div>}
              </div>)) : <p className="ct-vuoto">Nessun contatto in rubrica.{c?.telefono || c?.email ? ` Da Taylor: ${[c?.telefono, c?.cellulare, c?.email].filter(Boolean).join(' · ')}` : ''}</p>}
          </section>
          <section className="ct-blocco"><h2>Sedi / impianti <span className="ct-n">{data.sedi.length}</span></h2>
            {data.sedi.length ? <ul className="ct-sedi">{data.sedi.slice(0, 100).map(s => <li key={s.impianto}><b>{s.indirizzo || '—'}</b><span className="sub"> · {[s.cap, s.comune].filter(Boolean).join(' ')} · imp. {s.impianto}</span></li>)}</ul>
              : <p className="ct-vuoto">Nessuna sede negli interventi importati.</p>}
          </section>
        </aside>
      </div>
      {modC && <ModaleContatto k={modC === 'nuovo' ? null : modC} cod={cod} nome={c?.nome ?? nome} onClose={() => setModC(null)} onFatto={() => { setModC(null); reload(); }} />}
    </div>
  );
}

function ModaleContatto({ k, cod, nome, onClose, onFatto }: { k: Contatto | null; cod: string | null; nome: string; onClose: () => void; onFatto: () => void }) {
  const [f, setF] = useState({ contatto_nome: k?.contatto_nome ?? '', ruolo: k?.ruolo ?? '', telefono: k?.telefono ?? '', cellulare: k?.cellulare ?? '', email: k?.email ?? '', preferito: k?.preferito ?? false, note: k?.note ?? '', motivo: '' });
  const [err, setErr] = useState<string | null>(null);
  async function salva(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await rpc('centralino_salva_contatto', { p: { ...(k ? { id: k.id } : { cod_cliente: cod, cliente_nome: nome }), ...f, motivo: f.motivo || (k ? 'Modifica dalla scheda cliente' : 'Nuovo contatto') } }); toast('Contatto salvato'); onFatto(); }
    catch (x) { setErr(testoErrore(x)); }
  }
  return (
    <Modal titolo={k ? 'Modifica contatto' : 'Nuovo contatto in rubrica'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="kc-n">Nome</label><input id="kc-n" value={f.contatto_nome} onChange={e => setF({ ...f, contatto_nome: e.target.value })} /></div>
          <div className="field"><label htmlFor="kc-r">Ruolo</label><select id="kc-r" value={f.ruolo} onChange={e => setF({ ...f, ruolo: e.target.value })}><option value="">—</option>{['Amministratore', 'Portiere', 'Titolare', 'Ufficio tecnico', 'Amministrazione', 'Referente sede', 'Altro'].map(x => <option key={x}>{x}</option>)}{f.ruolo && !['Amministratore', 'Portiere', 'Titolare', 'Ufficio tecnico', 'Amministrazione', 'Referente sede', 'Altro'].includes(f.ruolo) && <option>{f.ruolo}</option>}</select></div>
          <div className="field"><label htmlFor="kc-t">Telefono</label><input id="kc-t" type="tel" value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} /></div>
          <div className="field"><label htmlFor="kc-c">Cellulare</label><input id="kc-c" type="tel" value={f.cellulare} onChange={e => setF({ ...f, cellulare: e.target.value })} /></div>
          <div className="field"><label htmlFor="kc-e">Email</label><input id="kc-e" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.preferito} onChange={e => setF({ ...f, preferito: e.target.checked })} /> Contatto preferito (proposto per primo)</label>
        <div className="field"><label htmlFor="kc-no">Nota</label><input id="kc-no" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        {k && <div className="field"><label htmlFor="kc-m">Motivo della modifica</label><input id="kc-m" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })} placeholder="es. il cliente ha cambiato numero" /></div>}
        <p className="hint">Solo dati di contatto aziendali. Ogni modifica resta nella storia e conta come aggiornamento anagrafica.</p>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
