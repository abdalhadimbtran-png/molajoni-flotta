import { useCallback, useEffect, useState } from 'react';
import { rpc, testoErrore } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { sessioneScaduta } from '../dipendente/api';
import { MINUTI_RITARDO, MOTIVI_RITARDO, mapsLink, type TappaStima } from '../lib/variazioni/giornata';

interface Urg { id: number; luogo: string; indirizzo: string; attivita: string; note: string | null; arrivo: string; lat: number | null; lon: number | null; letta: boolean }
interface Dati { data: string; tappe: TappaStima[]; corrente: string | null; fine_stimata: string | null; ritardo_tot: number;
  finita: { alle: string; tutto_fatto: boolean } | null; ritardi: { key: string; motivo: string; minuti: number; alle: string }[]; urgenze: Urg[] }

/**
 * La giornata di oggi del tecnico: banner urgenze, orari pianificati / stimati, «Segnala ritardo» sull'intervento in corso
 * e «Giornata finita» una volta a fine giornata. Nessun «arrivato / finito» per intervento.
 */
export default function GiornataOggi({ token, onScaduta }: { token: string; onScaduta: () => void }) {
  const { t, tm } = useT();
  const [g, setG] = useState<Dati | null>(null); const [err, setErr] = useState<string | null>(null);
  const [modo, setModo] = useState<'ritardo' | 'fine' | null>(null);
  const carica = useCallback(() => {
    rpc<Dati>('tecnico_giornata', { p_token: token }).then(x => { setG(x); setErr(null); })
      .catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, onScaduta]);
  useEffect(() => { carica(); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  if (err) return <div className="ph-msg ko">{tm(err)}</div>;
  if (!g || (!g.tappe.length && !g.urgenze.length)) return null;
  const corr = g.tappe.find(x => x.key === g.corrente) ?? null;

  async function letta(id: number) {
    try { await rpc('tecnico_urgenza_letta', { p_token: token, p_id: id }); } catch { /* riprova */ }
    carica();
  }

  return (
    <>
      {g.urgenze.filter(u => !u.letta).map(u => (
        <section key={u.id} className="tec-card avviso urgente">
          <div className="lbl-sm">{t('URGENTE')}</div>
          <div className="tec-h2">{t("Dopo l'intervento in corso vai a: {l}", { l: u.luogo })}</div>
          <p><b>{u.attivita}</b>{u.note ? ` · ${u.note}` : ''}</p>
          <p className="sub">{u.indirizzo} · {t('arrivo previsto {o}', { o: u.arrivo })}</p>
          <a className="big-btn light" href={mapsLink(u)} target="_blank" rel="noopener noreferrer">{t('Apri in Google Maps')}</a>
          <button className="btn brand big" onClick={() => letta(u.id)}>✓ {t('Ho letto')}</button>
        </section>
      ))}

      <section className="tec-card">
        <div className="lbl-sm">{t('La tua giornata')}{g.ritardo_tot ? ` · ${t('ritardo {n} min', { n: g.ritardo_tot })}` : ''}</div>
        {g.tappe.map(x => {
          const cambiato = x.arrivo_stimato !== x.arrivo || x.partenza_stimata !== x.partenza;
          return (
            <div key={x.key} className={`int${x.urgente ? ' int-urg' : ''}`} style={x.key === g.corrente && !g.finita ? { fontWeight: 600 } : undefined}>
              <span className="h">{cambiato ? <><s className="sub">{x.arrivo}</s> {x.arrivo_stimato}</> : x.arrivo}</span>
              <span>{x.urgente && <span className="badge-urg">{t('URGENTE')}</span>}{x.luogo}<div className="sub">{x.attivita}{cambiato ? ` · ${t('orario stimato')}` : ''}</div></span>
            </div>);
        })}
        {g.fine_stimata && <p className="sub">{t('Fine giornata stimata: {o}', { o: g.fine_stimata })}</p>}

        {g.finita ? <div className="ph-msg ok">{t('Giornata finita alle {o}', { o: g.finita.alle })}</div> : <>
          {corr && modo !== 'ritardo' && <button className="big-btn light" onClick={() => setModo('ritardo')}>⏱ {t('Segnala ritardo')}<span className="sub">{corr.luogo}</span></button>}
          {modo === 'ritardo' && corr && <FormRitardo token={token} tappa={corr} onFatto={() => { setModo(null); carica(); }} onAnnulla={() => setModo(null)} onScaduta={onScaduta} />}
          {modo !== 'fine' && <button className="btn brand big" onClick={() => setModo('fine')}>{t('Giornata finita')}</button>}
          {modo === 'fine' && <FormFine token={token} tappe={g.tappe} onFatto={() => { setModo(null); carica(); }} onAnnulla={() => setModo(null)} onScaduta={onScaduta} />}
        </>}
      </section>
    </>
  );
}

function FormRitardo({ token, tappa, onFatto, onAnnulla, onScaduta }: { token: string; tappa: TappaStima; onFatto: () => void; onAnnulla: () => void; onScaduta: () => void }) {
  const { t, tm } = useT();
  const [motivo, setMotivo] = useState(''); const [min, setMin] = useState<number | null>(null); const [altro, setAltro] = useState(''); const [nota, setNota] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  const minuti = min === -1 ? Number(altro) : min;
  async function invia() {
    setMsg(null);
    if (!motivo) { setMsg(t('Scegli il motivo.')); return; }
    if (!minuti || minuti < 1) { setMsg(t('Scegli quanti minuti.')); return; }
    setInvio(true);
    try { await rpc('tecnico_segnala_ritardo', { p_token: token, p_key: tappa.key, p_motivo: motivo, p_minuti: minuti, p_nota: nota || null }); onFatto(); }
    catch (e) { if (sessioneScaduta(e)) onScaduta(); else setMsg(tm(testoErrore(e))); }
    finally { setInvio(false); }
  }
  return (
    <div className="form">
      <h2>{t('Segnala ritardo')}</h2>
      <p className="sub">{tappa.luogo}</p>
      <div className="field"><span className="lbl-sm">1 · {t('Perché?')}</span>
        <div className="cat-grid">{MOTIVI_RITARDO.map(([k, l]) => <button type="button" key={k} className={motivo === k ? 'on' : ''} onClick={() => setMotivo(k)}>{t(l)}</button>)}</div></div>
      {motivo === 'altro' && <div className="field"><label htmlFor="rit-nota">{t('Scrivi il motivo')}</label><input id="rit-nota" value={nota} onChange={e => setNota(e.target.value)} /></div>}
      <div className="field"><span className="lbl-sm">2 · {t('Quanti minuti?')}</span>
        <div className="scelte">{MINUTI_RITARDO.map(m => <button type="button" key={m} className={min === m ? 'on' : ''} onClick={() => setMin(m)}>{m}</button>)}
          <button type="button" className={min === -1 ? 'on' : ''} onClick={() => setMin(-1)}>{t('Altro')}</button></div>
        {min === -1 && <input className="km-input" type="number" inputMode="numeric" min={1} max={600} value={altro} onChange={e => setAltro(e.target.value)} placeholder={t('minuti')} />}</div>
      {msg && <div className="ph-msg ko">{msg}</div>}
      <button className="btn brand big" disabled={invio} onClick={invia}>{t('Invia')}</button>
      <button type="button" className="back-link" onClick={onAnnulla}>{t('Annulla')}</button>
    </div>
  );
}

function FormFine({ token, tappe, onFatto, onAnnulla, onScaduta }: { token: string; tappe: TappaStima[]; onFatto: () => void; onAnnulla: () => void; onScaduta: () => void }) {
  const { t, tm } = useT();
  const [tutto, setTutto] = useState<boolean | null>(null); const [nf, setNf] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  async function invia() {
    if (tutto === null) { setMsg(t('Rispondi: tutto fatto?')); return; }
    if (!tutto && !nf.length) { setMsg(t('Tocca gli interventi non fatti.')); return; }
    setInvio(true); setMsg(null);
    try { await rpc('tecnico_giornata_finita', { p_token: token, p_tutto_fatto: tutto, p_non_fatti: tutto ? [] : nf, p_nota: null }); onFatto(); }
    catch (e) { if (sessioneScaduta(e)) onScaduta(); else setMsg(tm(testoErrore(e))); }
    finally { setInvio(false); }
  }
  return (
    <div className="form">
      <h2>{t('Tutto fatto?')}</h2>
      <div className="okko">
        <button type="button" className={`ok ${tutto === true ? 'on' : ''}`} onClick={() => setTutto(true)}>{t('Sì')}</button>
        <button type="button" className={`ko ${tutto === false ? 'on' : ''}`} onClick={() => setTutto(false)}>{t('No')}</button>
      </div>
      {tutto === false && <div className="field"><span className="lbl-sm">{t('Cosa non hai fatto?')}</span>
        <div className="cat-grid">{tappe.map(x => <button type="button" key={x.key} className={nf.includes(x.key) ? 'on' : ''}
          onClick={() => setNf(nf.includes(x.key) ? nf.filter(k => k !== x.key) : [...nf, x.key])}>{x.luogo}</button>)}</div></div>}
      {msg && <div className="ph-msg ko">{msg}</div>}
      <button className="btn brand big" disabled={invio} onClick={invia}>{t('Conferma: giornata finita')}</button>
      <button type="button" className="back-link" onClick={onAnnulla}>{t('Annulla')}</button>
    </div>
  );
}
