import { useEffect, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { confermaValida, finoA, nomeBackup, PAROLA_CONFERMA, TABELLE_AZZERA, totale } from '../lib/centralino/azzera';

type Conti = Record<string, unknown> & { allegati_path?: string[]; contatori_azzerati?: boolean };

/** Zona pericolosa (solo admin): backup automatico, conteggi esatti, conferma «AZZERA». */
export default function AzzeraDati() {
  const [attiva, setAttiva] = useState<boolean | null>(null);
  const [data, setData] = useState('');
  const [contatti, setContatti] = useState(false);
  const [conti, setConti] = useState<Conti | null>(null);
  const [testo, setTesto] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const fino = finoA(data);

  useEffect(() => { // la funzione esiste sul database? (finché la migrazione non è confermata: pulsante disattivato)
    supabase.rpc('admin_centralino_conteggi', {}).then(r => setAttiva(!r.error || !/PGRST202|Could not find|does not exist/i.test(`${r.error.code} ${r.error.message}`)));
  }, []);

  async function apri() {
    setErr(null); setTesto('');
    const r = await supabase.rpc('admin_centralino_conteggi', { p_fino_a: fino, p_contatti: contatti });
    if (r.error) { setErr(testoErrore(r.error)); return; }
    setConti(r.data as Conti);
  }

  async function backup(): Promise<void> {
    const filtroP = (q: any) => (fino ? q.lt('created_at', fino) : q);
    const pr = await filtroP(supabase.from('pratiche').select('*'));
    if (pr.error) throw pr.error;
    const ids: number[] = (pr.data ?? []).map((p: { id: number }) => p.id);
    const perPratica = async (t: string) => { if (!ids.length) return []; const x = await supabase.from(t).select('*').in('pratica_id', ids); if (x.error) throw x.error; return x.data; };
    const tutte = async (t: string, col: string, extra?: (q: any) => any) => { let q: any = supabase.from(t).select('*'); if (fino) q = q.lt(col, fino); if (extra) q = extra(q); const x = await q; if (x.error) throw x.error; return x.data; };
    const out = {
      creato_il: new Date().toISOString(), fino_a: fino, contatti, conteggi: conti,
      pratiche: pr.data, pratiche_eventi: await perPratica('pratiche_eventi'), pratiche_allegati: await perPratica('pratiche_allegati'),
      chiamate_trasferite: await tutte('chiamate_trasferite', 'at'), email_in_uscita: await perPratica('email_in_uscita'),
      notifiche: await tutte('notifiche', 'creato_il', q => q.eq('dati->>categoria', 'centralino')),
      chiamate_info: await tutte('centralino_chiamate_info', 'at'),
      clienti_contatti: contatti ? await tutte('clienti_contatti', 'created_at', q => q.eq('fonte', 'centralino')) : [],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = nomeBackup(); a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function esegui() {
    if (!conti || !confermaValida(testo)) return;
    setLavoro(true); setErr(null);
    try {
      const files = (conti.allegati_path ?? []) as string[];
      for (let i = 0; i < files.length; i += 100) { const x = await supabase.storage.from('pratiche').remove(files.slice(i, i + 100)); if (x.error) throw x.error; }
      const r = await supabase.rpc('admin_centralino_azzera', { p_fino_a: fino, p_contatti: contatti });
      if (r.error) throw r.error;
      toast(`Dati di prova azzerati (${totale(r.data as Conti)} righe)`); setConti(null);
    } catch (e) { setErr(testoErrore(e)); } finally { setLavoro(false); }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--ko, #c0392b)', borderWidth: 2, borderStyle: 'solid', marginTop: 24 }}>
      <h2 className="section-title" style={{ color: 'var(--ko, #c0392b)' }}>Zona pericolosa · Azzera dati di prova</h2>
      <p className="sub">Cancella pratiche, storia, allegati (con i file), trasferimenti, appunti, email e notifiche del centralino, «+1 chiamata informativa» e riparte la numerazione (CT-{new Date().getFullYear()}-000001). Non tocca clienti Taylor, referenti, modelli email, flussi e impostazioni. La copia di backup è facoltativa.</p>
      <div className="row-flex" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label>Facoltativo: cancella solo le pratiche create <b>prima del</b> <input type="date" value={data} onChange={e => setData(e.target.value)} /> <span className="hint">— lascia vuoto per cancellare TUTTO</span>{data && <button type="button" className="btn btn-sm" onClick={() => setData("")}>Tutto</button>}</label>
        <label><input type="checkbox" checked={contatti} onChange={e => setContatti(e.target.checked)} /> Anche i contatti creati dal centralino (e la loro storia)</label>
      </div>
      {fino && <p className="hint">Con la data la numerazione non viene azzerata.</p>}
      {err && <Banner s="ko">{err}</Banner>}
      {attiva === false
        ? <button className="btn btn-sm" disabled title="La funzione sul database non è ancora stata attivata">In attesa di attivazione</button>
        : <button className="btn btn-sm" style={{ background: 'var(--ko, #c0392b)' }} disabled={attiva === null} onClick={apri}>Azzera dati di prova…</button>}
      {conti && (
        <Modal titolo="Azzera dati di prova" onClose={() => !lavoro && setConti(null)}>
          <table className="tbl"><tbody>{TABELLE_AZZERA.filter(t => t.k.startsWith('clienti') ? contatti || Number(conti[t.k]) > 0 : true).map(t => <tr key={t.k}><td>{t.nome}</td><td style={{ textAlign: 'right' }}><b>{Number(conti[t.k]) || 0}</b></td></tr>)}
            <tr><td>Numerazione pratiche</td><td style={{ textAlign: 'right' }}>{conti.contatori_azzerati ? 'riparte da 000001' : 'invariata'}</td></tr></tbody></table>
          <p>Totale: <b>{totale(conti)}</b> righe. Verrà scaricato un backup JSON prima della cancellazione. L'azione resta nel registro.</p>
          <label>Scrivi <b>{PAROLA_CONFERMA}</b> per confermare <input value={testo} onChange={e => setTesto(e.target.value)} autoFocus aria-label="Conferma" /></label>
          <div className="row-flex" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" style={{ background: 'var(--ko, #c0392b)' }} disabled={!confermaValida(testo) || lavoro} onClick={esegui}>{lavoro ? 'Cancellazione…' : 'Cancella tutto'}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={lavoro} onClick={() => backup().catch(e => setErr(testoErrore(e)))}>Scarica copia (facoltativo)</button>
            <button className="btn-ghost btn-sm" disabled={lavoro} onClick={() => setConti(null)}>Annulla</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
