import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { rpc, testoErrore } from '../lib/supabase';
import { CARBURANTE, CATEGORIE, GRAVITA, STATI_SEGN, TIPI_DOC, fmtGiorno, fmtKm, fmtOra, lblCarb, type Messaggio } from '../lib/format';
import { SceltaLingua, useT } from '../lib/i18n';
import { Logo, Pill, Targa } from '../ui';
import { URL_FUNZIONI, attivaPush, comprimiFoto, registraSW, statoPush, type StatoPush } from '../lib/push';

const CHIAVE = 'molajoni_flotta_token';
const leggiToken = () => { try { return localStorage.getItem(CHIAVE); } catch { return null; } };
const scriviToken = (t: string | null) => { try { if (t) localStorage.setItem(CHIAVE, t); else localStorage.removeItem(CHIAVE); } catch { /* nulla */ } };
const sessioneScaduta = (e: unknown) => testoErrore(e).includes('SESSIONE_NON_VALIDA');

/* Icone semplici, riconoscibili senza leggere */
const Ico = ({ d }: { d: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const IcoPrendo = () => <Ico d={<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M17 6l2 2M15 8l2 2" /></>} />;
const IcoRiconsegno = () => <Ico d={<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>} />;
const IcoKm = () => <Ico d={<><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 14 4-5" /><circle cx="12" cy="14" r="1.2" /></>} />;
const IcoAllarme = () => <Ico d={<><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>} />;
const IcoQr = () => <Ico d={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-4M17 21v-2" /></>} />;
const IcoFoto = () => <Ico d={<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>} />;
const IcoDoc = () => <Ico d={<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>} />;
const IcoLista = () => <Ico d={<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>} />;

/** Contenitore dell'app tecnico: accesso con codice + PIN, poi le pagine. */
export default function Tecnico() {
  const { t } = useT();
  const [token, setToken] = useState<string | null>(leggiToken);
  const { qr } = useParams();
  const loc = useLocation();
  const esci = useCallback(() => { scriviToken(null); setToken(null); }, []);
  useEffect(() => { registraSW(); }, []);
  const pagina = loc.pathname.startsWith('/t/scansiona') ? 'scan' : loc.pathname.startsWith('/t/elenco') ? 'elenco' : qr ? 'veicolo' : 'home';
  return (
    <div className="tec">
      <div className="tec-bar">
        <Link to="/t" aria-label={t('La mia giornata')}><Logo chiaro /></Link>
        <div className="row-flex" style={{ gap: 8 }}>
          <SceltaLingua chiaro />
          {token && <button className="esci" onClick={async () => { try { await rpc('tecnico_logout', { p_token: token }); } catch { /* già scaduta */ } esci(); }}>{t('Esci')}</button>}
        </div>
      </div>
      <main className="tec-main">
        {pagina === 'scan' && !token ? <Scanner />
          : !token ? <Login onOk={x => { scriviToken(x); setToken(x); }} conVeicolo={!!qr} />
          : pagina === 'veicolo' ? <Veicolo token={token} qr={qr!} onScaduta={esci} />
          : pagina === 'scan' ? <Scanner />
          : pagina === 'elenco' ? <Elenco token={token} onScaduta={esci} />
          : <Home token={token} onScaduta={esci} />}
      </main>
    </div>
  );
}

function Login({ onOk, conVeicolo }: { onOk: (t: string) => void; conVeicolo: boolean }) {
  const { t, tm } = useT();
  const [codice, setCodice] = useState(''); const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  async function invia(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const r = await rpc<{ ok: boolean; token?: string; errore?: string }>('tecnico_login', { p_codice: codice, p_pin: pin });
      if (r.ok && r.token) onOk(r.token); else { setErr(tm(r.errore ?? 'Accesso non riuscito.')); setPin(''); }
    } catch (x) { setErr(tm(testoErrore(x))); }
    finally { setInvio(false); }
  }
  return (
    <form className="tec-card form" onSubmit={invia}>
      <h1 className="tec-h1">{t('Accedi')}</h1>
      <p className="sub">{conVeicolo ? t("Accedi una volta: poi il QR del veicolo ti porta direttamente all'operazione.") : t('Codice e PIN te li dà il responsabile flotta.')}</p>
      <div className="field"><label htmlFor="cod">{t('Codice')}</label><input id="cod" dir="ltr" autoCapitalize="characters" autoComplete="username" required value={codice} onChange={e => setCodice(e.target.value.toUpperCase())} /></div>
      <div className="field"><label htmlFor="pin">{t('PIN')}</label><input id="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
      {err && <div className="ph-msg ko">{err}</div>}
      <button className="btn brand big" disabled={invio}>{invio ? t('Accesso…') : t('Accedi')}</button>
      {!conVeicolo && <>
        <div className="oppure"><span>{t('oppure')}</span></div>
        <Link className="big-btn light" to="/t/scansiona"><IcoQr /><span>{t('Scansiona il QR del veicolo')}<span className="sub">{t('Dopo la scansione inserisci codice e PIN')}</span></span></Link>
      </>}
    </form>
  );
}

interface Giorno { data: string; confermato: boolean; assenza: string | null; veicolo: { targa: string; modello: string; qr: string } | null; interventi: { ora: string | null; luogo: string; attivita: string }[] }
interface HomeDati { nome: string; codice: string; avvisi: Messaggio[];
  in_carico: { targa: string; modello: string; km: number; dal: string; qr: string }[];
  giorni: Giorno[];
  segnalazioni: { targa: string; categoria: string; gravita: string; stato: string; creato_il: string; nota_chiusura: string | null }[] }

function Home({ token, onScaduta }: { token: string; onScaduta: () => void }) {
  const { t, tm, locale } = useT();
  const [h, setH] = useState<HomeDati | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    rpc<HomeDati>('tecnico_home', { p_token: token }).then(setH).catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, onScaduta]);
  if (err) return <div className="ph-msg ko">{tm(err)}</div>;
  if (!h) return <p className="sub">{t('Caricamento…')}</p>;
  const mio = h.in_carico[0];
  const oggi = h.giorni[0];
  const daAprire = mio ? null : oggi?.veicolo;
  return (
    <>
      <h1 className="tec-h1">{t('Ciao {n}', { n: h.nome.split(' ')[0] })}</h1>
      {h.avvisi.map((a, i) => <div key={i} className={`ph-msg ${a.l}`}>{tm(a.m)}</div>)}
      <Notifiche token={token} />
      <AttivaNotifiche token={token} />

      {mio && (
        <section className="tec-card tec-oggi">
          <div className="lbl-sm">{t('Veicolo in carico')}</div>
          <div className="tec-veh-head"><Targa t={mio.targa} big /><span className="sub">{mio.modello} · {fmtKm(mio.km)} km · {t('dal {d}', { d: fmtOra(mio.dal, locale) })}</span></div>
          <Link className="big-btn primary" to={`/t/v/${mio.qr}`}><IcoRiconsegno />{t('Apri il veicolo')}</Link>
        </section>
      )}
      {daAprire && (
        <section className="tec-card tec-oggi">
          <div className="lbl-sm">{t('Il tuo veicolo di oggi')}</div>
          <div className="tec-veh-head"><Targa t={daAprire.targa} big /><span className="sub">{daAprire.modello}</span></div>
          <Link className="big-btn primary" to={`/t/v/${daAprire.qr}`}><IcoPrendo />{t('Apri il veicolo')}</Link>
        </section>
      )}

      <Link className={`big-btn ${mio || daAprire ? 'light' : 'primary'}`} to="/t/scansiona"><IcoQr /><span>{t('Scansiona il QR del veicolo')}</span></Link>
      <Link className="big-btn light" to="/t/elenco"><IcoLista /><span>{t('Il QR non si legge? Scegli il veicolo')}</span></Link>

      {h.giorni.map((g, k) => (
        <section key={g.data} className="tec-card">
          <div className="lbl-sm">{k === 0 ? t('Oggi') : t('Prossimo giorno lavorativo')} · {fmtGiorno(g.data, locale)}</div>
          {g.assenza ? <p>{t(g.assenza)}</p> : <>
            <div className="row-flex"><span>{t('Veicolo:')}</span> {g.veicolo ? <><Targa t={g.veicolo.targa} /> <span className="sub">{g.veicolo.modello}</span></> : <span className="sub">{t('non assegnato')}</span>}</div>
            {g.interventi.length ? g.interventi.map((i, n) => <div key={n} className="int"><span className="h">{i.ora ?? '—'}</span><span>{i.luogo}<div className="sub">{i.attivita}</div></span></div>)
              : <p className="sub">{t('Nessun intervento pianificato')}</p>}
            {!g.confermato && (g.interventi.length > 0 || g.veicolo) && <span className="sub">{t('piano non ancora confermato')}</span>}
          </>}
        </section>
      ))}
      {h.segnalazioni.length > 0 && <section className="tec-card">
        <div className="lbl-sm">{t('Le tue segnalazioni')}</div>
        {h.segnalazioni.map((s, i) => { const [st, sl] = STATI_SEGN[s.stato]; return (
          <div key={i} className="tec-row"><Targa t={s.targa} /> {t(CATEGORIE[s.categoria])} <Pill s={st}>{s.stato === 'chiusa' ? t('Risolta') : t(sl)}</Pill>
            <div className="sub">{fmtOra(s.creato_il, locale)}{s.nota_chiusura ? ` · ${t('Risposta')}: ${s.nota_chiusura}` : ''}</div></div>); })}
      </section>}
    </>
  );
}

/** Lettore QR dentro l'app (la fotocamera del telefono funziona comunque). */
function Scanner() {
  const { t } = useT();
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let fermo = false;
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    async function avvia() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current || fermo) return;
        video.current.srcObject = stream; await video.current.play();
        const giro = () => {
          const v = video.current;
          if (fermo || !v || !ctx) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code) {
              const m = code.data.match(/\/t\/v\/([0-9a-f]{24})/);
              if (m) { fermo = true; nav(`/t/v/${m[1]}`, { replace: true }); return; }
              setErr(t('Questo QR non è di un veicolo Molajoni.'));
            }
          }
          raf = requestAnimationFrame(giro);
        };
        giro();
      } catch { setErr(t("Fotocamera non disponibile. Usa la fotocamera del telefono o scegli il veicolo dall'elenco.")); }
    }
    avvia();
    return () => { fermo = true; cancelAnimationFrame(raf); stream?.getTracks().forEach(x => x.stop()); };
  }, [nav, t]);
  return (
    <>
      <h1 className="tec-h1">{t('Inquadra il QR sul veicolo')}</h1>
      <div className="scanner"><video ref={video} playsInline muted /><div className="mirino" /></div>
      {err && <div className="ph-msg warn">{err}</div>}
      <Link className="big-btn light" to="/t/elenco"><IcoLista /><span>{t("Scegli il veicolo dall'elenco")}</span></Link>
      <Link className="back-link" to="/t">{t('Indietro')}</Link>
    </>
  );
}

