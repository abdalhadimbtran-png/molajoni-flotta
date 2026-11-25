import { useEffect, useRef, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { Modal, toast } from '../ui';
import { COLORE_STATO, erroreAzione, statoOfferta, type EsitoOfferta, type Offerta } from '../lib/centralino/offerte';
import { JEN, MOTIVI, STATI_OFFERTA } from '../lib/centralino/testiDirezione';
import { tutteLeRighe } from './comune';

export const CAMPI_OFFERTA = '*, pratiche(numero,cliente_nome,descrizione,canale,importo_stimato,tipo)';

/** true se la tabella pratiche_offerta non esiste ancora (migrazione 0099 non applicata). */
export function mancaTabella(e: unknown) {
  const m = `${(e as { message?: string })?.message ?? ''} ${(e as { code?: string })?.code ?? ''}`;
  return /pratiche_offerta|42P01|PGRST205|schema cache/i.test(m);
}

/** Offerte (null = registro non ancora attivo). `da`/`a` ISO: filtro su arrivata_il; `aperte`: solo da_inviare / in_attesa. */
export async function caricaOfferte(f: { da?: string; a?: string; aperte?: boolean } = {}): Promise<Offerta[] | null> {
  try {
    return await tutteLeRighe<Offerta>((x, y) => {
      let q = supabase.from('pratiche_offerta').select(CAMPI_OFFERTA);
      if (f.da) q = q.gte('arrivata_il', f.da);
      if (f.a) q = q.lte('arrivata_il', f.a);
      if (f.aperte) q = q.in('esito', ['da_inviare', 'in_attesa']);
      return q.order('arrivata_il', { ascending: false }).order('pratica_id').range(x, y);
    }, 10000);
  } catch (e) { if (mancaTabella(e)) return null; throw e; }
}

export function PillStato({ o, ora }: { o: Offerta; ora?: Date }) {
  const s = statoOfferta(o, ora);
  return <span className={`of-pill of-${COLORE_STATO[s]}`}>{STATI_OFFERTA[s].it}</span>;
}

/** «dd/mm hh:mm» ora di Roma. */
export const dataOra = (s: string | null | undefined) => s ? new Date(s).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
/** valore per <input type="datetime-local"> (ora locale del computer). */
export const perInput = (d: Date) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };

export type TipoAzione = 'inviata' | 'accettata' | 'non_accettata' | 'annullata' | 'nota' | 'modifica';
const TITOLI: Record<TipoAzione, string> = { inviata: JEN.az_inviata.it, accettata: JEN.az_accettata.it, non_accettata: JEN.az_non.it, annullata: JEN.az_annullata.it, nota: JEN.az_nota.it, modifica: 'Modifica offerta' };

