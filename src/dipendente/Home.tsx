import { Link } from 'react-router-dom';
import { oggiISO } from '../lib/format';
import { InstallaApp } from '../Installa';
import { nomeTipo, useSessione, type Richiesta } from './api';
import { Attesa, CardRichiesta, IcoPiu, PillStato, RiquadroSaldo } from './componenti';
import { AttivaNotifiche, Notifiche } from './Notifiche';
import { giornoLungo } from './periodo';

export const prossimeApprovate = (l: Richiesta[]) => l.filter(r => r.stato === 'approvata' && r.primo_giorno > oggiISO()).sort((a, b) => a.primo_giorno.localeCompare(b.primo_giorno));
export const assenzaOggi = (l: Richiesta[]) => { const o = oggiISO(); return l.find(r => r.stato === 'approvata' && r.primo_giorno <= o && r.ultimo_giorno >= o) ?? null; };

/** Home dei dipendenti non tecnici (UX § 2.2). */
export default function HomeDipendente() {
  const { home, errore, ricarica } = useSessione();
  if (!home) return errore ? <><div className="ph-msg ko">{errore}</div><button className="btn big" onClick={ricarica}>Riprova</button></> : <Attesa />;
  const prossima = prossimeApprovate(home.richieste)[0];
  const inAttesa = home.richieste.filter(r => r.stato === 'in_attesa').sort((a, b) => a.primo_giorno.localeCompare(b.primo_giorno));
  const oggi = assenzaOggi(home.richieste);
  return (
    <>
      <Notifiche />
      {oggi && <div className="ph-msg info">{oggi.ora_inizio ? `Oggi hai un permesso dalle ${oggi.ora_inizio} alle ${oggi.ora_fine}.`
        : oggi.mezza_giornata ? 'Oggi sei assente per mezza giornata.'
        : `Oggi sei ${oggi.tipo === 'FERIE' ? 'in ferie' : 'assente'}. Torni al lavoro ${giornoLungo(oggi.rientro)}.`}</div>}
      <h1 className="tec-h1">Ciao {home.profilo.nome}</h1>
      <RiquadroSaldo saldi={home.saldi} variante="grande" inAttesa={home.in_attesa} />
      <Link className="big-btn primary" to="/t/ferie/nuova"><IcoPiu /><span>Chiedi ferie o permesso</span></Link>
      {prossima && <section className="blocco">
        <h2 className="lbl-sm">Le tue prossime {prossima.tipo === 'FERIE' ? 'ferie' : 'assenze'}</h2>
        <CardRichiesta r={prossima} compatta />
      </section>}
      {inAttesa.length > 0 && <section className="blocco">
        <h2 className="lbl-sm">In valutazione</h2>
        {inAttesa.slice(0, 2).map(r => <CardRichiesta key={r.id} r={r} compatta />)}
      </section>}
      {!prossima && !inAttesa.length && <p className="sub">Non hai richieste in corso.</p>}
      <Link className="link vedi-tutte" to="/t/ferie">Vedi tutte le richieste</Link>
      <AttivaNotifiche />
      <InstallaApp />
    </>
  );
}

/** Riquadro «Ferie e permessi» nella home del tecnico (UX § 2.3): mai rosso, il rosso resta al veicolo. */
export function RiquadroFerieTec() {
  const { home, errore } = useSessione();
  if (!home) return errore ? <section className="tec-card"><div className="lbl-sm">Ferie e permessi</div><p className="sub">Ferie non disponibili in questo momento. Riprova più tardi.</p></section> : null;
  const inAttesa = home.richieste.filter(r => r.stato === 'in_attesa');
  const prossima = prossimeApprovate(home.richieste)[0];
  return (
    <section className="tec-card">
      <div className="lbl-sm">Ferie e permessi</div>
      <RiquadroSaldo saldi={home.saldi} variante="compatto" />
      {inAttesa.length > 0 && <Link className="riga-link" to="/t/ferie"><span>In valutazione: {inAttesa.length === 1 ? '1 richiesta' : `${inAttesa.length} richieste`}</span><PillStato stato="in_attesa" /></Link>}
      {prossima && <Link className="riga-link" to={`/t/ferie/${prossima.id}`}><span>Prossima: {nomeTipo(prossima.tipo).toLowerCase()} da {giornoLungo(prossima.primo_giorno)}</span><PillStato stato="approvata" /></Link>}
      <Link className="big-btn light" to="/t/ferie/nuova"><IcoPiu /><span>Chiedi ferie o permesso</span></Link>
    </section>
  );
}
