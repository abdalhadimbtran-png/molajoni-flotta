import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { giorniA } from '../lib/format';
import { Caricamento, Errore, useLoad } from '../ui';
import { categoriaReparto, fmtQ, nomeTipo, num, periodo, testoQuando, useHR, type Richiesta } from './comune';
import { AvvisoDecisore, ImpattoRichiesta, ModaleInserisci, ModaleRifiuto, decidi, erroreHR, perPrimoGiorno } from './componenti';
import { toast } from '../ui';

/** Home dell'ufficio personale: le richieste in valutazione, con l'impatto sul lavoro. */
export default function DaDecidere() {
  const { mioDipendente, aggiornaContatore } = useHR();
  const [sp] = useSearchParams();
  const evid = Number(sp.get('r')) || null;
  const [cerca, setCerca] = useState('');
  const [rifiuta, setRifiuta] = useState<Richiesta | null>(null);
  const [inserisci, setInserisci] = useState(false);
  const [uscita, setUscita] = useState<Set<number>>(new Set());
  const [occupato, setOccupato] = useState<number | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [l, p] = await Promise.all([
      rpc<Richiesta[]>('hr_richieste', { p_stato: 'in_attesa' }),
      supabase.from('dipendenti').select('id,categoria,reparto,attivo'),
    ]);
    return { lista: [...l].sort(perPrimoGiorno), persone: (p.data ?? []) as { id: number; categoria: string; reparto: string | null; attivo: boolean }[] };
  });
  useEffect(() => { if (evid && data) document.getElementById(`ric-${evid}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [evid, data]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.lista.filter(r => !uscita.has(r.id) && (!cerca || r.dipendente.nome.toLowerCase().includes(cerca.toLowerCase())));
  const tot = data.lista.length - uscita.size;

  function togli(id: number) {
    setUscita(s => new Set(s).add(id));
    window.setTimeout(() => { reload(); aggiornaContatore(); setUscita(new Set()); }, 420);
  }
  async function approva(r: Richiesta) {
    setOccupato(r.id);
    try { await decidi(r, 'approva'); togli(r.id); }
    catch (e) { toast(erroreHR(e)); reload(); aggiornaContatore(); }
    finally { setOccupato(null); }
  }

  return (
    <>
      <div className="page-hero">
        <div><h1>Da decidere</h1>
          <p className="sub">{tot === 0 ? 'Nessuna richiesta in attesa' : tot === 1 ? '1 richiesta aspetta una risposta' : `${tot} richieste aspettano una risposta`}</p></div>
        <button className="btn-ghost" onClick={() => setInserisci(true)}>Inserisci un'assenza</button>
      </div>

      {data.lista.length > 10 && <div className="field hr-cerca"><label htmlFor="dd-cerca">Cerca per nome</label><input id="dd-cerca" value={cerca} onChange={e => setCerca(e.target.value)} /></div>}

      {tot === 0 ? (
        <div className="panel hr-vuoto">
          <p className="hr-vuoto-t">Nessuna richiesta da decidere.</p>
          <p className="sub">Le nuove richieste arrivano qui e nella campanella.</p>
          <Link className="link" to="/hr/calendario">Apri il calendario assenze</Link>
        </div>
      ) : (
        <div className="hr-lista">
          {lista.map(r => {
            const g = giorniA(r.primo_giorno) ?? 0;
            const vicino = g <= 2;
            return (
              <article key={r.id} id={`ric-${r.id}`} className={`panel hr-card ${uscita.has(r.id) ? 'via' : ''} ${evid === r.id ? 'evid' : ''}`}>
                <div className="hr-card-cols">
                  <div className="hr-card-ric">
                    <div className="hr-nome">{r.dipendente.nome} <span className="sub">{categoriaReparto(r.dipendente.categoria, r.dipendente.reparto)}</span></div>
                    <div className="hr-periodo"><b>{nomeTipo(r.tipo_descrizione)}</b> · {periodo(r)}</div>
                    <div className="hr-conto">
                      <span>{fmtQ(r.quantita, r.unita)}</span>
                      {r.saldi?.map(s => (
                        <span key={s.anno} className={s.saldo_dopo_approvazione < 0 ? 'msg warn' : ''}>
                          · Saldo{r.saldi!.length > 1 ? ` ${s.anno}` : ''} {num(s.saldo)} → {num(s.saldo_dopo_approvazione)} {r.unita === 'ore' ? 'ore' : 'giorni'}
                          {s.in_attesa_altre > 0 && <span className="sub"> (altre in attesa: {num(s.in_attesa_altre)})</span>}
                        </span>))}
                    </div>
                    {r.note && <p className="hr-nota">«{r.note}»</p>}
                    {r.avvisi.filter(a => a.startsWith('Festività')).map((a, i) => <div key={i} className="sub">{a.replace('Festività non conteggiate:', 'Non contano:')}</div>)}
                    <div className={vicino ? 'msg ko' : 'sub'}>{r.creata_da === 'hr' ? 'Inserita dall\'ufficio' : 'Inviata'} il {testoQuando(r.creato_il.slice(0, 10)).slice(0, 5)} · {g < 0 ? `iniziata ${-g === 1 ? 'ieri' : `${-g} giorni fa`}` : g === 0 ? 'Inizia oggi' : g === 1 ? 'Inizia domani' : `inizia tra ${g} giorni`}</div>
                  </div>
                  <ImpattoRichiesta r={r} persone={data.persone} />
                </div>
                <AvvisoDecisore r={r} mio={mioDipendente} />
                <div className="hr-azioni">
                  {r.puo_decidere && <>
                    <button className="btn" onClick={() => approva(r)} disabled={occupato === r.id}>{occupato === r.id ? 'Salvataggio…' : 'Approva'}</button>
                    <button className="btn-ghost" onClick={() => setRifiuta(r)} disabled={occupato === r.id}>Rifiuta</button>
                  </>}
                  <Link className="link" to={`/hr/calendario?m=${r.primo_giorno.slice(0, 7)}&d=${r.dipendente_id}`}>Vedi nel calendario</Link>
                </div>
              </article>
            );
          })}
          {lista.length === 0 && <p className="sub">Nessuna richiesta per «{cerca}».</p>}
        </div>
      )}

      {rifiuta && <ModaleRifiuto nome={rifiuta.dipendente.nome} onClose={() => setRifiuta(null)}
        onConferma={async m => { await decidi(rifiuta, 'rifiuta', m); const id = rifiuta.id; setRifiuta(null); togli(id); }} />}
      {inserisci && <ModaleInserisci onClose={() => setInserisci(false)} onSalvato={() => { setInserisci(false); reload(); aggiornaContatore(); }} />}
    </>
  );
}