interface VElenco { targa: string; modello: string; qr: string; in_carico_a: string | null; mio: boolean; utilizzabile: boolean }
function Elenco({ token, onScaduta }: { token: string; onScaduta: () => void }) {
  const { t, tm } = useT();
  const [l, setL] = useState<VElenco[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    rpc<VElenco[]>('tecnico_elenco_veicoli', { p_token: token }).then(setL).catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, onScaduta]);
  if (err) return <div className="ph-msg ko">{tm(err)}</div>;
  if (!l) return <p className="sub">{t('Caricamento…')}</p>;
  return (
    <>
      <h1 className="tec-h1">{t('Elenco veicoli')}</h1>
      <p className="sub">{t('Usa il QR quando puoi: conferma che sei davanti al veicolo giusto.')}</p>
      <div className="lista-veicoli">
        {l.map(v => (
          <Link key={v.qr} to={`/t/v/${v.qr}`}>
            <span><Targa t={v.targa} /><div className="sub" style={{ marginTop: 4 }}>{v.modello}</div></span>
            {!v.utilizzabile ? <Pill s="ko">{t('Non utilizzabile')}</Pill> : v.mio ? <Pill s="info">{t('tuo')}</Pill> : v.in_carico_a ? <Pill s="na">{v.in_carico_a}</Pill> : <Pill s="ok">{t('In sede')}</Pill>}
          </Link>
        ))}
      </div>
      <Link className="back-link" to="/t">{t('Indietro')}</Link>
    </>
  );
}

