import { FormEvent, useEffect, useState } from 'react';
import { fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { rpc, testoErrore } from '../../lib/supabase';
import { Caricamento, Errore, Pill, toast, useLoad } from '../../ui';

interface Mail { id: number; destinatario: string | null; oggetto: string; stato: string; errore: string | null; creato_il: string }
interface Imp { impostazioni: Record<string, string | null>; ultime_email: Mail[] }

const STATI: Record<string, { l: string; s: 'ok' | 'warn' | 'ko' | 'na' }> = {
  inviata: { l: 'Inviata', s: 'ok' }, in_coda: { l: 'In coda', s: 'na' }, errore: { l: 'Errore', s: 'ko' },
  in_attesa_configurazione: { l: 'Chiave Resend mancante', s: 'warn' }, saltata: { l: 'Saltata', s: 'na' },
};

/** Indirizzo dell'ufficio personale che riceve un'email per ogni nuova richiesta di ferie o permesso. */
export default function EmailNotifiche() {
  const { t, tm, locale } = useT();
  const { data, errore, reload } = useLoad(() => rpc<Imp>('admin_get_impostazioni', {}));
  const [email, setEmail] = useState('');
  const [occupato, setOccupato] = useState(false);
  useEffect(() => { if (data) setEmail(data.impostazioni.email_hr ?? ''); }, [data]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;

  async function salva(e: FormEvent) {
    e.preventDefault(); setOccupato(true);
    try { await rpc('admin_salva_impostazione', { p_chiave: 'email_hr', p_valore: email }); toast(t('Indirizzo salvato')); reload(); }
    catch (x) { toast(tm(testoErrore(x))); }
    finally { setOccupato(false); }
  }
  async function prova() {
    setOccupato(true);
    try { await rpc('admin_invia_email_prova', {}); toast(t('Email di prova in invio')); setTimeout(reload, 4000); }
    catch (x) { toast(tm(testoErrore(x))); }
    finally { setOccupato(false); }
  }

  return (
    <>
      <div className="section-title">{t('Email notifiche ferie')} <span className="meta">{t('un\'email all\'ufficio personale per ogni nuova richiesta')}</span></div>
      <div className="panel">
        <form onSubmit={salva}>
          <div className="field"><label htmlFor="email-hr">{t('Email dell\'ufficio personale')}</label>
            <input id="email-hr" type="email" dir="ltr" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" type="submit" disabled={occupato}>{t('Salva')}</button>
            <button className="btn-ghost btn-sm" type="button" disabled={occupato || email !== (data.impostazioni.email_hr ?? '')} onClick={prova}>{t('Invia email di prova')}</button>
          </div>
        </form>
        {data.ultime_email.length > 0 && <ul className="sub" style={{ marginTop: 12, paddingInlineStart: 18 }}>
          {data.ultime_email.map(m => (
            <li key={m.id}><span className="mono">{fmtOra(m.creato_il, locale)}</span> · {m.oggetto} · <Pill s={(STATI[m.stato] ?? STATI.saltata).s}>{t((STATI[m.stato] ?? STATI.saltata).l)}</Pill></li>))}
        </ul>}
      </div>
    </>
  );
}
