import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { fmtData, oggiISO } from '../lib/format';
import { Banner, Caricamento, Errore, MenuAzioni, Modal, Pill, toast, useLoad } from '../ui';
import {
  CATEGORIE, SEL_DIP, fmtQ, fmtSaldo, nomeCategoria, nomeTipo, periodo, testoQuando, useHR,
  type Categoria, type Dipendente, type Richiesta, type SaldiDipendente,
} from './comune';
import { ModaleDettaglio, ModaleInserisci, PillStato, erroreHR } from './componenti';

const bloccato = (x: Dipendente) => !!x.bloccato_fino && new Date(x.bloccato_fino) > new Date();

/** Archivio unico del personale (tutte le categorie) e codici di accesso all'app. */
export default function Dipendenti() {
  const nav = useNavigate();
  const [cat, setCat] = useState<Categoria | ''>('');
  const [inattivi, setInattivi] = useState(false);
  const [cerca, setCerca] = useState('');
  const [modifica, setModifica] = useState<Dipendente | 'nuovo' | null>(null);
  const [pin, setPin] = useState<Dipendente | null>(null);
  const [scheda, setScheda] = useState<Dipendente | null>(null);
  const [vedi, setVedi] = useState<Dipendente | null>(null);
  const [assenza, setAssenza] = useState<Dipendente | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [d, s] = await Promise.all([
      supabase.from('dipendenti').select(SEL_DIP).order('cognome').order('nome'),
      rpc<SaldiDipendente[]>('hr_saldi', {}),
    ]);
    if (d.error) throw d.error;
    return { dip: (d.data ?? []) as Dipendente[], saldi: new Map(s.map(x => [x.dipendente_id, x.saldi.find(y => y.tipo === 'FERIE')?.saldo ?? null])) };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.dip.filter(x => (inattivi || x.attivo) && (!cat || x.categoria === cat)
    && (!cerca || `${x.nome} ${x.cognome} ${x.codice} ${x.reparto ?? ''}`.toLowerCase().includes(cerca.toLowerCase())));

  async function sblocca(x: Dipendente) {
    try { await rpc('hr_sblocca_accesso', { p_dipendente: x.id }); toast('Accesso sbloccato'); reload(); } catch (e) { toast(erroreHR(e)); }
  }

  return (
    <>
      <div className="page-hero">
        <div><h1>Dipendenti</h1><p className="sub">Un solo archivio per tutto il personale, con i codici di accesso all'app.</p></div>
        <button className="btn" onClick={() => setModifica('nuovo')}>Nuovo dipendente</button>
      </div>
      <div className="hr-barra">
        <div className="segmented" role="group" aria-label="Categoria">
          <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>Tutti</button>
          {CATEGORIE.map(([k, l]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{k === 'TEC' ? 'Tecnici' : l}</button>)}
        </div>
        <input className="hr-cerca-in" aria-label="Cerca" placeholder="Cerca nome, codice o reparto" value={cerca} onChange={e => setCerca(e.target.value)} />
        <label className="sub chk"><input type="checkbox" checked={inattivi} onChange={e => setInattivi(e.target.checked)} /> Mostra non attivi</label>
        <span className="spacer" /><span className="sub">{lista.length} {lista.length === 1 ? 'dipendente' : 'dipendenti'}</span>
      </div>
      <div className="table-wrap"><table className="hr-tab">
        <thead><tr><th>Dipendente</th><th>Codice</th><th>Categoria</th><th className="hr-c-rep">Reparto</th><th>Accesso app</th><th className="hr-c-fer num-c">Ferie</th><th></th></tr></thead>
        <tbody>{lista.length ? lista.map(x => {
          const s = data.saldi.get(x.id);
          return (
            <tr key={x.id} className={x.attivo ? '' : 'muted'}>
              <td><button className="hr-nome-btn" onClick={() => setVedi(x)}>{x.nome} {x.cognome}</button>
                <div className="sub">{[x.telefono, x.email].filter(Boolean).join(' · ') || '—'}{!x.attivo ? ' · non attivo' : x.data_cessazione ? ` · fine rapporto ${fmtData(x.data_cessazione)}` : ''}</div></td>
              <td className="mono">{x.codice}</td>
              <td><Pill s="na">{nomeCategoria(x.categoria)}</Pill></td>
              <td className="hr-c-rep">{x.reparto ?? '—'}</td>
              <td>{bloccato(x) ? <Pill s="ko">Bloccato</Pill> : x.ha_pin ? <Pill s="ok">PIN attivo</Pill> : <Pill s="warn">PIN da impostare</Pill>}</td>
              <td className={`hr-c-fer num-c mono ${s != null && s < 0 ? 'hr-neg' : ''}`}>{fmtSaldo(s, 'giorni')}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setModifica(x)}>Modifica</button>
                {x.attivo && <button className="btn btn-sm" onClick={() => setScheda(x)}>Scheda accesso + PIN</button>}
                <MenuAzioni label="Altro">
                  {x.attivo && <button onClick={() => setPin(x)}>{x.ha_pin ? 'Nuovo PIN' : 'Imposta PIN'}</button>}
                  {bloccato(x) && <button onClick={() => sblocca(x)}>Sblocca</button>}
                  <button onClick={() => setVedi(x)}>Vedi saldo e storico</button>
                  {x.attivo && <button onClick={() => setAssenza(x)}>Inserisci un'assenza</button>}
                </MenuAzioni>
              </td>
            </tr>
          );
        }) : <tr><td colSpan={7} className="sub">Nessun dipendente con questi filtri.</td></tr>}</tbody>
      </table></div>
      <p className="hint">Il codice (matricola) è quello che il dipendente digita nell'app insieme al PIN. I dipendenti non si cancellano: si chiude il rapporto con la data di fine.</p>

      {modifica && <FormDipendente x={modifica === 'nuovo' ? null : modifica} onClose={() => setModifica(null)} onSalvato={(nuovo) => { setModifica(null); reload(); if (nuovo) setScheda(nuovo); }} />}
      {pin && <ModalePin x={pin} onClose={() => setPin(null)} onSalvato={() => { setPin(null); reload(); }} />}
      {scheda && <ModaleScheda x={scheda} onClose={() => setScheda(null)} onPin={pin => nav('/hr/installa', { state: { dipendente: { nome: scheda.nome, cognome: scheda.cognome, codice: scheda.codice, email: scheda.email, categoria: scheda.categoria }, pin } })} />}
      {vedi && <SchedaDipendente x={vedi} onClose={() => setVedi(null)} onModifica={() => { setModifica(vedi); setVedi(null); }} />}
      {assenza && <ModaleInserisci preDipendente={assenza.id} onClose={() => setAssenza(null)} onSalvato={() => { setAssenza(null); reload(); }} />}
    </>
  );
}

const GIORNI = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
const NOMI_G = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

function FormDipendente({ x, onClose, onSalvato }: { x: Dipendente | null; onClose: () => void; onSalvato: (nuovo: Dipendente | null) => void }) {
  const [f, setF] = useState({
    nome: x?.nome ?? '', cognome: x?.cognome ?? '', telefono: x?.telefono ?? '', email: x?.email ?? '',
    codice: x?.codice ?? '', categoria: (x?.categoria ?? 'UFFICIO') as Categoria, reparto: x?.reparto ?? '', ruolo: x?.ruolo ?? '',
    data_assunzione: x?.data_assunzione ?? '', contratto: x?.contratto ?? 'full-time', ore_giornaliere: String(x?.ore_giornaliere ?? 8),
    giorni_riposo: x?.giorni_riposo ?? '0000011', patente_categoria: x?.patente_categoria ?? 'B', patente_scadenza: x?.patente_scadenza ?? '',
    data_cessazione: x?.data_cessazione ?? '', attivo: x?.attivo ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [conferma, setConferma] = useState(false);
  const [invio, setInvio] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggleGiorno = (i: number) => {
    const g = f.giorni_riposo.split(''); g[i] = g[i] === '1' ? '0' : '1'; const n = g.join('');
    if (n !== '1111111') setF({ ...f, giorni_riposo: n });
  };
  const tec = f.categoria === 'TEC';
  const nuovaCessazione = !!f.data_cessazione && f.data_cessazione !== (x?.data_cessazione ?? '');

  async function salva() {
    setErr(null); setInvio(true);
    const rec = {
      nome: f.nome.trim(), cognome: f.cognome.trim(), telefono: f.telefono.trim() || null, email: f.email.trim().toLowerCase() || null,
      codice: f.codice.toUpperCase().replace(/[^A-Z0-9]/g, ''), categoria: f.categoria, reparto: f.reparto.trim() || null, ruolo: f.ruolo.trim() || null,
      data_assunzione: f.data_assunzione || null, contratto: f.contratto, ore_giornaliere: Number(String(f.ore_giornaliere).replace(',', '.')),
      giorni_riposo: f.giorni_riposo, patente_categoria: tec ? f.patente_categoria.trim() || null : x?.patente_categoria ?? null,
      patente_scadenza: tec ? f.patente_scadenza || null : x?.patente_scadenza ?? null,
      data_cessazione: f.data_cessazione || null, attivo: x ? f.attivo : true,
    };
    const r = x ? await supabase.from('dipendenti').update(rec).eq('id', x.id).select(SEL_DIP).single()
      : await supabase.from('dipendenti').insert(rec).select(SEL_DIP).single();
    setInvio(false);
    if (r.error) { setConferma(false); setErr(erroreHR(r.error)); return; }
    toast(x ? 'Dati salvati' : 'Dipendente aggiunto: ora crea la scheda di accesso con il PIN.');
    onSalvato(x ? null : (r.data as unknown as Dipendente));
  }
  function invia(e: FormEvent) { e.preventDefault(); if (nuovaCessazione) setConferma(true); else salva(); }

  if (conferma) return (
    <Modal titolo="Chiudere il rapporto?" onClose={() => setConferma(false)}>
      <div className="form">
        <p>Chiudere il rapporto di <b>{f.nome} {f.cognome}</b> dal {fmtData(f.data_cessazione)}? Dopo quella data non potrà più accedere. Lo storico resta.</p>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn brand" onClick={salva} disabled={invio}>{invio ? 'Salvataggio…' : 'Conferma'}</button>
          <button className="btn-ghost" autoFocus onClick={() => setConferma(false)}>Annulla</button></div>
      </div>
    </Modal>
  );
  return (
    <Modal titolo={x ? `Modifica ${x.nome} ${x.cognome}` : 'Nuovo dipendente'} onClose={onClose}>
      <form className="form grid2 hr-form" onSubmit={invia}>
        <div className="lbl-sm span2 hr-blocco">Dati personali</div>
        <div className="field"><label htmlFor="d-nome">Nome</label><input id="d-nome" required value={f.nome} onChange={set('nome')} /></div>
        <div className="field"><label htmlFor="d-cog">Cognome</label><input id="d-cog" required value={f.cognome} onChange={set('cognome')} /></div>
        <div className="field"><label htmlFor="d-tel">Telefono</label><input id="d-tel" type="tel" value={f.telefono} onChange={set('telefono')} /></div>
        <div className="field"><label htmlFor="d-mail">Email (per inviare la scheda di accesso)</label><input id="d-mail" type="email" value={f.email} onChange={set('email')} /></div>

        <div className="lbl-sm span2 hr-blocco">Lavoro</div>
        <div className="field"><label htmlFor="d-cod">Codice (matricola)</label><input id="d-cod" required className="mono" value={f.codice} onChange={set('codice')} placeholder="ROSSIM" /></div>
        <div className="field"><label htmlFor="d-cat">Categoria</label>
          <select id="d-cat" value={f.categoria} onChange={set('categoria')}>{CATEGORIE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {x?.categoria === 'TEC' && f.categoria !== 'TEC' && <div className="span2"><Banner s="warn">Non comparirà più nella pianificazione e non potrà prendere veicoli.</Banner></div>}
        <div className="field"><label htmlFor="d-rep">Reparto</label><input id="d-rep" value={f.reparto} onChange={set('reparto')} placeholder="Es. Amministrazione" /></div>
        <div className="field"><label htmlFor="d-ruolo">Mansione</label><input id="d-ruolo" value={f.ruolo} onChange={set('ruolo')} /></div>
        <div className="field"><label htmlFor="d-ass">Data di assunzione</label><input id="d-ass" type="date" value={f.data_assunzione} onChange={set('data_assunzione')} /></div>
        <div className="field"><label htmlFor="d-con">Contratto</label>
          <select id="d-con" value={f.contratto} onChange={set('contratto')}><option value="full-time">Tempo pieno</option><option value="part-time">Part-time</option></select></div>
        <div className="field"><label htmlFor="d-ore">Ore di lavoro al giorno</label><input id="d-ore" inputMode="decimal" required value={f.ore_giornaliere} onChange={set('ore_giornaliere')} /></div>
        <div className="field"><span className="lbl-sm">Giorni di riposo</span>
          <div className="hr-giorni" role="group" aria-label="Giorni di riposo">{GIORNI.map((g, i) => (
            <button type="button" key={i} className={f.giorni_riposo[i] === '1' ? 'on' : ''} aria-pressed={f.giorni_riposo[i] === '1'} aria-label={NOMI_G[i]} title={NOMI_G[i]} onClick={() => toggleGiorno(i)}>{g}</button>))}</div></div>

        {tec && <>
          <div className="lbl-sm span2 hr-blocco">Patente</div>
          <div className="field"><label htmlFor="d-pc">Categoria patente</label><input id="d-pc" value={f.patente_categoria} onChange={set('patente_categoria')} /></div>
          <div className="field"><label htmlFor="d-ps">Scadenza patente</label><input id="d-ps" type="date" value={f.patente_scadenza} onChange={set('patente_scadenza')} /></div>
        </>}

        {x && <>
          <div className="lbl-sm span2 hr-blocco">Rapporto</div>
          <div className="field"><label htmlFor="d-ces">Data di fine rapporto</label><input id="d-ces" type="date" min={f.data_assunzione || undefined} value={f.data_cessazione} onChange={set('data_cessazione')} /></div>
          <label className="chk" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.attivo} onChange={e => setF({ ...f, attivo: e.target.checked })} /> Attivo (può accedere all'app)</label>
        </>}
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn" disabled={invio}>{invio ? 'Salvataggio…' : 'Salva'}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function ModalePin({ x, onClose, onSalvato }: { x: Dipendente; onClose: () => void; onSalvato: () => void }) {
  const [pin, setPin] = useState('');
  const [salvato, setSalvato] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function salva() {
    setErr(null);
    try { await rpc('hr_imposta_pin', { p_dipendente: x.id, p_pin: pin }); setSalvato(true); } catch (e) { setErr(erroreHR(e)); }
  }
  async function genera() {
    setErr(null);
    try { setPin(await rpc<string>('hr_genera_pin', { p_dipendente: x.id })); setSalvato(true); } catch (e) { setErr(erroreHR(e)); }
  }
  return (
    <Modal titolo={`PIN per ${x.nome} ${x.cognome}`} onClose={salvato ? onSalvato : onClose}>
      <div className="form">
        {!salvato ? <>
          <div className="field"><label htmlFor="pin">Scrivi un PIN di 6 cifre</label>
            <input id="pin" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
          <p className="hint" style={{ marginTop: 0 }}>Evita cifre ripetute o in fila (es. 111111, 123456). Con un nuovo PIN il dipendente viene disconnesso da tutti i telefoni.</p>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" onClick={salva} disabled={pin.length !== 6}>Salva PIN</button>
            <button className="btn-ghost" onClick={genera}>Crea un PIN a caso</button></div>
        </> : <>
          <Banner s="ok">PIN salvato. Comunicalo a {x.nome} di persona: codice <b className="mono">{x.codice}</b>, PIN <b className="mono">{pin}</b>. Dopo la chiusura non sarà più visibile.</Banner>
          <button className="btn" onClick={onSalvato}>Fatto</button>
        </>}
      </div>
    </Modal>
  );
}

/** Genera un PIN nuovo (mai salvato in chiaro) e apre la scheda di accesso già compilata. */
function ModaleScheda({ x, onClose, onPin }: { x: Dipendente; onClose: () => void; onPin: (pin: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function genera() {
    setErr(null); setInvio(true);
    try { onPin(await rpc<string>('hr_genera_pin', { p_dipendente: x.id })); } catch (e) { setErr(erroreHR(e)); setInvio(false); }
  }
  return (
    <Modal titolo={`Scheda di accesso per ${x.nome} ${x.cognome}`} onClose={onClose}>
      <div className="form">
        <p>Il sistema crea un PIN nuovo e prepara la scheda con codice e PIN, da stampare o inviare per email.</p>
        {x.ha_pin && <Banner s="warn">Il PIN attuale smetterà di funzionare e {x.nome} dovrà accedere di nuovo su tutti i telefoni.</Banner>}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={genera} disabled={invio}>{invio ? 'Attendere…' : 'Genera PIN e apri la scheda'}</button>
          <button className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </div>
    </Modal>
  );
}

/** Saldi dell'anno e storico delle richieste del dipendente. */
function SchedaDipendente({ x, onClose, onModifica }: { x: Dipendente; onClose: () => void; onModifica: () => void }) {
  const { mioDipendente } = useHR();
  const anno = Number(oggiISO().slice(0, 4));
  const [det, setDet] = useState<number | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [s, r] = await Promise.all([
      rpc<SaldiDipendente[]>('hr_saldi', { p_anno: anno, p_dipendente: x.id }),
      rpc<Richiesta[]>('hr_richieste', { p_stato: null, p_dipendente: x.id }),
    ]);
    return { saldi: s[0]?.saldi ?? [], richieste: [...r].sort((a, b) => b.primo_giorno.localeCompare(a.primo_giorno)) };
  }, [x.id]);
  if (det) return <ModaleDettaglio id={det} mio={mioDipendente} onClose={() => setDet(null)} onCambiato={() => { setDet(null); reload(); }} />;
  return (
    <Modal titolo={`${x.nome} ${x.cognome}`} onClose={onClose}>
      <div className="form">
        <p className="sub" style={{ marginTop: -8 }}>{nomeCategoria(x.categoria)}{x.reparto ? ` · ${x.reparto}` : ''} · codice <span className="mono">{x.codice}</span>
          {x.data_assunzione ? ` · assunto il ${fmtData(x.data_assunzione)}` : ''} · {x.contratto === 'part-time' ? 'part-time' : 'tempo pieno'}, {String(x.ore_giornaliere).replace('.', ',')} ore al giorno</p>
        {errore && <Errore testo={errore} onRetry={reload} />}
        {!data ? <p className="sub">Caricamento…</p> : <>
          <div className="lbl-sm">Saldi {anno}</div>
          {data.saldi.length ? <div className="mini-stat hr-mini">{data.saldi.map(s => (
            <span key={s.tipo}>{nomeTipo(s.descrizione)} <b className={s.saldo < 0 ? 'hr-neg' : ''}>{fmtSaldo(s.saldo, s.unita)}</b></span>))}</div>
            : <p className="sub">Saldi non disponibili.</p>}
          <div className="lbl-sm">Richieste</div>
          {data.richieste.length ? <div className="table-wrap"><table>
            <thead><tr><th>Tipo</th><th>Periodo</th><th>Quantità</th><th>Stato</th></tr></thead>
            <tbody>{data.richieste.map(r => (
              <tr key={r.id} className="hr-click" onClick={() => setDet(r.id)}><td>{nomeTipo(r.tipo_descrizione)}<div className="sub">{r.numero} · {testoQuando(r.creato_il.slice(0, 10))}</div></td>
                <td>{periodo(r)}</td><td>{fmtQ(r.quantita, r.unita)}</td><td><PillStato stato={r.stato} /></td></tr>))}</tbody>
          </table></div> : <p className="sub">Nessuna richiesta.</p>}
        </>}
        <div className="row-flex"><button className="btn-ghost" onClick={onModifica}>Modifica dati</button></div>
      </div>
    </Modal>
  );
}
