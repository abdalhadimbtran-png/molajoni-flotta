import { useEffect, useState } from 'react';
import { InstallaApp } from '../Installa';
import { rpc } from '../lib/supabase';
import { URL_FUNZIONI } from '../lib/push';
import { comprimi } from '../formazione/comune';
import { nomeTipo, useSessione, type Saldo } from './api';
import { Attesa } from './componenti';
import { AttivaNotifiche } from './Notifiche';
import { dataLunga, fmtSaldo, num, saldoSemplice } from './periodo';

const CATEGORIE: Record<string, string> = { TEC: 'Tecnico', UFFICIO: 'Ufficio', MAGAZZINO: 'Magazzino', ALTRO: 'Altro' };

function BloccoSaldo({ s }: { s: Saldo }) {
  const u = s.unita;
  const v = (n: number) => <b className={n < 0 ? 'neg' : undefined}>{num(Math.round(Number(n) * 10) / 10)}</b>;
  const resto = saldoSemplice(Number(s.saldo), u);
  return (
    <div className="saldo-dett">
      <div className="saldo-dett-t"><b>{nomeTipo(s.tipo, s.descrizione)}</b><span className="sub">{u === 'ore' ? 'in ore' : 'in giorni'}</span></div>
      <div className="mini-stat">
        {Number(s.saldo_iniziale) !== 0 && <span>{s.origine === 'saldo_iniziale' ? 'Saldo di partenza' : "Dall'anno scorso"}{v(s.saldo_iniziale)}</span>}
        <span>Maturate quest'anno{v(s.maturato)}</span>
        <span>Usate o già approvate{v(s.goduto)}</span>
        {Number(s.rettifiche) !== 0 && <span>Correzioni dell'ufficio{v(s.rettifiche)}</span>}
        {Number(s.in_attesa) > 0 && <span>In valutazione{v(s.in_attesa)}</span>}
        <span className="totale">Ti restano<b className={resto.anticipo ? 'neg' : undefined}>{resto.testo}</b></span>
      </div>
      {Number(s.quota_mensile) > 0 && <span className="sub">Maturi circa {fmtSaldo(Math.round(Number(s.quota_mensile) * 10) / 10, u)} ogni mese. A fine anno avrai {saldoSemplice(Number(s.saldo_fine_anno), u).testo} (senza nuove richieste).</span>}
    </div>
  );
}

const STATO_CARTA: Record<string, string> = { attiva: 'Attiva', sospesa: 'Sospesa', smarrita: 'Smarrita', restituita: 'Restituita' };
/** La propria carta carburante: solo ultime 4 cifre e stato. */
function LaTuaCarta({ token }: { token: string }) {
  const [carte, setCarte] = useState<{ ultime4: string; circuito: string; stato: string }[]>([]);
  useEffect(() => { rpc<typeof carte>('dipendente_carta', { p_token: token }).then(setCarte).catch(() => setCarte([])); }, [token]);
  if (!carte.length) return null;
  return (
    <section className="tec-card">
      <div className="lbl-sm">Carta carburante</div>
      {carte.map((c, i) => <p key={i} style={{ margin: 0 }}>La tua carta: <b className="mono">•••• {c.ultime4}</b> · {c.circuito} · {STATO_CARTA[c.stato] ?? c.stato}</p>)}
      <span className="sub">Carta smarrita? Avvisa subito l'ufficio personale.</span>
    </section>
  );
}

const STATO_MIO: Record<string, [string, string]> = { valido: ['ok', 'Valido'], in_scadenza: ['warn', 'In scadenza'], scaduto: ['ko', 'Scaduto'], mancante: ['ko', 'Da fare'] };
interface MioCorso { corso: string; data_conseguimento: string | null; data_scadenza: string | null; stato: string; attestati: { id: number; nome: string }[] }
interface RichiestaMia { id: number; corso: string; stato: string; motivo: string | null }

async function apriMioAttestato(token: string, id: number) {
  const w = window.open('', '_blank');
  const r = await fetch(`${URL_FUNZIONI}/attestato`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, id }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) { w?.close(); alert(j.errore === 'SESSIONE_NON_VALIDA' ? 'Accedi di nuovo.' : 'Attestato non disponibile.'); return; }
  if (w) w.location.href = j.url; else window.location.href = j.url;
}