interface VInfo { targa: string; modello: string; km: number; in_carico_a: string | null; in_carico_a_me: boolean; utilizzabile: boolean; controlli: Messaggio[] }
type Azione = 'presa' | 'riconsegna' | 'lettura_km' | 'segnala';

function Veicolo({ token, qr, onScaduta }: { token: string; qr: string; onScaduta: () => void }) {
  const { t, tm } = useT();
  const [v, setV] = useState<VInfo | null>(null); const [err, setErr] = useState<string | null>(null);
  const [az, setAz] = useState<Azione | null>(null); const [esito, setEsito] = useState<{ s: string; m: string } | null>(null);
  const [descrizioneIniziale, setDescrizioneIniziale] = useState('');
  const carica = useCallback(() => {
    rpc<VInfo>('tecnico_veicolo', { p_token: token, p_qr: qr }).then(x => { setV(x); setErr(null); })
      .catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, qr, onScaduta]);
  useEffect(carica, [carica]);
  if (err) return <><div className="ph-msg ko">{tm(err)}</div><Link className="big-btn light" to="/t">{t('La mia giornata')}</Link></>;
  if (!v) return <p className="sub">{t('Caricamento…')}</p>;
  const fatto = (m: { s: string; m: string }, problemi?: string) => {
    setEsito(m); carica();
    if (problemi) { setDescrizioneIniziale(problemi); setAz('segnala'); } else setAz(null);
  };
  return (
    <>
      <div className="tec-veh-head">
        <Targa t={v.targa} big />
        <span className="m">{v.modello}</span>
        <div className="row-flex">
          {!v.utilizzabile ? <Pill s="ko">{t('Non utilizzabile')}</Pill> : v.in_carico_a_me ? <Pill s="info">{t('In carico a te')}</Pill> : v.in_carico_a ? <Pill s="na">{t('In carico a {n}', { n: v.in_carico_a })}</Pill> : <Pill s="ok">{t('In sede')}</Pill>}
          <span className="sub">{t('Ultimi km registrati')}: <span className="mono">{fmtKm(v.km)}</span></span>
        </div>
        {v.controlli.filter(c => c.l === 'ko').map((c, i) => <div key={i} className="msg ko">{tm(c.m)}</div>)}
      </div>

      {esito && <div className={`ph-msg ${esito.s}`}>{tm(esito.m)}</div>}

      {!az && <>
        <div className="tiles">
          {!v.in_carico_a_me && <button className="tile go full" onClick={() => { setEsito(null); setAz('presa'); }}><IcoPrendo />{t('Prendo il veicolo')}</button>}
          {v.in_carico_a_me && <button className="tile back" onClick={() => { setEsito(null); setAz('riconsegna'); }}><IcoRiconsegno />{t('Riconsegno')}</button>}
          {v.in_carico_a_me && <button className="tile km" onClick={() => { setEsito(null); setAz('lettura_km'); }}><IcoKm />{t('Aggiorno i km')}</button>}
          <button className="tile alert" onClick={() => { setEsito(null); setDescrizioneIniziale(''); setAz('segnala'); }}><IcoAllarme />{t('Segnala un problema')}</button>
        </div>
        <Documenti token={token} qr={qr} />
        <Link className="big-btn light" to="/t/scansiona"><IcoQr /><span>{t('Scansiona un altro veicolo')}</span></Link>
        <Link className="back-link" to="/t">{t('La mia giornata')}</Link>
      </>}
      {az && az !== 'segnala' && <FormMovimento key={az} token={token} qr={qr} tipo={az} kmUltimi={v.km} passaggio={!v.in_carico_a_me ? v.in_carico_a : null} onFatto={fatto} onScaduta={onScaduta} onAnnulla={() => setAz(null)} />}
      {az === 'segnala' && <FormSegnalazione token={token} qr={qr} iniziale={descrizioneIniziale} onFatto={m => fatto(m)} onScaduta={onScaduta} onAnnulla={() => setAz(null)} />}
    </>
  );
}

