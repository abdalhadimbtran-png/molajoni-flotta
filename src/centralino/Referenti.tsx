import { FormEvent, useState } from 'react';
import { rpc, supabase } from '../lib/supabase';
import { Banner, Errore, Modal, toast, useLoad } from '../ui';
import { config as ricaricaConfig } from './comune';
import { Scheletro } from './Scheletro';
import { useCtx } from './ShellCentralino';
import { useSalva } from '../lib/salva';

export const RESPONSABILITA: { k: string; l: string; d: string }[] = [
  { k: 'offerte_grandi', l: 'Offerte del Tecnico Commerciale', d: 'Ricevono le offerte passate dal centralino (chi è disponibile) e sono in copia nelle prese in carico' },
  { k: 'offerte_piccole', l: 'Offerte gestite dal centralino', d: 'Le prepara e invia il centralino' },
  { k: 'sopralluoghi', l: 'Sopralluoghi', d: 'Tecnici commerciali che fanno il sopralluogo (in copia alla conferma)' },
  { k: 'amministrazione', l: 'Fatture / amministrazione', d: 'Tasto 2 del risponditore; al pomeriggio sul cellulare' },
  { k: 'fornitori', l: 'Fornitori', d: 'Tasto 3 del risponditore; lunedì e venerdì' },
  { k: 'interventi', l: 'Interventi / tecnici', d: 'Manutenzione via Taylor con alert e Documento di Intervento' },
  { k: 'sostituto', l: 'Sostituto del centralino', d: 'Copre il centralino quando l\'operatrice è assente' },
  { k: 'formazione', l: 'Formazione', d: 'Attestati e corsi del personale' },
  { k: 'flotta', l: 'Flotta', d: 'Automezzi' },
];
const nomeR = (k: string) => RESPONSABILITA.find(r => r.k === k)?.l ?? k;
interface Referente { id: number; nome: string; ruolo: string | null; email: string | null; telefono: string | null; cellulare: string | null; attivo: boolean; responsabilita: string[]; note: string | null; ordine: number; coordina_interventi?: boolean; coordina_sopralluoghi?: boolean }
interface Avvisi { senza_email: { nome: string; responsabilita: string[] }[]; scoperte: string[] }

/**
 * «Referenti e responsabilità»: unica fonte per trasferimenti, assegnazioni, copie, disponibilità e modelli.
 * Le vecchie impostazioni (commerciali, destinatari, sostituto…) si aggiornano da sole da qui.
 */
