import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { CARBURANTE, CATEGORIE, GRAVITA, STATI_SEGN, fmtGiorno, fmtKm, fmtOra, lblCarb, type Messaggio } from '../lib/format';
import { Pill } from '../ui';

const CHIAVE = 'molajoni_flotta_token';
const leggiToken = () => { try { return localStorage.getItem(CHIAVE); } catch { return null; } };
const scriviToken = (t: string | null) => { try { if (t) localStorage.setItem(CHIAVE, t); else localStorage.removeItem(CHIAVE); } catch { /* nulla */ } };
const sessioneScaduta = (e: unknown) => testoErrore(e).includes('SESSIONE_NON_VALIDA');

/** Contenitore dell'app tecnico: gestisce l'accesso con codice + PIN. */
export default function Tecnico() {
  const [token, setToken] = useState<string | null>(leggiToken);
  const { qr } = useParams();
  const esci = useCallback(() => { scriviToken(null); setToken(null); }, []);
  return (
    <div className="tec">
      <div className="tec-bar"><span className="tec-brand">Molajoni · Flotta</span>{token && <button className="tec-link" onClick={async () => { try { await rpc('tecnico_logout', { p_token: token }); } catch { /* già scaduta */ } esci(); }}>Esci</button>}</div>
      <main className="tec-main">
        {!token ? <Login onOk={t => { scriviToken(t); setToken(t); }} conVeicolo={!!qr} />
          : qr ? <Veicolo token={token} qr={qr} onScaduta={esci} />
          : <Home token={token} onScaduta={esci} />}
      </main>
    </div>
  );
}

function Login({ onOk, conVeicolo }: { onOk: (t: string) => void; conVeicolo: boolean }) {
  const [codice, setCodice] = useState(''); const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  async function invia(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const r = await rpc<{ ok: boolean; token?: string; errore?: string }>('tecnico_login', { p_codice: codice, p_pin: pin });
      if (r.ok && r.token) onOk(r.token); else { setErr(r.errore ?? 'Accesso non riuscito.'); setPin(''); }
    } catch (x) { setErr(testoErrore(x)); }
    finally { setInvio(false); }
  }
  return (
    <form className="tec-card form" onSubmit={invia}>
      <h1 className="tec-h1">Accedi</h1>
      <p className="sub">{conVeicolo ? 'Accedi una volta: poi il QR del veicolo ti porta direttamente all\'operazione.' : 'Codice e PIN te li dà il responsabile flotta.'}</p>
      <div className="field"><label htmlFor="cod">Codice</label><input id="cod" autoCapitalize="characters" autoComplete="username" required value={codice} onChange={e => setCodice(e.target.value.toUpperCase())} /></div>
      <div className="field"><label htmlFor="pin">PIN</label><input id="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
      {err && <div className="ph-msg ko">{err}</div>}
      <button className="btn big" disabled={invio}>{invio ? 'Accesso…' : 'Accedi'}</button>
    </form>
  );
}

interface Home { nome: string; codice: string; avvisi: Messaggio[];
  in_carico: { targa: string; modello: string; km: number; dal: string; qr: string }[];
  giorni: { data: string; confermato: boolean; assenza: string | null; veicolo: { targa: string; modello: string } | null; interventi: { ora: string | null; luogo: string; attivita: string }[] }[];
  segnalazioni: { targa: string; categoria: string; gravita: string; stato: string; creato_il: string }[] }

function Home({ token, onScaduta }: { token: string; onScaduta: () => void }) {
  const [h, setH] = useState<Home | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    rpc<Home>('tecnico_home', { p_token: token }).then(setH).catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, onScaduta]);
  if (err) return <div className="ph-msg ko">{err}</div>;
  if (!h) return <p className="sub">Caricamento…</p>;
  return (
    <>
      <h1 className="tec-h1">Ciao {h.nome.split(' ')[0]}</h1>
      {h.avvisi.map((a, i) => <div key={i} className={`ph-msg ${a.l}`}>{a.m}</div>)}
      <section className="tec-card">
        <div className="lbl-sm">Veicolo in carico</div>
        {h.in_carico.length ? h.in_carico.map(v => (
          <div key={v.qr} className="tec-veh"><div><div className="plate-sm">{v.targa}</div><div className="sub">{v.modello} · {fmtKm(v.km)} km · dal {fmtOra(v.dal)}</div></div>
            <Link className="btn btn-sm" to={`/t/v/${v.qr}`}>Apri</Link></div>
        )) : <p className="sub">Nessuno. Per prendere un veicolo scansiona il QR sul cruscotto.</p>}
      </section>
      {h.giorni.map(g => (
        <section key={g.data} className="tec-card">
          <div className="lbl-sm">{fmtGiorno(g.data)}{!g.confermato && !g.assenza && (g.interventi.length || g.veicolo) ? ' · piano non ancora confermato' : ''}</div>
          {g.assenza ? <p>{g.assenza}</p> : <>
            <p><b>Veicolo:</b> {g.veicolo ? `${g.veicolo.targa} · ${g.veicolo.modello}` : 'non assegnato'}</p>
            {g.interventi.length ? g.interventi.map((i, k) => <div key={k} className="int"><span className="h">{i.ora ?? '—'}</span><span>{i.luogo}<div className="sub">{i.attivita}</div></span></div>)
              : <p className="sub">Nessun intervento pianificato</p>}
          </>}
        </section>
      ))}
      {h.segnalazioni.length > 0 && <section className="tec-card">
        <div className="lbl-sm">Le tue segnalazioni</div>
        {h.segnalazioni.map((s, i) => { const [st, sl] = STATI_SEGN[s.stato]; return (
          <div key={i} className="tec-row"><span className="targa">{s.targa}</span> {CATEGORIE[s.categoria]} <Pill s={st}>{sl}</Pill><div className="sub">{fmtOra(s.creato_il)}</div></div>); })}
      </section>}
    </>
  );
}