/** Attestati richiesti dal responsabile formazione: il dipendente carica solo il file. */
function AttestatiDaCaricare({ token, onCaricato }: { token: string; onCaricato: () => void }) {
  const [l, setL] = useState<RichiestaMia[] | null>(null);
  const [invio, setInvio] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const carica = () => rpc<RichiestaMia[]>('dipendente_attestati_richiesti', { p_token: token }).then(setL).catch(() => setL([]));
  useEffect(() => { carica(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  async function invia(id: number, f: File | undefined) {
    if (!f) return;
    setInvio(id); setMsg(null);
    try {
      const g = await comprimi(f);
      if (g.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB).');
      const fd = new FormData(); fd.append('token', token); fd.append('richiesta_id', String(id)); fd.append('file', g, g.name);
      const r = await fetch(`${URL_FUNZIONI}/carica-attestato`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.errore === 'SESSIONE_NON_VALIDA' ? 'Accedi di nuovo.' : j.errore || 'Caricamento non riuscito.');
      setMsg('Attestato inviato. Il responsabile lo controllerà.'); carica(); onCaricato();
    } catch (e) { setMsg((e as Error).message); } finally { setInvio(null); }
  }
  const aperte = (l ?? []).filter(r => r.stato !== 'approvato');
  const fatte = (l ?? []).filter(r => r.stato === 'approvato');
  if (!l || (!aperte.length && !fatte.length)) return null;
  return (
    <section className="tec-card">
      <div className="lbl-sm">Attestati da caricare</div>
      {aperte.map(r => (
        <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <b>{r.corso}</b>
          {r.stato === 'da_verificare' && <div><span className="pill warn">In verifica</span></div>}
          {r.stato === 'rifiutato' && <div className="sub" style={{ color: 'var(--ko)' }}>Rifiutato: {r.motivo}. Caricalo di nuovo.</div>}
          {(r.stato === 'richiesto' || r.stato === 'rifiutato') && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <label className="big-btn primary" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>{invio === r.id ? 'Invio…' : '📷 Foto'}
                <input type="file" accept="image/*" capture="environment" hidden disabled={invio != null} onChange={e => { invia(r.id, e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="big-btn light" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>📄 PDF / file
                <input type="file" accept="application/pdf,image/*" hidden disabled={invio != null} onChange={e => { invia(r.id, e.target.files?.[0]); e.target.value = ''; }} /></label>
            </div>)}
        </div>))}
      {fatte.map(r => <div key={r.id} className="sub" style={{ paddingTop: 6 }}>{r.corso}: <span className="pill ok">Approvato</span></div>)}
      {msg && <p className="sub" style={{ marginTop: 8 }}>{msg}</p>}
    </section>
  );
}

/** I miei corsi: stato e scadenza, sola lettura; apertura dei propri attestati. */
function IMieiCorsi({ token }: { token: string }) {
  const [corsi, setCorsi] = useState<MioCorso[] | null>(null);
  const [k, setK] = useState(0);
  useEffect(() => { rpc<MioCorso[]>('dipendente_corsi', { p_token: token }).then(setCorsi).catch(() => setCorsi([])); }, [token, k]);
  return (
    <>
      <AttestatiDaCaricare token={token} onCaricato={() => setK(k + 1)} />
      {!!corsi?.length && (
        <section className="tec-card">
          <div className="lbl-sm">I miei corsi</div>
          {corsi.map((c, i) => {
            const [l, t] = STATO_MIO[c.stato] ?? ['na', c.stato];
            return (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div><b>{c.corso}</b><div className="sub">{c.data_conseguimento ? (c.data_scadenza ? `Scade il ${dataLunga(c.data_scadenza)}` : 'Non scade') : 'Corso obbligatorio non ancora fatto'}</div></div>
                  <span className={`pill ${l}`}>{t}</span>
                </div>
                {c.attestati?.map((a, j) => <button key={a.id} className="big-btn light" style={{ marginTop: 6, padding: '8px 12px', fontSize: 15 }} onClick={() => apriMioAttestato(token, a.id)}>Vedi attestato{c.attestati.length > 1 ? ` ${j + 1}` : ''}</button>)}
              </div>);
          })}
          <span className="sub">Un corso manca o è sbagliato? Avvisa il responsabile della formazione.</span>
        </section>)}
    </>
  );
}

/** Profilo in sola lettura (UX § 2.6). «Esci» sta qui, così non si tocca per sbaglio. */
export default function Profilo() {
  const { home, errore, esci, token } = useSessione();
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
      <IMieiCorsi token={token} />
      <LaTuaCarta token={token} />
      <AttivaNotifiche sempre />
      <InstallaApp />
      <p className="sub">Hai dimenticato il PIN? Chiedi un nuovo PIN all'ufficio personale{home.tec ? ' o al responsabile flotta' : ''}.</p>
      <button className="big-btn light esci-btn" onClick={esci}>Esci</button>
    </>
  );
}
