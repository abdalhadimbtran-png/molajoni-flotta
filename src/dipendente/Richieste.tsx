import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { toast } from '../ui';
import { nomeTipo, sessioneScaduta, useSessione, type Richiesta } from './api';
import { Attesa, CardRichiesta, Conferma, IcoPiu, PillStato, RiepilogoRichiesta, RiquadroSaldo, metaDaNota, notaPulita } from './componenti';
import { addGiorni, dataDaTs, giornoLungo, momento } from './periodo';

/** Elenco completo delle richieste (dipendente_richieste). */
function useRichieste() {
  const { token, scaduta } = useSessione();
  const [l, setL] = useState<Richiesta[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const carica = useCallback(() => {
    setErr(null);
    rpc<Richiesta[]>('dipendente_richieste', { p_token: token, p_anno: null }).then(setL)
      .catch(e => { if (sessioneScaduta(e)) scaduta(); else setErr(testoErrore(e)); });
  }, [token, scaduta]);
  useEffect(carica, [carica]);
  return { l, err, carica };
}

const inCorso = (r: Richiesta) => r.stato === 'in_attesa' || (r.stato === 'approvata' && r.rientro > oggiISO());

/** Le mie richieste (UX § 2.5). */
export function MieRichieste() {
  const { home } = useSessione();
  const { l, err, carica } = useRichieste();
  const [tutte, setTutte] = useState(false);
  const titolo = <h1 className="tec-h1">Le mie richieste</h1>;
  if (err) return <>{titolo}<div className="ph-msg ko">{err}</div><button className="btn big" onClick={carica}>Riprova</button></>;
  if (!l) return <>{titolo}<Attesa /></>;
  const correnti = l.filter(inCorso).sort((a, b) => (a.stato === 'in_attesa' ? 0 : 1) - (b.stato === 'in_attesa' ? 0 : 1) || a.primo_giorno.localeCompare(b.primo_giorno));
  const limite = addGiorni(oggiISO(), -365);
  const passate = l.filter(r => !inCorso(r));
  const recenti = tutte ? passate : passate.filter(r => r.primo_giorno >= limite);
  return (
    <>
      {titolo}
      {home && <section className="tec-card"><RiquadroSaldo saldi={home.saldi} variante="compatto" /></section>}
      <Link className="btn brand big" to="/t/ferie/nuova"><IcoPiu />Nuova richiesta</Link>
      {!l.length && <div className="vuoto"><p>Non hai ancora fatto richieste.</p></div>}
      {correnti.length > 0 && <section className="blocco"><h2 className="lbl-sm">In corso e future</h2>{correnti.map(r => <CardRichiesta key={r.id} r={r} />)}</section>}
      {recenti.length > 0 && <section className="blocco"><h2 className="lbl-sm">Passate</h2>{recenti.map(r => <CardRichiesta key={r.id} r={r} />)}</section>}
      {!tutte && passate.length > recenti.length && <button className="back-link" onClick={() => setTutte(true)}>Mostra altre</button>}
    </>
  );
}

/** Dettaglio della richiesta, con storia e annullamento (solo se in valutazione). */
export function DettaglioRichiesta({ id }: { id: number }) {
  const { token, scaduta, ricarica } = useSessione();
  const nav = useNavigate();
  const { l, err, carica } = useRichieste();
  const [chiedi, setChiedi] = useState(false); const [invio, setInvio] = useState(false); const [errAnn, setErrAnn] = useState<string | null>(null);
  const indietro = <Link className="back-link" to="/t/ferie">Le mie richieste</Link>;
  if (err) return <><div className="ph-msg ko">{err}</div><button className="btn big" onClick={carica}>Riprova</button>{indietro}</>;
  if (!l) return <Attesa />;
  const r = l.find(x => x.id === id);
  if (!r) return <><div className="ph-msg warn">Questa richiesta non c'è più o non è tua.</div>{indietro}</>;
  const meta = metaDaNota(r.note);
  async function annulla() {
    setInvio(true); setErrAnn(null);
    try {
      await rpc('dipendente_annulla_richiesta', { p_token: token, p_id: r!.id });
      setChiedi(false); toast('Richiesta annullata'); ricarica(); carica();
    } catch (e) { if (sessioneScaduta(e)) scaduta(); else { setErrAnn(testoErrore(e)); setChiedi(false); } }
    finally { setInvio(false); }
  }
  const storia: { quando: string; testo: string }[] = [{ quando: r.creato_il, testo: r.creata_da === 'hr' ? "Registrata dall'ufficio personale" : 'Inviata' }];
  if (r.deciso_il && r.creata_da !== 'hr') storia.push({ quando: r.deciso_il, testo: r.stato === 'rifiutata' ? `Rifiutata · motivo: ${r.motivo_decisione ?? '—'}` : "Approvata dall'ufficio personale" });
  if (r.annullata_il) storia.push({ quando: r.annullata_il, testo: r.annullata_da === 'hr' ? `Annullata dall'ufficio personale${r.motivo_annullamento ? ` · motivo: ${r.motivo_annullamento}` : ''}` : 'Annullata da te' });
  const tipoTesto = nomeTipo(r.tipo, r.tipo_descrizione);
  return (
    <>
      {indietro}
      <div className="cr-testa"><h1 className="tec-h1">{tipoTesto}</h1><PillStato stato={r.stato} grande /></div>
      <span className="sub">Richiesta {r.numero}</span>
      <RiepilogoRichiesta conSaldo={false} d={{ tipo: r.tipo, tipoDescrizione: r.tipo_descrizione, unita: r.unita, primo: r.primo_giorno, ultimo: r.ultimo_giorno, rientro: r.rientro,
        oraInizio: r.ora_inizio, oraFine: r.ora_fine, mezza: r.mezza_giornata, meta, quantita: Number(r.quantita), note: notaPulita(r.note) }} />
      {r.stato === 'rifiutata' && r.motivo_decisione && <div className="ph-msg warn">Motivo: {r.motivo_decisione}</div>}
      <section className="tec-card">
        <div className="lbl-sm">Storia</div>
        <ol className="storia">{storia.map((s, i) => <li key={i}><b>{s.testo}</b><span className="sub">{momento(s.quando)}</span></li>)}</ol>
      </section>
      {errAnn && <div className="ph-msg ko" role="alert">{errAnn}</div>}
      {r.annullabile ? <button className="big-btn light" onClick={() => setChiedi(true)}>Annulla la richiesta</button>
        : (r.stato === 'approvata' || (r.stato === 'in_attesa' && !r.annullabile)) && <p className="sub">Per cambiare questa richiesta parla con l'ufficio personale.</p>}
      {r.stato === 'rifiutata' && <button className="big-btn light" onClick={() => nav('/t/ferie/nuova')}><IcoPiu /><span>Fai una nuova richiesta</span></button>}
      {chiedi && <Conferma titolo="Annullare la richiesta?" invio={invio}
        testo={(r.tipo === 'FERIE' ? `Le ferie di ${giornoLungo(r.primo_giorno)} non saranno più chieste. I giorni tornano nel tuo saldo.`
          : `La richiesta di ${tipoTesto.toLowerCase()} di ${giornoLungo(r.primo_giorno)} non sarà più valida.${r.unita === 'ore' ? ' Le ore tornano nel tuo saldo.' : ''}`)
          + ' Se ti serve ancora, dovrai rifarla.'}
        si="Sì, annulla" no="No, la tengo" onSi={annulla} onNo={() => setChiedi(false)} />}
      <span className="sub">Inviata il {giornoLungo(dataDaTs(r.creato_il))}</span>
    </>
  );
}