interface VInfo { targa: string; modello: string; km: number; in_carico_a: string | null; in_carico_a_me: boolean; utilizzabile: boolean; controlli: Messaggio[] }
type Azione = 'presa' | 'riconsegna' | 'lettura_km' | 'segnala';

function Veicolo({ token, qr, onScaduta }: { token: string; qr: string; onScaduta: () => void }) {
  const [v, setV] = useState<VInfo | null>(null); const [err, setErr] = useState<string | null>(null);
  const [az, setAz] = useState<Azione | null>(null); const [esito, setEsito] = useState<{ s: string; m: string } | null>(null);
  const carica = useCallback(() => {
    rpc<VInfo>('tecnico_veicolo', { p_token: token, p_qr: qr }).then(x => { setV(x); setErr(null); })
      .catch(e => { if (sessioneScaduta(e)) onScaduta(); else setErr(testoErrore(e)); });
  }, [token, qr, onScaduta]);
  useEffect(carica, [carica]);
  if (err) return <><div className="ph-msg ko">{err}</div><Link className="btn-ghost" to="/t">La mia giornata</Link></>;
  if (!v) return <p className="sub">Caricamento…</p>;
  const fatto = (m: { s: string; m: string }) => { setEsito(m); setAz(null); carica(); };
  return (
    <>
      <div className="tec-head"><div className="k">Veicolo</div><div className="plate">{v.targa}</div><div className="m">{v.modello}</div></div>
      <div className="tec-status">
        <div>{!v.utilizzabile ? <Pill s="ko">Non utilizzabile</Pill> : v.in_carico_a_me ? <Pill s="info">In carico a te</Pill> : v.in_carico_a ? <Pill s="info">In carico a {v.in_carico_a}</Pill> : <Pill s="ok">In sede</Pill>}</div>
        <div className="mono sub">Ultimi km registrati: {fmtKm(v.km)}</div>
        {v.controlli.filter(c => c.l === 'ko').map((c, i) => <div key={i} className="msg ko">{c.m}</div>)}
      </div>
      {esito ? <>
        <div className={`ph-msg ${esito.s}`}>{esito.m}</div>
        <div className="row-flex"><button className="btn" onClick={() => setEsito(null)}>Nuova operazione</button><Link className="btn-ghost" to="/t">La mia giornata</Link></div>
      </> : <>
        <div className="ph-actions">
          {!v.in_carico_a_me && <button className={az === 'presa' ? 'sel' : ''} onClick={() => setAz('presa')}>Prendo il veicolo</button>}
          {v.in_carico_a_me && <button className={az === 'riconsegna' ? 'sel' : ''} onClick={() => setAz('riconsegna')}>Riconsegno</button>}
          {v.in_carico_a_me && <button className={az === 'lettura_km' ? 'sel' : ''} onClick={() => setAz('lettura_km')}>Aggiorno i km</button>}
          <button className={`danger full ${az === 'segnala' ? 'sel' : ''}`} onClick={() => setAz('segnala')}>Segnala un problema</button>
        </div>
        {az && az !== 'segnala' && <FormMovimento key={az} token={token} qr={qr} tipo={az} kmUltimi={v.km} passaggio={!v.in_carico_a_me ? v.in_carico_a : null} onFatto={fatto} onScaduta={onScaduta} />}
        {az === 'segnala' && <FormSegnalazione token={token} qr={qr} onFatto={fatto} onScaduta={onScaduta} />}
        <Link className="tec-link" to="/t">La mia giornata</Link>
      </>}
    </>
  );
}

