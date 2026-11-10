import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Banner, Caricamento, Errore, toast, useLoad } from '../ui';
import type { Flusso } from '../lib/centralino/tipi';
import { config as ricaricaConfig } from './comune';
import { useCtx } from './ShellCentralino';
import ImportaClienti from './ImportaClienti';
import AzzeraDati from './AzzeraDati';
import { useSalva } from '../lib/salva';

interface Riga { chiave: string; valore: unknown; descrizione: string | null }
const NOMI: Record<string, string> = {
  orario: 'Orario d\'ufficio', soglia_arancio: 'Soglia arancio', cc_offerte_grandi: 'Copia per offerte del Tecnico Commerciale', amministrazione: 'Amministrazione', fornitori: 'Fornitori',
  commerciali: 'Commerciali', responsabili_info: 'Responsabili (informazioni)', firma: 'Firma email', sostituto: 'Sostituto del centralino',
  mesi_cliente_attivo: 'Mesi per «cliente attivo»', commerciali_offerte_grandi: 'Tecnici Commerciali per le offerte (email = account)', motivi_annullamento: 'Motivi di annullamento', motivi_senza_email: 'Motivi «email non disponibile»', motivi_spostamento: 'Motivi di spostamento', trasferimento_sla: 'Tempo per richiamare (trasferimenti)', destinatari_trasferimento: 'Destinatari dei trasferimenti',
};
const DERIVATE = ['mappa_import_clienti', 'commerciali_offerte_grandi', 'cc_offerte_grandi', 'commerciali', 'amministrazione', 'fornitori', 'sostituto', 'destinatari_trasferimento', 'responsabili_info'];
const DESC_SLA = 'sla: {"tipo":"minuti|ore|stesso_giorno|giorni_lav","valore":N,"da":"creazione|ingresso"}';

/** Impostazioni (JSON con controllo) e flussi: stadi e SLA modificabili senza codice. */
export default function Impostazioni() {
  const ctx = useCtx();
  const { data, errore, reload } = useLoad(async () => {
    const [i, f] = await Promise.all([supabase.from('centralino_impostazioni').select('chiave,valore,descrizione').order('chiave'), supabase.from('pratiche_flussi').select('*').order('ordine')]);
    if (i.error || f.error) throw i.error || f.error;
    return { imp: (i.data ?? []) as Riga[], flussi: (f.data ?? []) as Flusso[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const fatto = () => { reload(); ricaricaConfig(true); };
  return (
    <>
      <div className="page-hero"><div><h1>Flussi e impostazioni</h1><p className="sub">Le modifiche valgono per le pratiche nuove e per i prossimi passi di quelle aperte.</p></div></div>
      <ImportaClienti scrive={ctx.scrive} mappaSalvata={(data.imp.find(r => r.chiave === 'mappa_import_clienti')?.valore ?? {}) as Record<string, string>} />
      <h2 className="section-title">Impostazioni</h2>
      <p className="hint">Persone, email e compiti (commerciali, destinatari dei trasferimenti, copie, sostituto) si gestiscono in <Link to="/centralino/referenti">Referenti e responsabilità</Link>.</p>
      <div className="ct-imp">{data.imp.filter(r => !DERIVATE.includes(r.chiave)).map(r => <Voce key={r.chiave} titolo={NOMI[r.chiave] ?? r.chiave} desc={r.descrizione} valore={r.valore} scrive={ctx.scrive}
        salva={async v => { const x = await supabase.from('centralino_impostazioni').update({ valore: v }).eq('chiave', r.chiave); if (x.error) throw x.error; fatto(); }} />)}</div>
      <h2 className="section-title">Flussi (stadi e SLA)</h2>
      <p className="hint">{DESC_SLA}. «azione»: appuntamento | taylor | esito. «template»: codice del modello email suggerito. Non cambiare le chiavi degli stadi già usati.</p>
      <div className="ct-imp">{data.flussi.map(f => <Voce key={f.tipo} titolo={f.nome} desc={f.nota_procedura} scrive={ctx.scrive}
        valore={{ stadi: f.stadi, sla_sottotipi: f.sla_sottotipi, sottotipi: f.sottotipi, sottotipi_urgenti: f.sottotipi_urgenti, assegnazione: f.assegnazione, nota_procedura: f.nota_procedura, attivo: f.attivo }}
        salva={async v => {
          const o = v as Partial<Flusso>;
          if (!Array.isArray(o.stadi) || o.stadi.length < 2 || o.stadi.some(s => !s.key || !s.nome)) throw new Error('Servono almeno 2 stadi, ognuno con key e nome.');
          if (o.stadi[0].key !== 'ricevuta') throw new Error('Il primo stadio deve restare «ricevuta».');
          const x = await supabase.from('pratiche_flussi').update(o).eq('tipo', f.tipo); if (x.error) throw x.error; fatto();
        }} />)}</div>
      {ctx.admin && <AzzeraDati />}
    </>
  );
}

function Voce({ titolo, desc, valore, scrive, salva }: { titolo: string; desc: string | null; valore: unknown; scrive: boolean; salva: (v: unknown) => Promise<void> }) {
  const [t, setT] = useState(() => JSON.stringify(valore, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [aperto, setAperto] = useState(false);
  const { salva: esegui, inCorso } = useSalva();
  async function ok() {
    setErr(null);
    let v: unknown; try { v = JSON.parse(t); } catch { setErr('Formato non valido: controlla virgole e virgolette.'); return; }
    const esito = await esegui(() => salva(v));
    if (esito.duplicato) return;
    if (!esito.ok) { setErr(esito.messaggio); return; }
    toast('Salvato'); setAperto(false);
  }
  return (
    <details className="ct-voce" open={aperto} onToggle={e => setAperto((e.target as HTMLDetailsElement).open)}>
      <summary><b>{titolo}</b>{desc && <span className="sub"> · {desc}</span>}</summary>
      <textarea className="ct-mono" rows={Math.min(24, t.split('\n').length + 1)} value={t} onChange={e => setT(e.target.value)} readOnly={!scrive} aria-label={titolo} />
      {err && <Banner s="ko">{err}</Banner>}
      {scrive && <div className="row-flex"><button className="btn btn-sm" onClick={ok} disabled={inCorso}>{inCorso ? 'Salvataggio…' : 'Salva'}</button><button className="btn-ghost btn-sm" onClick={() => setT(JSON.stringify(valore, null, 2))}>Ripristina</button></div>}
    </details>
  );
}