const CONTROLLI = ['Luci', 'Pneumatici', 'Carrozzeria', 'Estintore di bordo'];

function FormMovimento({ token, qr, tipo, kmUltimi, passaggio, onFatto, onScaduta, onAnnulla }:
  { token: string; qr: string; tipo: 'presa' | 'riconsegna' | 'lettura_km'; kmUltimi: number; passaggio: string | null;
    onFatto: (m: { s: string; m: string }, problemi?: string) => void; onScaduta: () => void; onAnnulla: () => void }) {
  const { t, tm } = useT();
  const [km, setKm] = useState(''); const [carb, setCarb] = useState('1/2'); const [note, setNote] = useState('');
  const [check, setCheck] = useState<Record<string, boolean | undefined>>({});
  const [confermaKm, setConfermaKm] = useState(false);
  const [msg, setMsg] = useState<{ s: string; m: string } | null>(null); const [invio, setInvio] = useState(false);
  const ko = CONTROLLI.filter(c => check[c] === false);
  const mancaCheck = tipo === 'presa' && CONTROLLI.some(c => check[c] === undefined);
  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (mancaCheck) { setMsg({ s: 'warn', m: t('Tocca OK o Problema per ogni voce del controllo.') }); return; }
    setInvio(true);
    try {
      const nota = [ko.length ? `Controllo alla presa: ${ko.join(', ')} non a posto` : '', note.trim()].filter(Boolean).join(' · ');
      const r = await rpc<{ esito: string; messaggio: string }>('tecnico_movimento', {
        p_token: token, p_qr: qr, p_tipo: tipo, p_km: Number(km), p_carburante: tipo === 'lettura_km' ? null : carb,
        p_note: nota || null, p_danni: ko.length > 0, p_conferma_km: confermaKm });
      if (r.esito === 'conferma') { setConfermaKm(true); setMsg({ s: 'warn', m: r.messaggio }); }
      else onFatto({ s: ko.length ? 'warn' : 'ok', m: r.messaggio }, ko.length ? `Controllo alla presa: ${ko.join(', ')} non a posto.` : undefined);
    } catch (x) { if (sessioneScaduta(x)) onScaduta(); else setMsg({ s: 'ko', m: testoErrore(x) }); }
    finally { setInvio(false); }
  }
  return (
    <form className="tec-card form" onSubmit={invia}>
      <h2>{tipo === 'presa' ? t('Prendo il veicolo') : tipo === 'riconsegna' ? t('Riconsegno') : t('Aggiorno i km')}</h2>
      {passaggio && tipo === 'presa' && <div className="ph-msg info">{t('Risulta in carico a {n}. Prendendolo registri il passaggio a te.', { n: passaggio })}</div>}
      <div className="field"><label htmlFor="km">1 · {t('Km sul cruscotto')}</label>
        <input id="km" className="km-input" type="number" inputMode="numeric" min={kmUltimi} required placeholder={fmtKm(kmUltimi)} value={km} onChange={e => { setKm(e.target.value); setConfermaKm(false); }} />
        <span className="sub">{t('Almeno {n}', { n: fmtKm(kmUltimi) })}</span></div>
      {tipo !== 'lettura_km' && <div className="field"><span className="lbl-sm">2 · {t('Carburante')}</span>
        <div className="scelte">{CARBURANTE.map(c => <button type="button" key={c} className={carb === c ? 'on' : ''} onClick={() => setCarb(c)}>{t(lblCarb(c))}</button>)}</div></div>}
      {tipo === 'presa' && <div className="field"><span className="lbl-sm">3 · {t('Controllo veloce')}</span>
        <div>{CONTROLLI.map(c => (
          <div key={c} className="check-row"><span className="nome">{t(c)}</span>
            <div className="okko">
              <button type="button" className={`ok ${check[c] === true ? 'on' : ''}`} onClick={() => setCheck({ ...check, [c]: true })}>{t('OK')}</button>
              <button type="button" className={`ko ${check[c] === false ? 'on' : ''}`} onClick={() => setCheck({ ...check, [c]: false })}>{t('Problema')}</button>
            </div></div>))}</div></div>}
      {tipo === 'riconsegna' && <div className="field"><label htmlFor="note">{t('Note (facoltative)')}</label><input id="note" value={note} onChange={e => setNote(e.target.value)} placeholder={t('Es. parcheggiato in sede, chiavi in ufficio')} /></div>}
      {msg && <div className={`ph-msg ${msg.s}`}>{tm(msg.m)}</div>}
      <button className="btn brand big" disabled={invio}>{confermaKm ? t('Confermo i km') : tipo === 'presa' ? t('Conferma presa in carico') : tipo === 'riconsegna' ? t('Conferma riconsegna') : t('Salva km')}</button>
      <button type="button" className="back-link" onClick={onAnnulla}>{t('Annulla')}</button>
    </form>
  );
}