function FormMovimento({ token, qr, tipo, kmUltimi, passaggio, onFatto, onScaduta }:
  { token: string; qr: string; tipo: 'presa' | 'riconsegna' | 'lettura_km'; kmUltimi: number; passaggio: string | null; onFatto: (m: { s: string; m: string }) => void; onScaduta: () => void }) {
  const [km, setKm] = useState(''); const [carb, setCarb] = useState('1/2'); const [note, setNote] = useState('');
  const [nessunDanno, setNessunDanno] = useState(true); const [confermaKm, setConfermaKm] = useState(false);
  const [msg, setMsg] = useState<{ s: string; m: string } | null>(null); const [invio, setInvio] = useState(false);
  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      const r = await rpc<{ esito: string; messaggio: string }>('tecnico_movimento', {
        p_token: token, p_qr: qr, p_tipo: tipo, p_km: Number(km), p_carburante: tipo === 'lettura_km' ? null : carb,
        p_note: note || null, p_danni: tipo === 'presa' ? !nessunDanno : false, p_conferma_km: confermaKm });
      if (r.esito === 'conferma') { setConfermaKm(true); setMsg({ s: 'warn', m: r.messaggio }); }
      else onFatto({ s: !nessunDanno && tipo === 'presa' ? 'warn' : 'ok', m: r.messaggio });
    } catch (x) { if (sessioneScaduta(x)) onScaduta(); else setMsg({ s: 'ko', m: testoErrore(x) }); }
    finally { setInvio(false); }
  }
  return (
    <form className="form" onSubmit={invia}>
      {passaggio && tipo === 'presa' && <div className="ph-msg warn">Risulta in carico a {passaggio}. Prendendolo registri il passaggio a te.</div>}
      <div className="field"><label htmlFor="km">Km sul cruscotto</label>
        <input id="km" type="number" inputMode="numeric" min={kmUltimi} required placeholder={`Almeno ${fmtKm(kmUltimi)}`} value={km} onChange={e => { setKm(e.target.value); setConfermaKm(false); }} /></div>
      {tipo !== 'lettura_km' && <div className="field"><label htmlFor="carb">Carburante</label>
        <select id="carb" value={carb} onChange={e => setCarb(e.target.value)}>{CARBURANTE.map(c => <option key={c} value={c}>{lblCarb(c)}</option>)}</select></div>}
      {tipo === 'presa' && <label className="chk"><input type="checkbox" checked={nessunDanno} onChange={e => setNessunDanno(e.target.checked)} /> Nessun danno nuovo visibile</label>}
      {tipo === 'riconsegna' && <div className="field"><label htmlFor="note">Note (facoltative)</label><input id="note" value={note} onChange={e => setNote(e.target.value)} placeholder="Es. parcheggiato in sede, chiavi in ufficio" /></div>}
      {msg && <div className={`ph-msg ${msg.s}`}>{msg.m}</div>}
      <button className="btn big" disabled={invio}>{confermaKm ? 'Confermo i km' : tipo === 'presa' ? 'Conferma presa in carico' : tipo === 'riconsegna' ? 'Conferma riconsegna' : 'Salva km'}</button>
    </form>
  );
}

function FormSegnalazione({ token, qr, onFatto, onScaduta }: { token: string; qr: string; onFatto: (m: { s: string; m: string }) => void; onScaduta: () => void }) {
  const [cat, setCat] = useState('guasto_meccanico'); const [grav, setGrav] = useState('utilizzabile'); const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [invio, setInvio] = useState(false);
  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      const r = await rpc<{ messaggio: string }>('tecnico_segnalazione', { p_token: token, p_qr: qr, p_categoria: cat, p_gravita: grav, p_descrizione: desc });
      onFatto({ s: grav === 'fermo' ? 'warn' : 'ok', m: r.messaggio });
    } catch (x) { if (sessioneScaduta(x)) onScaduta(); else setMsg(testoErrore(x)); }
    finally { setInvio(false); }
  }
  return (
    <form className="form" onSubmit={invia}>
      <div className="field"><label htmlFor="cat">Tipo di problema</label>
        <select id="cat" value={cat} onChange={e => setCat(e.target.value)}>{Object.entries(CATEGORIE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <fieldset className="seg"><legend className="lbl-sm">Il veicolo si può usare?</legend>
        {(['utilizzabile', 'da_verificare', 'fermo'] as const).map(g => (
          <label key={g}><input type="radio" name="grav" value={g} checked={grav === g} onChange={() => setGrav(g)} />
            {g === 'utilizzabile' ? 'Sì, posso continuare' : g === 'da_verificare' ? 'Sì, ma va controllato presto' : 'No, veicolo fermo'} <Pill s={GRAVITA[g][0]}>{GRAVITA[g][1]}</Pill></label>))}
      </fieldset>
      <div className="field"><label htmlFor="desc">Descrizione</label><textarea id="desc" required minLength={5} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Cosa è successo, dove, quando" /></div>
      {grav === 'fermo' && <div className="ph-msg warn">Il veicolo verrà bloccato subito e non sarà assegnato finché il responsabile non chiude la segnalazione.</div>}
      {msg && <div className="ph-msg ko">{msg}</div>}
      <button className="btn big" disabled={invio}>Invia segnalazione</button>
    </form>
  );
}