/** Finestra per un'azione rapida su un'offerta. Ctrl+Invio salva. */
export function AzioneOfferta({ o, tipo, onClose, onFatto }: { o: Offerta; tipo: TipoAzione; onClose: () => void; onFatto: () => void }) {
  const ora = new Date();
  const [inviata, setInviata] = useState(perInput(o.inviata_il ? new Date(o.inviata_il) : ora));
  const [arrivata, setArrivata] = useState(perInput(new Date(o.arrivata_il)));
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [rit, setRit] = useState(o.motivo_ritardo ?? '');
  const [adhoc, setAdhoc] = useState(o.numero_offerta_adhoc ?? '');
  const [importo, setImporto] = useState(o.pratiche?.importo_stimato != null ? String(o.pratiche.importo_stimato) : '');
  const [gestita, setGestita] = useState(o.gestita_da);
  const [referenti, setReferenti] = useState<string[]>([]);
  const [invio, setInvio] = useState(false);
  const primo = useRef<HTMLElement | null>(null);
  useEffect(() => { primo.current?.focus(); }, []);
  useEffect(() => { if (tipo === 'modifica') supabase.from('referenti').select('nome').eq('attivo', true).order('nome').then(({ data }) => setReferenti((data ?? []).map(r => r.nome as string))); }, [tipo]);
  const inviataIso = tipo === 'inviata' ? new Date(inviata).toISOString() : undefined;
  const mia = o.gestione === 'jennifer';
  const tardi = !mia ? false : tipo === 'inviata' ? new Date(inviata) > new Date(o.scadenza)
    : tipo === 'annullata' ? !o.inviata_il && ora > new Date(o.scadenza) && motivo !== 'Non più necessario' : false;
  async function salva() {
    if (invio) return;
    try {
      if (tipo === 'nota') {
        if (!nota.trim()) { toast('Scrivi l\'aggiornamento'); return; }
        setInvio(true); await rpc('offerta_nota', { p_id: o.pratica_id, p_testo: nota.trim() });
      } else {
        const p: Record<string, unknown> = {};
        if (tipo === 'inviata') { p.inviata_il = inviataIso; if (rit.trim()) p.motivo_ritardo = rit.trim(); if (adhoc.trim()) p.numero_offerta_adhoc = adhoc.trim(); if (importo.trim()) p.importo = importo.replace(',', '.'); }
        if (tipo === 'accettata' || tipo === 'non_accettata' || tipo === 'annullata') {
          p.esito = tipo as EsitoOfferta; if (motivo) p.motivo = motivo; if (nota.trim()) p.motivo_nota = nota.trim(); if (rit.trim()) p.motivo_ritardo = rit.trim();
          if (tipo === 'accettata' && importo.trim()) p.importo = importo.replace(',', '.');
        }
        if (tipo === 'modifica') {
          p.arrivata_il = new Date(arrivata).toISOString(); p.numero_offerta_adhoc = adhoc; p.importo = importo.replace(',', '.');
          if (gestita !== o.gestita_da) p.gestita_da = gestita;
          if (rit.trim() !== (o.motivo_ritardo ?? '')) p.motivo_ritardo = rit.trim();
        }
        const err = tipo === 'modifica' ? null : erroreAzione({ esito: p.esito as EsitoOfferta | undefined, motivo, motivo_nota: nota, inviata_il: inviataIso, motivo_ritardo: rit }, o, ora);
        if (err) { toast(err); return; }
        setInvio(true); await rpc('offerta_aggiorna', { p_id: o.pratica_id, p });
      }
      toast(`${o.pratiche?.cliente_nome ?? 'Offerta'}: ${TITOLI[tipo].toLowerCase()} ✓`); onFatto();
    } catch (e) { toast(testoErrore(e)); } finally { setInvio(false); }
  }
  const conMotivo = tipo === 'non_accettata' || tipo === 'annullata';
  return (
    <Modal titolo={`${TITOLI[tipo]} · ${o.pratiche?.cliente_nome ?? ''}`} onClose={onClose}>
      <form className="of-form" onSubmit={e => { e.preventDefault(); salva(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salva(); } }}>
        {tipo === 'inviata' && <>
          <label>{JEN.quando_inviata.it}<input ref={r => { primo.current = r; }} type="datetime-local" value={inviata} max={perInput(ora)} onChange={e => setInviata(e.target.value)} required /></label>
          <label>{JEN.numero_adhoc.it} <span className="sub">facoltativo</span><input value={adhoc} onChange={e => setAdhoc(e.target.value)} /></label>
          <label>{JEN.importo.it} <span className="sub">facoltativo</span><input inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value)} /></label>
        </>}
        {tipo === 'accettata' && <label>{JEN.importo.it} <span className="sub">facoltativo</span><input ref={r => { primo.current = r; }} inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value)} /></label>}
        {conMotivo && <fieldset className="of-motivi"><legend>{JEN.motivo.it}</legend>
          {MOTIVI.map((m, i) => <label key={m} className={`of-scelta ${motivo === m ? 'on' : ''}`}><input type="radio" name="motivo" value={m} checked={motivo === m} onChange={() => setMotivo(m)} ref={i === 0 ? (r => { primo.current = r; }) : undefined} />{m}</label>)}
        </fieldset>}
        {(conMotivo || tipo === 'nota') && <label>{tipo === 'nota' ? JEN.nota_seguito.it : JEN.nota_motivo.it}
          <textarea ref={tipo === 'nota' ? (r => { primo.current = r; }) : undefined} rows={tipo === 'nota' ? 3 : 2} value={nota} onChange={e => setNota(e.target.value)} /></label>}
        {tipo === 'modifica' && <>
          <label>{JEN.arrivata_il.it}<input ref={r => { primo.current = r; }} type="datetime-local" value={arrivata} max={perInput(ora)} onChange={e => setArrivata(e.target.value)} /></label>
          <label>Gestita da<select value={gestita} onChange={e => setGestita(e.target.value)}>
            {[...new Set(['Jennifer', o.gestita_da, ...referenti])].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>{JEN.numero_adhoc.it}<input value={adhoc} onChange={e => setAdhoc(e.target.value)} /></label>
          <label>{JEN.importo.it}<input inputMode="decimal" value={importo} onChange={e => setImporto(e.target.value)} /></label>
        </>}
        {(tardi || (mia && tipo === 'modifica' && o.inviata_il && new Date(o.inviata_il) > new Date(o.scadenza))) &&
          <label className="of-rit">{JEN.motivo_ritardo.it} <span className="sub">obbligatorio: scadenza {dataOra(o.scadenza)}</span><input value={rit} onChange={e => setRit(e.target.value)} required={tipo !== 'modifica'} /></label>}
        <div className="of-form-a"><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn" disabled={invio}>{JEN.salva.it} <kbd>Ctrl</kbd>+<kbd>Invio</kbd></button></div>
      </form>
    </Modal>
  );
}