function FormSegnalazione({ token, qr, iniziale, onFatto, onScaduta, onAnnulla }:
  { token: string; qr: string; iniziale: string; onFatto: (m: { s: string; m: string }) => void; onScaduta: () => void; onAnnulla: () => void }) {
  const { t, tm } = useT();
  const [cat, setCat] = useState(iniziale ? 'danno_carrozzeria' : ''); const [grav, setGrav] = useState('utilizzabile'); const [desc, setDesc] = useState(iniziale);
  const [msg, setMsg] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  const [foto, setFoto] = useState<File[]>([]);
  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!cat) { setMsg(t('Scegli il tipo di problema.')); return; }
    setInvio(true);
    try {
      const r = await rpc<{ messaggio: string; id: number }>('tecnico_segnalazione', { p_token: token, p_qr: qr, p_categoria: cat, p_gravita: grav, p_descrizione: desc });
      let fallite = 0;
      for (const f of foto.slice(0, 5)) {
        try {
          const fd = new FormData(); fd.append('token', token); fd.append('segnalazione_id', String(r.id)); fd.append('file', await comprimiFoto(f), 'foto.jpg');
          const res = await fetch(`${URL_FUNZIONI}/foto`, { method: 'POST', body: fd });
          if (!res.ok) fallite++;
        } catch { fallite++; }
      }
      onFatto({ s: grav === 'fermo' || fallite ? 'warn' : 'ok', m: r.messaggio + (fallite ? ` ${t('{n} foto non caricate: riprova con una connessione migliore.', { n: fallite })}` : '') });
    } catch (x) { if (sessioneScaduta(x)) onScaduta(); else setMsg(tm(testoErrore(x))); }
    finally { setInvio(false); }
  }
  return (
    <form className="tec-card form" onSubmit={invia}>
      <h2>{t('Segnala un problema')}</h2>
      {iniziale && <div className="ph-msg warn">{t('Hai indicato un problema nel controllo: completa la segnalazione.')}</div>}
      <div className="field"><span className="lbl-sm">1 · {t('Tipo di problema')}</span>
        <div className="cat-grid">{Object.entries(CATEGORIE).map(([k, l]) => <button type="button" key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{t(l)}</button>)}</div></div>
      <fieldset className="seg"><legend className="lbl-sm">2 · {t('Il veicolo si può usare?')}</legend>
        {(['utilizzabile', 'da_verificare', 'fermo'] as const).map(g => (
          <label key={g}><input type="radio" name="grav" value={g} checked={grav === g} onChange={() => setGrav(g)} />
            <span style={{ flex: 1 }}>{g === 'utilizzabile' ? t('Sì, posso continuare') : g === 'da_verificare' ? t('Sì, ma va controllato presto') : t('No, veicolo fermo')}</span><Pill s={GRAVITA[g][0]}>{t(GRAVITA[g][1])}</Pill></label>))}
      </fieldset>
      <div className="field"><label htmlFor="desc">3 · {t('Descrizione')}</label><textarea id="desc" required minLength={5} value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('Cosa è successo, dove, quando')} />
        <span className="sub">🎤 {t('Non vuoi scrivere? Premi il microfono sulla tastiera e parla.')}</span></div>
      <div className="field"><span className="lbl-sm">4 · {t('Foto (facoltative, max 5)')}</span>
        <label className="big-btn light foto-btn"><IcoFoto /><span>{foto.length ? t('{n} foto pronte', { n: foto.length }) : t('Scatta o scegli una foto')}</span>
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => setFoto([...foto, ...Array.from(e.target.files ?? [])].slice(0, 5))} /></label>
        {foto.length > 0 && <button type="button" className="back-link" onClick={() => setFoto([])}>{t('Togli le foto')}</button>}</div>
      {grav === 'fermo' && <div className="ph-msg warn">{t('Il veicolo verrà bloccato subito e non sarà assegnato finché il responsabile non chiude la segnalazione.')}</div>}
      {msg && <div className="ph-msg ko">{msg}</div>}
      <button className="btn brand big" disabled={invio}>{t('Invia segnalazione')}</button>
      <button type="button" className="back-link" onClick={onAnnulla}>{t('Annulla')}</button>
    </form>
  );
}

