import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { InstallaApp } from '../Installa';
import type { LoginRisposta } from './api';

const largo = () => { try { return window.matchMedia('(min-width: 900px)').matches; } catch { return false; } };

/** Testi del server tradotti nelle frasi dell'app (UX § 2.1). */
function messaggio(e: string): string {
  if (/non validi/i.test(e)) return 'Codice o PIN non corretti. Controlla e riprova.';
  if (/troppi tentativi/i.test(e)) return "Troppi tentativi sbagliati. Riprova tra 15 minuti oppure chiama l'ufficio personale.";
  if (/non (è )?attiv/i.test(e)) return "Il tuo accesso non è attivo. Chiama l'ufficio personale.";
  return e;
}

/** Accesso unico per tutti i dipendenti: codice + PIN (dipendente_login). */
export default function Accesso({ onOk, conVeicolo }: { onOk: (r: LoginRisposta, condiviso: boolean) => void; conVeicolo: boolean }) {
  const [codice, setCodice] = useState(''); const [pin, setPin] = useState('');
  const [condiviso, setCondiviso] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  async function invia(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const r = await rpc<LoginRisposta>('dipendente_login', { p_codice: codice, p_pin: pin });
      if (r.ok && r.token) onOk(r, condiviso);
      else { setErr(messaggio(r.errore ?? 'Accesso non riuscito.')); setPin(''); }
    } catch (x) { setErr(messaggio(testoErrore(x))); }
    finally { setInvio(false); }
  }
  return (
    <div className="accesso-dip">
      <div className="tec-hero">
        <div className="tec-hero-t">{conVeicolo ? 'La tua giornata e il tuo veicolo, in un QR.' : 'Ferie, permessi e la tua giornata di lavoro.'}</div>
      </div>
      <form className="tec-card form" onSubmit={invia}>
        <h1 className="tec-h1">Accedi</h1>
        <p className="sub">{conVeicolo ? "Accedi una volta: poi il QR del veicolo ti porta direttamente all'operazione." : "Codice e PIN te li dà l'ufficio personale."}</p>
        <div className="field"><label htmlFor="cod">Codice</label>
          <input id="cod" dir="ltr" autoCapitalize="characters" autoComplete="username" required value={codice} onChange={e => setCodice(e.target.value.toUpperCase())} /></div>
        <div className="field"><label htmlFor="pin">PIN</label>
          <input id="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} required value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
        {largo() && <label className="check-condiviso"><input type="checkbox" checked={condiviso} onChange={e => setCondiviso(e.target.checked)} />
          <span>Sono su un computer condiviso<span className="sub">L'accesso finisce quando chiudi il browser.</span></span></label>}
        {err && <div className="ph-msg ko" role="alert">{err}</div>}
        <button className="btn brand big" disabled={invio}>{invio ? 'Accesso…' : 'Accedi'}</button>
        <InstallaApp />
        {!conVeicolo && <>
          <div className="oppure"><span>oppure</span></div>
          <Link className="big-btn light" to="/t/scansiona">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-4M17 21v-2" /></svg>
            <span>Sei un tecnico? Scansiona il QR del veicolo</span></Link>
        </>}
      </form>
      <p className="tec-foot">Problemi di accesso? Chiama l'ufficio personale.<br />
        <Link className="link" to="/accesso">Lavori in ufficio con email e password? Accesso ufficio</Link></p>
    </div>
  );
}
