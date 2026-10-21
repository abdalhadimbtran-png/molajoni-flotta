import { InstallaApp } from '../Installa';
import { nomeTipo, useSessione, type Saldo } from './api';
import { Attesa } from './componenti';
import { AttivaNotifiche } from './Notifiche';
import { dataLunga, fmtSaldo, num } from './periodo';

const CATEGORIE: Record<string, string> = { TEC: 'Tecnico', UFFICIO: 'Ufficio', MAGAZZINO: 'Magazzino', ALTRO: 'Altro' };

function BloccoSaldo({ s }: { s: Saldo }) {
  const u = s.unita;
  const v = (n: number) => <b className={n < 0 ? 'neg' : undefined}>{num(Number(n))}</b>;
  return (
    <div className="saldo-dett">
      <div className="saldo-dett-t"><b>{nomeTipo(s.tipo, s.descrizione)}</b><span className="sub">{u === 'ore' ? 'in ore' : 'in giorni'}</span></div>
      <div className="mini-stat">
        {Number(s.saldo_iniziale) !== 0 && <span>{s.origine === 'saldo_iniziale' ? 'Saldo di partenza' : "Dall'anno scorso"}{v(s.saldo_iniziale)}</span>}
        <span>Maturate quest'anno{v(s.maturato)}</span>
        <span>Usate o già approvate{v(s.goduto)}</span>
        {Number(s.rettifiche) !== 0 && <span>Correzioni dell'ufficio{v(s.rettifiche)}</span>}
        {Number(s.in_attesa) > 0 && <span>In valutazione{v(s.in_attesa)}</span>}
        <span className="totale">Ti restano{v(s.saldo)}</span>
      </div>
      {Number(s.quota_mensile) > 0 && <span className="sub">Maturi {fmtSaldo(Number(s.quota_mensile), u)} ogni mese. A fine anno avrai {fmtSaldo(Number(s.saldo_fine_anno), u)} (senza nuove richieste).</span>}
    </div>
  );
}

/** Profilo in sola lettura (UX § 2.6). «Esci» sta qui, così non si tocca per sbaglio. */
export default function Profilo() {
  const { home, errore, esci } = useSessione();
  if (!home) return <>{errore ? <div className="ph-msg ko">{errore}</div> : <Attesa />}<button className="big-btn light" onClick={esci}>Esci</button></>;
  const p = home.profilo;
  return (
    <>
      <div>
        <h1 className="tec-h1">{p.nome} {p.cognome}</h1>
        <p className="sub">Codice {p.codice} · {p.reparto || CATEGORIE[p.categoria] || p.categoria}</p>
      </div>
      <section className="tec-card">
        <div className="lbl-sm">Il tuo saldo · {home.anno}</div>
        {home.saldi.length ? home.saldi.map(s => <BloccoSaldo key={s.tipo} s={s} />) : <p>Il tuo saldo non è ancora pronto.</p>}
        {home.saldi[0] && <span className="sub">Aggiornato al {dataLunga(home.saldi[0].alla_data)}.</span>}
      </section>
      <section className="tec-card">
        <div className="lbl-sm">I tuoi dati</div>
        <dl className="riepilogo dati">
          <dt>Categoria</dt><dd>{CATEGORIE[p.categoria] ?? p.categoria}</dd>
          {p.reparto && <><dt>Reparto</dt><dd>{p.reparto}</dd></>}
          {p.ruolo && <><dt>Ruolo</dt><dd>{p.ruolo}</dd></>}
          {p.contratto && <><dt>Contratto</dt><dd>{p.contratto === 'part-time' ? 'Part-time' : 'Tempo pieno'} · {num(Number(p.ore_giornaliere))} ore al giorno</dd></>}
          {p.data_assunzione && <><dt>In azienda dal</dt><dd>{dataLunga(p.data_assunzione)}</dd></>}
          {p.telefono && <><dt>Telefono</dt><dd>{p.telefono}</dd></>}
          {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
        </dl>
        <span className="sub">Vedi un dato sbagliato? Avvisa l'ufficio personale.</span>
      </section>
      <AttivaNotifiche sempre />
      <InstallaApp />
      <p className="sub">Hai dimenticato il PIN? Chiedi un nuovo PIN all'ufficio personale{home.tec ? ' o al responsabile flotta' : ''}.</p>
      <button className="big-btn light esci-btn" onClick={esci}>Esci</button>
    </>
  );
}