/* ---------- Notifiche nell'app ---------- */
interface Notifica { id: number; tipo: string; dati: Record<string, unknown>; creato_il: string; letta: boolean }
function Notifiche({ token }: { token: string }) {
  const { t, locale } = useT();
  const [l, setL] = useState<Notifica[]>([]);
  const carica = useCallback(() => { rpc<Notifica[]>('tecnico_notifiche', { p_token: token }).then(setL).catch(() => {}); }, [token]);
  useEffect(() => { carica(); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  const nonLette = l.filter(n => !n.letta).slice(0, 3);
  if (!nonLette.length) return null;
  async function letta(id: number) { try { await rpc('tecnico_notifica_letta', { p_token: token, p_id: id }); } catch { /* riprova al prossimo caricamento */ } carica(); }
  return <>{nonLette.map(n => {
    const d = n.dati as { data?: string; veicolo?: { targa: string; modello: string } | null; interventi?: { ora: string | null; luogo: string; attivita: string }[]; targa?: string; nota?: string };
    return (
      <section key={n.id} className="tec-card notifica">
        <div className="lbl-sm">🔔 {n.tipo === 'piano' ? t('Nuovo piano di lavoro') : t('Problema risolto')} · {fmtOra(n.creato_il, locale)}</div>
        {n.tipo === 'piano' ? <>
          <div className="tec-h2">{fmtGiorno(d.data!, locale)}</div>
          <div className="row-flex"><span>{t('Veicolo:')}</span>{d.veicolo ? <><Targa t={d.veicolo.targa} big /><span className="sub">{d.veicolo.modello}</span></> : <b>{t('non assegnato')}</b>}</div>
          {(d.interventi ?? []).map((i, k) => <div key={k} className="int"><span className="h">{i.ora ?? '—'}</span><span>{i.luogo}<div className="sub">{i.attivita}</div></span></div>)}
        </> : <div className="row-flex"><Targa t={d.targa} /> <span>{d.nota}</span></div>}
        <button className="btn brand big" onClick={() => letta(n.id)}>✓ {t('Ho visto')}</button>
      </section>
    );
  })}</>;
}

function AttivaNotifiche({ token }: { token: string }) {
  const { t, lingua } = useT();
  const [s, setS] = useState<StatoPush | null>(null);
  useEffect(() => { statoPush().then(setS); }, []);
  if (!s || s === 'attive' || s === 'non_supportate') return null;
  async function attiva() {
    try { setS(await attivaPush((e, p, a) => rpc('tecnico_salva_push', { p_token: token, p_endpoint: e, p_p256dh: p, p_auth: a, p_lingua: lingua }))); }
    catch { setS('da_attivare'); }
  }
  return (
    <section className="tec-card">
      <div className="lbl-sm">🔔 {t('Notifiche sul telefono')}</div>
      {s === 'serve_home' ? <p>{t('Su iPhone: premi Condividi e poi "Aggiungi alla schermata Home". Apri l\'app dalla Home e attiva le notifiche.')}</p>
        : s === 'negate' ? <p>{t('Le notifiche sono bloccate. Attivale dalle impostazioni del browser per questo sito.')}</p>
        : <><p>{t('Ricevi un avviso quando il responsabile conferma il tuo veicolo e le tue attività.')}</p>
            <button className="btn big" onClick={attiva}>{t('Attiva le notifiche')}</button></>}
    </section>
  );
}

/* ---------- Documenti del veicolo ---------- */
function Documenti({ token, qr }: { token: string; qr: string }) {
  const { t, tm } = useT();
  const [l, setL] = useState<{ id: number; tipo: string; titolo: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { rpc<{ id: number; tipo: string; titolo: string }[]>('tecnico_documenti', { p_token: token, p_qr: qr }).then(setL).catch(() => {}); }, [token, qr]);
  if (!l.length) return null;
  async function apri(id: number) {
    setErr(null);
    const w = window.open('', '_blank');
    try {
      const r = await fetch(`${URL_FUNZIONI}/documento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.errore);
      if (w) w.location.href = j.url; else window.location.href = j.url;
    } catch (e) { w?.close(); setErr(tm(testoErrore(e))); }
  }
  return (
    <section className="tec-card">
      <div className="lbl-sm">{t('Documenti del veicolo')}</div>
      {l.map(d => <button key={d.id} className="big-btn light" onClick={() => apri(d.id)}><IcoDoc /><span>{t(TIPI_DOC[d.tipo] ?? 'Altro')}<span className="sub">{d.titolo}</span></span></button>)}
      <span className="sub">{t("Copia digitale di supporto: l'originale della carta di circolazione resta a bordo.")}</span>
      {err && <div className="ph-msg ko">{err}</div>}
    </section>
  );
}