/** Pulsanti rapidi per una riga (Jennifer). */
export function AzioniRiga({ o, onAzione }: { o: Offerta; onAzione: (t: TipoAzione) => void }) {
  const inviata = !!o.inviata_il;
  const chiusa = !['da_inviare', 'in_attesa'].includes(o.esito);
  return (
    <div className="of-az" onClick={e => e.stopPropagation()}>
      {!inviata && !chiusa && <button className="btn btn-sm" onClick={() => onAzione('inviata')} title="Segna inviata (I)">{JEN.az_inviata.it}</button>}
      {inviata && !chiusa && <button className="btn btn-sm of-b-ok" onClick={() => onAzione('accettata')} title="Accettata (Y)">{JEN.az_accettata.it}</button>}
      {inviata && !chiusa && <button className="btn-ghost btn-sm" onClick={() => onAzione('non_accettata')} title="Non accettata (X)">{JEN.az_non.it}</button>}
      {!chiusa && <button className="btn-ghost btn-sm" onClick={() => onAzione('annullata')}>{JEN.az_annullata.it}</button>}
      <button className="btn-ghost btn-sm" onClick={() => onAzione('nota')} title="Nota (O)">{JEN.az_nota.it}</button>
    </div>
  );
}

/** Riquadro «Offerta» nella scheda pratica: stato, date, motivo, azioni (solo centralino). */
export function SchedaOfferta({ praticaId, scrive, versione }: { praticaId: number; scrive: boolean; versione?: number }) {
  const [o, setO] = useState<Offerta | null | undefined>(undefined);
  const [az, setAz] = useState<TipoAzione | null>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    let ok = true;
    supabase.from('pratiche_offerta').select(CAMPI_OFFERTA).eq('pratica_id', praticaId).maybeSingle()
      .then(({ data, error }) => { if (ok) setO(error ? null : (data as Offerta | null)); });
    return () => { ok = false; };
  }, [praticaId, versione, k]);
  if (!o) return null;
  return (
    <section className="ct-blocco ct-dati of-scheda">
      <h2>Offerta <PillStato o={o} /></h2>
      <dl>
        <dt>{JEN.arrivata_il.it}</dt><dd>{dataOra(o.arrivata_il)}</dd>
        <dt>Gestita da</dt><dd>{o.gestita_da}</dd>
        <dt>{JEN.col_scadenza.it}</dt><dd>{dataOra(o.scadenza)}</dd>
        <dt>Inviata il</dt><dd>{dataOra(o.inviata_il)}</dd>
        {o.numero_offerta_adhoc && <><dt>{JEN.numero_adhoc.it}</dt><dd>{o.numero_offerta_adhoc}</dd></>}
        {o.motivo && <><dt>{JEN.motivo.it}</dt><dd>{o.motivo}{o.motivo_nota ? ` – ${o.motivo_nota}` : ''}</dd></>}
        {o.motivo_ritardo && <><dt>{JEN.motivo_ritardo.it}</dt><dd>{o.motivo_ritardo}</dd></>}
      </dl>
      {scrive && <div className="of-scheda-a"><AzioniRiga o={o} onAzione={setAz} /><button className="btn-ghost btn-sm" onClick={() => setAz('modifica')}>Modifica</button></div>}
      {az && <AzioneOfferta o={o} tipo={az} onClose={() => setAz(null)} onFatto={() => { setAz(null); setK(x => x + 1); }} />}
    </section>
  );
}