export default function Referenti() {
  const ctx = useCtx();
  const { data, errore, reload } = useLoad(async () => {
    const [r, a] = await Promise.all([supabase.from('referenti').select('*').order('ordine').order('nome'), rpc<Avvisi>('centralino_referenti_avvisi', {})]);
    if (r.error) throw r.error; return { lista: (r.data ?? []) as Referente[], avvisi: a };
  });
  const [mod, setMod] = useState<Referente | 'nuovo' | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Scheletro righe={8} />;
  const fatto = () => { setMod(null); reload(); ricaricaConfig(true); };
  return (
    <>
      <div className="page-hero"><div><h1>Referenti e responsabilità</h1><p className="sub">Chi fa cosa. Trasferimenti, assegnazioni, copie conoscenza, disponibilità e modelli email leggono da qui.</p></div>
        {ctx.scrive && <button className="btn" onClick={() => setMod('nuovo')}>Aggiungi referente</button>}</div>
      {(data.avvisi.senza_email.length > 0 || data.avvisi.scoperte.length > 0) && (
        <div className="ct-avvisi">
          {data.avvisi.senza_email.map(x => <div key={x.nome} className="ct-avviso warn"><b>{x.nome}</b> non ha l'email: niente email al referente né campanella per {x.responsabilita.map(nomeR).join(', ')}.</div>)}
          {data.avvisi.scoperte.length > 0 && <div className="ct-avviso">Nessun referente per: {data.avvisi.scoperte.map(nomeR).join(', ')}.</div>}
        </div>)}
      <div className="table-wrap"><table className="ct-tab ct-ref">
        <thead><tr><th>Nome</th><th>Ruolo</th><th>Contatti</th>{RESPONSABILITA.map(r => <th key={r.k} title={r.d} className="ct-ref-r">{r.l}</th>)}<th className="ct-ref-r">Coord. interventi</th><th className="ct-ref-r">Coord. sopralluoghi</th><th>Attivo</th></tr></thead>
        <tbody>{data.lista.map(p => (
          <tr key={p.id} className={`${p.attivo ? '' : 'ct-spento'} ${ctx.scrive ? 'ct-clic' : ''}`} onClick={() => ctx.scrive && setMod(p)}>
            <td><b>{p.nome}</b>{p.note && <div className="sub">{p.note}</div>}</td>
            <td>{p.ruolo ?? '—'}</td>
            <td>{p.email ? <span>{p.email}</span> : <span className="ct-err-email">email mancante</span>}{(p.cellulare || p.telefono) && <div className="sub">{[p.telefono, p.cellulare].filter(Boolean).join(' · ')}</div>}</td>
            {RESPONSABILITA.map(r => <td key={r.k} className="ct-ref-r">{p.responsabilita.includes(r.k) ? <span className="ct-spunta" aria-label="sì">●</span> : ''}</td>)}
            {([p.coordina_interventi, p.coordina_sopralluoghi]).map((v, i) => <td key={`c${i}`} className="ct-ref-r">{v ? <span className="ct-spunta" aria-label="sì">●</span> : ''}</td>)}
            <td>{p.attivo ? 'Sì' : 'No'}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="hint">L'email collega anche l'account del portale (per la campanella e per segnare «Richiamato»). La disponibilità disponibile/occupato si imposta in «Richiami».</p>
      {mod && <Modale r={mod === 'nuovo' ? null : mod} onClose={() => setMod(null)} onFatto={fatto} />}
    </>
  );
}

function Modale({ r, onClose, onFatto }: { r: Referente | null; onClose: () => void; onFatto: () => void }) {
  const [f, setF] = useState({ nome: r?.nome ?? '', ruolo: r?.ruolo ?? '', email: r?.email ?? '', telefono: r?.telefono ?? '', cellulare: r?.cellulare ?? '', note: r?.note ?? '', attivo: r?.attivo ?? true, responsabilita: r?.responsabilita ?? [], ordine: r?.ordine ?? 100, coordina_interventi: !!r?.coordina_interventi, coordina_sopralluoghi: !!r?.coordina_sopralluoghi });
  const [err, setErr] = useState<string | null>(null);
  const { salva: esegui, inCorso } = useSalva();
  const tog = (k: string) => setF({ ...f, responsabilita: f.responsabilita.includes(k) ? f.responsabilita.filter(x => x !== k) : [...f.responsabilita, k] });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const email = f.email.trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Email non valida.'); return; }
    const riga = { ...f, nome: f.nome.trim(), email: email || null, ruolo: f.ruolo.trim() || null, telefono: f.telefono.trim() || null, cellulare: f.cellulare.trim() || null, note: f.note.trim() || null };
    // modifica idempotente: un nuovo tentativo se cade la rete; il nuovo inserimento no (evita doppioni)
    const esito = await esegui(async () => {
      const x = r ? await supabase.from('referenti').update(riga).eq('id', r.id) : await supabase.from('referenti').insert(riga);
      if (x.error) throw x.error;
    }, { riprova: !!r });
    if (esito.duplicato) return;
    if (!esito.ok) { setErr(esito.messaggio); return; }
    toast('Referente salvato'); onFatto();
  }
  return (
    <Modal titolo={r ? r.nome : 'Nuovo referente'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <div className="ct-griglia">
          <div className="field"><label htmlFor="rf-n">Nome</label><input id="rf-n" required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} disabled={!!r} /></div>
          <div className="field"><label htmlFor="rf-r">Ruolo</label><input id="rf-r" value={f.ruolo} onChange={e => setF({ ...f, ruolo: e.target.value })} /></div>
          <div className="field"><label htmlFor="rf-e">Email</label><input id="rf-e" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="rf-t">Telefono</label><input id="rf-t" type="tel" value={f.telefono} onChange={e => setF({ ...f, telefono: e.target.value })} /></div>
          <div className="field"><label htmlFor="rf-c">Cellulare</label><input id="rf-c" type="tel" value={f.cellulare} onChange={e => setF({ ...f, cellulare: e.target.value })} /></div>
        </div>
        <fieldset className="ct-resp"><legend>Responsabilità</legend>
          {RESPONSABILITA.map(x => <label key={x.k} className="check"><input type="checkbox" checked={f.responsabilita.includes(x.k)} onChange={() => tog(x.k)} /> <span><b>{x.l}</b> <span className="sub">{x.d}</span></span></label>)}
          <label className="check"><input type="checkbox" checked={f.coordina_interventi} onChange={e => setF({ ...f, coordina_interventi: e.target.checked })} /> <span><b>Coordinamento interventi</b> <span className="sub">Riceve email + telefonata per ogni intervento (il primo disponibile in ordine)</span></span></label>
          <label className="check"><input type="checkbox" checked={f.coordina_sopralluoghi} onChange={e => setF({ ...f, coordina_sopralluoghi: e.target.checked })} /> <span><b>Coordinamento sopralluoghi</b> <span className="sub">Riceve email + telefonata per ogni sopralluogo</span></span></label>
        </fieldset>
        <div className="field"><label htmlFor="rf-or">Ordine (più basso = prima scelta)</label><input id="rf-or" type="number" value={f.ordine} onChange={e => setF({ ...f, ordine: Number(e.target.value) || 0 })} /></div>
        <div className="field"><label htmlFor="rf-no">Nota (es. «al pomeriggio sul cellulare»)</label><input id="rf-no" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        <label className="check"><input type="checkbox" checked={f.attivo} onChange={e => setF({ ...f, attivo: e.target.checked })} /> Attivo</label>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={inCorso}>{inCorso ? 'Salvataggio…' : 'Salva'}</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}
