import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { fmtGiorno, fmtOra } from '../lib/format';
import { useT } from '../lib/i18n';
import { attivaPush, statoPush, type StatoPush } from '../lib/push';
import { Targa } from '../ui';
import { nomeTipo, useSessione, type Notifica, type Richiesta } from './api';
import { metaDaNota } from './componenti';
import { giornoBreve, giornoLungo, intervallo } from './periodo';

const Ico = ({ d }: { d: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const IcoTel = () => <Ico d={<path d="M5 3.5h3.5l2 5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5 5 2V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5 1.5 1.5 0 0 1 5 3.5Z" />} />;

interface DatiPiano { data: string; veicolo?: { targa: string; modello: string } | null; veicolo_prima?: { targa: string } | null; interventi?: { ora: string | null; luogo: string; attivita: string }[]; aggiornato?: boolean; annullato?: boolean }
interface DatiAvviso { livello: 'urgente' | 'importante' | 'info'; titolo: string; testo?: string; ora?: string; luogo?: string; contatto?: string; telefono?: string; targa?: string; da?: string; categoria?: string; evento?: string; richiesta_id?: number }

/** Notifiche non lette in cima alla home (piano, avvisi, esiti delle richieste). Funzioni dipendente_notifiche / dipendente_notifica_letta. */
export function Notifiche() {
  const { t, locale } = useT();
  const { token, home, ricarica } = useSessione();
  const [l, setL] = useState<Notifica[]>([]);
  const [aperta, setAperta] = useState<number | null>(null);
  const carica = useCallback(() => { rpc<Notifica[]>('dipendente_notifiche', { p_token: token }).then(setL).catch(() => {}); }, [token]);
  useEffect(() => { carica(); const k = window.setInterval(carica, 45000); return () => window.clearInterval(k); }, [carica]);
  // una nuova decisione arrivata mentre l'app è aperta: aggiorna anche saldi e richieste
  const nuoveFerie = l.filter(n => !n.letta && (n.dati as { categoria?: string }).categoria === 'ferie').map(n => n.id).join(',');
  useEffect(() => { if (nuoveFerie) ricarica(); }, [nuoveFerie, ricarica]);
  const nonLette = l.filter(n => !n.letta).slice(0, 6);
  if (!nonLette.length) return null;
  async function letta(id: number) {
    try { await rpc('dipendente_notifica_letta', { p_token: token, p_id: id }); } catch { /* riprova al prossimo caricamento */ }
    setAperta(null); setL(x => x.map(n => (n.id === id ? { ...n, letta: true } : n)));
  }
  return <>{nonLette.map(n => {
    const d = n.dati as unknown as DatiAvviso;
    if (n.tipo === 'avviso' && d.categoria === 'ferie') return <NotificaFerie key={n.id} n={n} d={d} richieste={home?.richieste ?? []} onVisto={() => letta(n.id)} />;
    if (n.tipo === 'avviso') {
      const ap = aperta === n.id || d.livello !== 'urgente';
      return (
        <section key={n.id} className={`tec-card avviso ${d.livello}`}>
          <div className="lbl-sm">{d.livello === 'urgente' ? t('URGENTE') : d.livello === 'importante' ? t('Importante') : t('Avviso')} · {fmtOra(n.creato_il, locale)}{d.da ? ` · ${d.da}` : ''}</div>
          <div className="tec-h2">{d.titolo}</div>
          {!ap ? <button className="btn big avviso-apri" onClick={() => setAperta(n.id)}>{t('Apri e leggi')}</button> : <>
            {(d.ora || d.luogo) && <div className="avviso-righe">
              {d.ora && <div><span className="lbl-sm">{t('Quando')}</span><b>{d.ora}</b></div>}
              {d.luogo && <div><span className="lbl-sm">{t('Dove')}</span><b>{d.luogo}</b>
                <a className="link-mappa" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.luogo)}`} target="_blank" rel="noopener noreferrer">{t('Apri mappa')}</a></div>}
            </div>}
            {d.testo && <p className="avviso-testo">{d.testo}</p>}
            {(d.contatto || d.telefono) && <div className="avviso-righe"><div><span className="lbl-sm">{t('Contatto')}</span><b>{d.contatto}</b>
              {d.telefono && <a className="big-btn light" href={`tel:${d.telefono.replace(/\s/g, '')}`}><IcoTel /><span dir="ltr">{d.telefono}</span></a>}</div></div>}
            {d.targa && <div className="row-flex"><span>{t('Veicolo:')}</span><Targa t={d.targa} /></div>}
            <button className="btn brand big" onClick={() => letta(n.id)}>✓ {t('Ricevuto')}</button>
          </>}
        </section>
      );
    }
    if (n.tipo === 'piano') {
      const p = n.dati as unknown as DatiPiano;
      return (
        <section key={n.id} className={`tec-card notifica ${p.aggiornato || p.annullato ? 'cambio' : ''}`}>
          <div className="lbl-sm">{p.annullato ? t('Piano annullato') : p.aggiornato ? t('Piano modificato') : t('Nuovo piano di lavoro')} · {fmtOra(n.creato_il, locale)}</div>
          <div className="tec-h2">{fmtGiorno(p.data, locale)}</div>
          {p.annullato ? <p>{t('Non hai più attività o veicolo per questo giorno.')}</p> : <>
            <div className="row-flex"><span>{t('Veicolo:')}</span>{p.veicolo ? <><Targa t={p.veicolo.targa} big /><span className="sub">{p.veicolo.modello}</span></> : <b>{t('non assegnato')}</b>}</div>
            {p.veicolo_prima && <div className="ph-msg warn">{t('Prima era {t}: usa il nuovo veicolo.', { t: p.veicolo_prima.targa })}</div>}
            {(p.interventi ?? []).map((i, k) => <div key={k} className="int"><span className="h">{i.ora ?? '—'}</span><span>{i.luogo}<div className="sub">{i.attivita}</div></span></div>)}
          </>}
          <button className="btn brand big" onClick={() => letta(n.id)}>✓ {t('Ho visto')}</button>
        </section>
      );
    }
    const s = n.dati as { targa?: string; nota?: string };
    return (
      <section key={n.id} className="tec-card notifica">
        <div className="lbl-sm">{t('Problema risolto')} · {fmtOra(n.creato_il, locale)}</div>
        <div className="row-flex"><Targa t={s.targa} /> <span>{s.nota}</span></div>
        <button className="btn brand big" onClick={() => letta(n.id)}>✓ {t('Ho visto')}</button>
      </section>
    );
  })}</>;
}

/** Esito di una richiesta (UX § 2.16). Mai rosso urgente: non sono emergenze. */
function NotificaFerie({ n, d, richieste, onVisto }: { n: Notifica; d: DatiAvviso; richieste: Richiesta[]; onVisto: () => void }) {
  const r = richieste.find(x => x.id === d.richiesta_id);
  const ev = d.evento;
  const registrata = ev === 'approvata' && r?.creata_da === 'hr';
  const etichetta = registrata ? 'Assenza registrata' : ev === 'approvata' ? 'Richiesta approvata' : ev === 'rifiutata' ? 'Richiesta rifiutata' : ev === 'annullata' ? 'Assenza annullata' : 'Ufficio personale';
  const titolo = r ? `${nomeTipo(r.tipo, r.tipo_descrizione)} · ${r.ora_inizio ? `${giornoBreve(r.primo_giorno)} · ${r.ora_inizio}–${r.ora_fine}`
      : r.mezza_giornata ? `${giornoBreve(r.primo_giorno)}, ${metaDaNota(r.note) ? `la ${metaDaNota(r.note)}` : 'mezza giornata'}` : intervallo(r.primo_giorno, r.ultimo_giorno, true)}` : d.titolo;
  const intera = r && !r.ora_inizio && !r.mezza_giornata;
  let testo: ReactNode = d.testo;
  if (registrata) testo = "L'ufficio personale ha registrato questa assenza per te.";
  else if (ev === 'approvata' && r) testo = intera ? `Torni al lavoro ${giornoLungo(r.rientro)}.${r.tipo === 'FERIE' ? ' Buone ferie!' : ''}` : 'La tua richiesta è approvata.';
  else if (ev === 'rifiutata' && r) testo = r.motivo_decisione ? `Motivo: ${r.motivo_decisione}` : d.testo;
  else if (ev === 'annullata') testo = "L'ufficio personale ha annullato questa assenza. Se hai dubbi, chiamalo.";
  return (
    <section className={`tec-card notifica ${ev === 'approvata' ? 'ok' : 'cambio'}`}>
      <div className="lbl-sm">{etichetta} · {fmtOra(n.creato_il)}</div>
      <div className="tec-h2">{titolo}</div>
      {testo && <p>{testo}</p>}
      <button className="btn brand big" onClick={onVisto}>✓ Ho visto</button>
      <div className="row-flex" style={{ gap: 16 }}>
        {d.richiesta_id && <Link className="link" to={`/t/ferie/${d.richiesta_id}`} onClick={onVisto}>Apri la richiesta</Link>}
        {ev === 'rifiutata' && <Link className="link" to="/t/ferie/nuova" onClick={onVisto}>Fai una nuova richiesta</Link>}
      </div>
    </section>
  );
}

/** Attivazione delle notifiche push sul telefono (dipendente_salva_push). */
export function AttivaNotifiche({ sempre = false }: { sempre?: boolean }) {
  const { t, lingua } = useT();
  const { token, home } = useSessione();
  const [s, setS] = useState<StatoPush | null>(null);
  useEffect(() => { statoPush().then(setS).catch(() => setS('non_supportate')); }, []);
  if (!s || s === 'non_supportate' || (s === 'attive' && !sempre)) return null;
  async function attiva() {
    try { setS(await attivaPush((e, p, a) => rpc('dipendente_salva_push', { p_token: token, p_endpoint: e, p_p256dh: p, p_auth: a, p_lingua: lingua }))); }
    catch { setS('da_attivare'); }
  }
  return (
    <section className="tec-card">
      <div className="lbl-sm">{t('Notifiche sul telefono')}</div>
      {s === 'attive' ? <p>Le notifiche sono attive su questo dispositivo.</p>
        : s === 'serve_home' ? <p>{t('Su iPhone: premi Condividi e poi "Aggiungi alla schermata Home". Apri l\'app dalla Home e attiva le notifiche.')}</p>
        : s === 'negate' ? <p>{t('Le notifiche sono bloccate. Attivale dalle impostazioni del browser per questo sito.')}</p>
        : <><p>{home?.tec ? "Ricevi un avviso quando il responsabile conferma il tuo veicolo e quando l'ufficio personale risponde alle tue richieste."
              : "Ricevi un avviso quando l'ufficio personale risponde alle tue richieste."}</p>
            <button className="btn big" onClick={attiva}>{t('Attiva le notifiche')}</button></>}
    </section>
  );
}
