import { useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtData } from '../lib/format';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, Modal, Pill, Targa, toast, useLoad } from '../ui';

/** Carte carburante (Q8). Mai il numero completo né il PIN: solo le ultime 4 cifre. */
interface Ass { id: number; dipendente_id: number | null; veicolo_id: number | null; dal: string; al: string | null; consegnata_da: string | null; restituita_a: string | null; note: string | null;
  dipendenti: { nome: string; cognome: string } | null; veicoli: { targa: string } | null }
interface Carta { id: number; ultime4: string; circuito: string; veicolo_id: number | null; scadenza: string | null; stato: Stato; note: string | null;
  veicoli: { targa: string } | null; carte_assegnazioni: Ass[] }
type Stato = 'attiva' | 'sospesa' | 'smarrita' | 'restituita';
const STATI: Record<Stato, ['ok' | 'warn' | 'ko' | 'na', string]> = { attiva: ['ok', 'Attiva'], sospesa: ['warn', 'Sospesa'], smarrita: ['ko', 'Smarrita'], restituita: ['na', 'Restituita'] };
const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const nome = (a: Ass) => a.dipendenti ? `${a.dipendenti.nome} ${a.dipendenti.cognome}` : a.veicoli ? a.veicoli.targa : '—';

export default function CarteCarburante({ gestione = false }: { gestione?: boolean }) {
  const { t, tm } = useT();
  const { data: d, errore, reload } = useLoad(async () => {
    const [c, v, p] = await Promise.all([
      supabase.from('carte_carburante').select('*, veicoli(targa), carte_assegnazioni(*, dipendenti(nome,cognome), veicoli(targa))').order('ultime4'),
      supabase.from('veicoli').select('id,targa').eq('dismesso', false).order('targa'),
      supabase.from('dipendenti').select('id,nome,cognome').eq('attivo', true).order('cognome'),
    ]);
    if (c.error) throw c.error;
    return { carte: c.data as unknown as Carta[], veicoli: (v.data ?? []) as { id: number; targa: string }[], dip: (p.data ?? []) as { id: number; nome: string; cognome: string }[] };
  });
  const [nuova, setNuova] = useState(false);
  const [assegna, setAssegna] = useState<Carta | null>(null);
  const [restituisci, setRestituisci] = useState<Carta | null>(null);
  const [storico, setStorico] = useState<Carta | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const apri = (fn: () => void, base: Record<string, string> = {}) => { setErr(null); setF(base); fn(); };
  const chiudi = () => { setNuova(false); setAssegna(null); setRestituisci(null); };

  async function esegui(fn: () => Promise<unknown>, msg: string) {
    setErr(null);
    try { await fn(); toast(t(msg)); chiudi(); reload(); } catch (e) { setErr(tm(testoErrore(e))); }
  }
  const salvaNuova = () => esegui(async () => {
    if (!/^\d{4}$/.test(f.ultime4 ?? '')) throw new Error(t('Inserisci solo le ultime 4 cifre della carta.'));
    const { error } = await supabase.from('carte_carburante').insert({ ultime4: f.ultime4, circuito: f.circuito || 'Q8', scadenza: f.scadenza || null, veicolo_id: f.veicolo ? Number(f.veicolo) : null, note: f.note || null });
    if (error) throw error;
  }, 'Carta registrata');
  const salvaAssegna = () => esegui(() => rpc('carta_assegna', { p_carta: assegna!.id, p_dipendente: f.dip ? Number(f.dip) : null, p_veicolo: f.veicolo ? Number(f.veicolo) : null,
    p_dal: f.dal || oggi(), p_consegnata_da: f.da || null, p_note: f.note || null }), 'Carta assegnata');
  const salvaRestituisci = () => esegui(() => rpc('carta_restituisci', { p_carta: restituisci!.id, p_al: f.al || oggi(), p_restituita_a: f.a || null, p_note: f.note || null }), 'Restituzione registrata');
  async function cambiaStato(c: Carta, stato: Stato) {
    const { error } = await supabase.from('carte_carburante').update({ stato }).eq('id', c.id);
    if (error) toast(tm(testoErrore(error))); else { toast(t('Stato aggiornato')); reload(); }
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!d) return <Caricamento />;
  const aperta = (c: Carta) => c.carte_assegnazioni.find(a => !a.al || a.al >= oggi()) ?? null;
  return (
    <>
      <div className="section-title">{t('Carte carburante')} <span className="meta">{d.carte.length}</span>
        {gestione && <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => apri(() => setNuova(true), { circuito: 'Q8' })}>{t('Nuova carta')}</button>}</div>
      {!gestione && <Banner s="warn">{t("Sola lettura: le carte sono gestite dall'ufficio personale.")}</Banner>}
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Carta')}</th><th>{t('Circuito')}</th><th>{t('Stato')}</th><th>{t('Scadenza')}</th><th>{t('Veicolo')}</th><th>{t('Assegnata a')}</th><th>{t('Dal')}</th><th></th></tr></thead>
        <tbody>{d.carte.length ? d.carte.map(c => { const a = aperta(c); const scaduta = !!c.scadenza && c.scadenza < oggi(); return (
          <tr key={c.id}>
            <td className="mono">•••• {c.ultime4}</td><td>{c.circuito}</td>
            <td><Pill s={STATI[c.stato][0]}>{t(STATI[c.stato][1])}</Pill></td>
            <td className="mono">{c.scadenza ? fmtData(c.scadenza) : '—'}{scaduta && <> <Pill s="ko">{t('Scaduta')}</Pill></>}</td>
            <td>{c.veicoli ? <Targa t={c.veicoli.targa} /> : '—'}</td>
            <td>{a ? nome(a) : <span className="sub">{t('Non assegnata')}</span>}</td><td className="mono">{a ? fmtData(a.dal) : '—'}</td>
            <td className="row-flex">
              <button className="btn-ghost" onClick={() => setStorico(c)}>{t('Storico')}</button>
              {gestione && <>
                {c.stato === 'attiva' && <button className="btn-ghost" onClick={() => apri(() => setAssegna(c), { dal: oggi(), veicolo: c.veicolo_id ? String(c.veicolo_id) : '' })}>{t('Assegna')}</button>}
                {a && !a.al && <button className="btn-ghost" onClick={() => apri(() => setRestituisci(c), { al: oggi() })}>{t('Restituzione')}</button>}
                <select aria-label={t('Cambia stato')} value={c.stato} onChange={e => cambiaStato(c, e.target.value as Stato)}>
                  {(Object.keys(STATI) as Stato[]).map(s => <option key={s} value={s}>{t(STATI[s][1])}</option>)}</select>
              </>}
            </td>
          </tr>); }) : <tr><td colSpan={8} className="sub">{t('Nessuna carta registrata')}</td></tr>}</tbody>
      </table></div>

      {nuova && <Modal titolo={t('Nuova carta')} onClose={chiudi}><div className="form">
        <Banner s="warn">{t('Non scrivere mai il numero completo né il PIN: solo le ultime 4 cifre.')}</Banner>
        <div className="field"><label htmlFor="u4">{t('Ultime 4 cifre')} *</label><input id="u4" inputMode="numeric" maxLength={4} value={f.ultime4 ?? ''} onChange={e => setF({ ...f, ultime4: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="field"><label htmlFor="circ">{t('Circuito')}</label><input id="circ" value={f.circuito ?? ''} onChange={set('circuito')} /></div>
        <div className="field"><label htmlFor="scad">{t('Scadenza')}</label><input id="scad" type="date" value={f.scadenza ?? ''} onChange={set('scadenza')} /></div>
        <SceltaVeicolo veicoli={d.veicoli} v={f.veicolo ?? ''} on={set('veicolo')} />
        <div className="field"><label htmlFor="nt">{t('Note')}</label><input id="nt" value={f.note ?? ''} onChange={set('note')} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={salvaNuova}>{t('Salva')}</button><button className="btn-ghost" onClick={chiudi}>{t('Annulla')}</button></div>
      </div></Modal>}

      {assegna && <Modal titolo={t('Assegna carta •••• {n}', { n: assegna.ultime4 })} onClose={chiudi}><div className="form">
        <p className="sub">{t("Indica il dipendente, il veicolo o entrambi. L'assegnazione precedente viene chiusa e resta nello storico.")}</p>
        <div className="field"><label htmlFor="dip">{t('Dipendente')}</label><select id="dip" value={f.dip ?? ''} onChange={set('dip')}><option value="">—</option>
          {d.dip.map(p => <option key={p.id} value={p.id}>{p.cognome} {p.nome}</option>)}</select></div>
        <SceltaVeicolo veicoli={d.veicoli} v={f.veicolo ?? ''} on={set('veicolo')} />
        <div className="field"><label htmlFor="dal">{t('Dal')}</label><input id="dal" type="date" value={f.dal ?? ''} onChange={set('dal')} /></div>
        <div className="field"><label htmlFor="cda">{t('Consegnata da')}</label><input id="cda" value={f.da ?? ''} onChange={set('da')} /></div>
        <div className="field"><label htmlFor="nt2">{t('Note')}</label><input id="nt2" value={f.note ?? ''} onChange={set('note')} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={salvaAssegna}>{t('Assegna')}</button><button className="btn-ghost" onClick={chiudi}>{t('Annulla')}</button></div>
      </div></Modal>}

      {restituisci && <Modal titolo={t('Restituzione carta •••• {n}', { n: restituisci.ultime4 })} onClose={chiudi}><div className="form">
        <div className="field"><label htmlFor="al">{t('Restituita il')}</label><input id="al" type="date" value={f.al ?? ''} onChange={set('al')} /></div>
        <div className="field"><label htmlFor="ra">{t('Restituita a')}</label><input id="ra" value={f.a ?? ''} onChange={set('a')} /></div>
        <div className="field"><label htmlFor="nt3">{t('Note')}</label><input id="nt3" value={f.note ?? ''} onChange={set('note')} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={salvaRestituisci}>{t('Conferma')}</button><button className="btn-ghost" onClick={chiudi}>{t('Annulla')}</button></div>
      </div></Modal>}

      {storico && <Modal titolo={t('Storico carta •••• {n}', { n: storico.ultime4 })} onClose={() => setStorico(null)}>
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Assegnata a')}</th><th>{t('Veicolo')}</th><th>{t('Dal')}</th><th>{t('Al')}</th><th>{t('Consegnata da')}</th><th>{t('Restituita a')}</th><th>{t('Note')}</th></tr></thead>
          <tbody>{storico.carte_assegnazioni.length ? [...storico.carte_assegnazioni].sort((a, b) => b.dal.localeCompare(a.dal) || b.id - a.id).map(a => <tr key={a.id}>
            <td>{a.dipendenti ? `${a.dipendenti.nome} ${a.dipendenti.cognome}` : '—'}</td><td>{a.veicoli ? <Targa t={a.veicoli.targa} /> : '—'}</td>
            <td className="mono">{fmtData(a.dal)}</td><td className="mono">{a.al ? fmtData(a.al) : t('in corso')}</td><td>{a.consegnata_da ?? '—'}</td><td>{a.restituita_a ?? '—'}</td><td>{a.note ?? ''}</td></tr>)
            : <tr><td colSpan={7} className="sub">{t('Nessuna assegnazione')}</td></tr>}</tbody>
        </table></div>
      </Modal>}
    </>
  );
}

function SceltaVeicolo({ veicoli, v, on }: { veicoli: { id: number; targa: string }[]; v: string; on: (e: { target: { value: string } }) => void }) {
  const { t } = useT();
  return <div className="field"><label htmlFor="veic">{t('Veicolo (targa)')}</label><select id="veic" value={v} onChange={on}><option value="">—</option>
    {veicoli.map(x => <option key={x.id} value={x.id}>{x.targa}</option>)}</select></div>;
}
