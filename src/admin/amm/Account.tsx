import { FormEvent, useState } from 'react';
import { fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { rpc, supabase, testoErrore } from '../../lib/supabase';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../../ui';
import { chiamaAccount } from './AreaAdmin';

/** Ruolo come lo vede l'amministratore. 'hr' = responsabile con area «hr» (ufficio personale). */
type Ruolo = 'admin' | 'responsabile' | 'hr';
interface AccServer { user_id: string; nome: string; email: string; ruolo: 'admin' | 'responsabile'; attivo: boolean; creato_il: string; ultimo_accesso: string | null; io: boolean }
interface Acc extends AccServer { tipo: Ruolo; dipendente_id: number | null }
interface Dip { id: number; nome: string; cognome: string; codice: string; categoria: string; attivo: boolean }

const generaPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), n => a[n % a.length]).join('');
};

const RUOLI: { v: Ruolo; l: string; d: string; pill: 'info' | 'na' }[] = [
  { v: 'admin', l: 'Amministratore', d: 'Tutto il sistema: account, analisi, sicurezza, flotta e personale.', pill: 'info' },
  { v: 'responsabile', l: 'Responsabile flotta', d: 'Piano, veicoli, tecnici, segnalazioni, avvisi, multe, carburante.', pill: 'na' },
  { v: 'hr', l: 'Ufficio personale', d: 'Ferie e permessi, dipendenti, saldi, festività, report del personale.', pill: 'na' },
];
const ruoloDi = (v: Ruolo) => RUOLI.find(r => r.v === v)!;

/** Account del pannello: amministratori, responsabili flotta, ufficio personale. I dipendenti entrano con codice e PIN. */
export default function Account() {
  const { t, tm, locale } = useT();
  const { data, errore, reload } = useLoad(async () => {
    const [el, rs, dp] = await Promise.all([
      chiamaAccount<{ account: AccServer[] }>({ azione: 'elenco' }),
      supabase.from('responsabili').select('user_id,ruolo,area,dipendente_id'),
      supabase.from('dipendenti').select('id,nome,cognome,codice,categoria,attivo').order('cognome'),
    ]);
    if (rs.error) throw rs.error;
    const extra = new Map(((rs.data ?? []) as { user_id: string; ruolo: string; area: string | null; dipendente_id: number | null }[]).map(r => [r.user_id, r]));
    const account: Acc[] = el.account.map(a => {
      const x = extra.get(a.user_id);
      const tipo: Ruolo = a.ruolo === 'admin' ? 'admin' : x?.area === 'hr' ? 'hr' : 'responsabile';
      return { ...a, tipo, dipendente_id: x?.dipendente_id ?? null };
    });
    return { account, dipendenti: (dp.data ?? []) as Dip[] };
  });
  const [nuovo, setNuovo] = useState(false);
  const [pw, setPw] = useState<Acc | null>(null);
  const [ruolo, setRuolo] = useState<Acc | null>(null);
  const [disattiva, setDisattiva] = useState<Acc | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const dip = (id: number | null) => data.dipendenti.find(d => d.id === id);

  async function cambiaStato(a: Acc, attivo: boolean) {
    // la funzione server lascia com'è l'area (flotta / ufficio personale): si passa solo admin o responsabile
    try { await chiamaAccount({ azione: 'stato', user_id: a.user_id, attivo, ruolo: a.ruolo }); toast(t('Account aggiornato')); setDisattiva(null); reload(); }
    catch (e) { toast(tm((e as Error).message)); }
  }

  return (
    <>
      <div className="section-title">{t('Account del pannello')} <span className="meta">{t('amministratori, responsabili flotta e ufficio personale')}</span><span className="spacer" />
        <button className="btn btn-sm" onClick={() => setNuovo(true)}>{t('Nuovo account')}</button></div>
      <div className="livelli">
        {RUOLI.map(r => <div key={r.v}><b>{t(r.l)}</b><span>{t(r.d)}</span></div>)}
        <div><b>{t('Dipendente')}</b><span>{t('App con codice e PIN: ferie e permessi; i tecnici anche veicolo e km.')}</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Nome')}</th><th>{t('Email')}</th><th>{t('Ruolo')}</th><th>{t('Stato')}</th><th>{t('Ultimo accesso')}</th><th></th></tr></thead>
        <tbody>{data.account.map(a => {
          const d = dip(a.dipendente_id);
          return (
            <tr key={a.user_id} className={a.attivo ? '' : 'muted'}>
              <td><span style={{ fontWeight: 600 }}>{a.nome}</span>{a.io && <span className="sub"> · {t('tu')}</span>}
                {d && <div className="sub">{t('È anche il dipendente {n}', { n: `${d.nome} ${d.cognome}` })}</div>}</td>
              <td className="mono" dir="ltr">{a.email}</td>
              <td><Pill s={ruoloDi(a.tipo).pill}>{t(ruoloDi(a.tipo).l)}</Pill></td>
              <td>{a.attivo ? <Pill s="ok">{t('Attivo')}</Pill> : <Pill s="ko">{t('Disattivato')}</Pill>}</td>
              <td className="mono">{a.ultimo_accesso ? fmtOra(a.ultimo_accesso, locale) : '—'}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setRuolo(a)}>{a.io ? t('Collega dipendente') : t('Cambia ruolo')}</button>
                <button className="btn-ghost btn-sm" onClick={() => setPw(a)}>{t('Nuova password')}</button>
                {!a.io && (a.attivo
                  ? <button className="btn-ghost btn-sm" onClick={() => setDisattiva(a)}>{t('Disattiva')}</button>
                  : <button className="btn-ghost btn-sm" onClick={() => cambiaStato(a, true)}>{t('Riattiva')}</button>)}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="hint">{t('Gli account non si cancellano: si disattivano, così lo storico resta leggibile. Ogni modifica è registrata.')} {t("Collega l'account al suo dipendente: così le richieste di ferie della persona stessa si riconoscono.")}</p>
      {nuovo && <NuovoAccount dipendenti={data.dipendenti} collegati={data.account} onClose={() => setNuovo(false)} onSalvato={() => { setNuovo(false); reload(); }} />}
      {pw && <NuovaPassword a={pw} onClose={() => setPw(null)} />}
      {ruolo && <ModaleRuolo a={ruolo} dipendenti={data.dipendenti} collegati={data.account} onClose={() => setRuolo(null)} onSalvato={() => { setRuolo(null); reload(); }} />}
      {disattiva && (
        <Modal titolo={t('Disattivare {n}?', { n: disattiva.nome })} onClose={() => setDisattiva(null)}>
          <div className="form">
            <p>{t('Non potrà più accedere. Lo storico resta leggibile e puoi riattivarlo quando vuoi.')}</p>
            <div className="row-flex"><button className="btn" onClick={() => cambiaStato(disattiva, false)}>{t('Sì, disattiva')}</button>
              <button className="btn-ghost" autoFocus onClick={() => setDisattiva(null)}>{t('No')}</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Tre scelte grandi con descrizione (classe .seg). */
function SceltaRuolo({ valore, onChange, nome }: { valore: Ruolo; onChange: (r: Ruolo) => void; nome: string }) {
  const { t } = useT();
  return (
    <fieldset className="seg">
      <legend className="sub">{t('Ruolo')}</legend>
      {RUOLI.map(r => (
        <label key={r.v}><input type="radio" name={nome} value={r.v} checked={valore === r.v} onChange={() => onChange(r.v)} />
          <span><b>{t(r.l)}</b><span className="sub seg-d">{t(r.d)}</span></span></label>
      ))}
    </fieldset>
  );
}

/** Scelta facoltativa del dipendente collegato all'account (responsabili.dipendente_id). */
function SceltaDipendente({ valore, onChange, dipendenti, collegati, io }: { valore: string; onChange: (v: string) => void; dipendenti: Dip[]; collegati: Acc[]; io?: string }) {
  const { t } = useT();
  const occupato = (id: number) => collegati.find(a => a.dipendente_id === id && a.user_id !== io);
  return (
    <div className="field"><label htmlFor="acc-dip">{t('È anche il dipendente… (facoltativo)')}</label>
      <select id="acc-dip" value={valore} onChange={e => onChange(e.target.value)}>
        <option value="">{t('— nessuno —')}</option>
        {dipendenti.filter(d => d.attivo || String(d.id) === valore).map(d => {
          const o = occupato(d.id);
          return <option key={d.id} value={d.id} disabled={!!o}>{d.cognome} {d.nome} · {d.codice} · {d.categoria}{o ? ` (${t('già collegato a {n}', { n: o.nome })})` : ''}</option>;
        })}
      </select>
      <p className="hint">{t("Serve a riconoscere le richieste di ferie della persona stessa: l'amministratore vede quelle che ha deciso da sola.")}</p>
    </div>
  );
}

function ModaleRuolo({ a, dipendenti, collegati, onClose, onSalvato }: { a: Acc; dipendenti: Dip[]; collegati: Acc[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [r, setR] = useState<Ruolo>(a.tipo);
  const [d, setD] = useState(a.dipendente_id ? String(a.dipendente_id) : '');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      if (!a.io && r !== a.tipo) await rpc('admin_imposta_responsabile', { p_user: a.user_id, p_ruolo: r, p_attivo: a.attivo });
      const nuovo = d ? Number(d) : null;
      if (nuovo !== a.dipendente_id) await rpc('admin_collega_dipendente', { p_user: a.user_id, p_dipendente: nuovo });
      toast(t('Account aggiornato')); onSalvato();
    } catch (x) { setErr(tm(testoErrore(x))); setInvio(false); }
  }
  return (
    <Modal titolo={a.io ? t('Il tuo account') : t('Ruolo di {n}', { n: a.nome })} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        {a.io ? <p className="hint">{t('Non puoi cambiare il ruolo del tuo account: chiedi a un altro amministratore.')}</p>
          : <SceltaRuolo valore={r} onChange={setR} nome="ruolo-mod" />}
        <SceltaDipendente valore={d} onChange={setD} dipendenti={dipendenti} collegati={collegati} io={a.user_id} />
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{a.io ? t('Salva') : t('Salva ruolo')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}

function NuovoAccount({ dipendenti, collegati, onClose, onSalvato }: { dipendenti: Dip[]; collegati: Acc[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({ nome: '', email: '', ruolo: 'responsabile' as Ruolo, password: generaPassword(), dipendente: '' });
  const [err, setErr] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      // la funzione server crea admin o responsabile flotta; l'ufficio personale e il collegamento si impostano subito dopo
      await chiamaAccount({ azione: 'crea', nome: f.nome, email: f.email, password: f.password, ruolo: f.ruolo === 'admin' ? 'admin' : 'responsabile' });
      setFatto(true);
      if (f.ruolo === 'hr' || f.dipendente) {
        try {
          const { data: r } = await supabase.from('responsabili').select('user_id').ilike('email', f.email.trim()).maybeSingle();
          if (!r) throw new Error('Account non trovato');
          if (f.ruolo === 'hr') await rpc('admin_imposta_responsabile', { p_user: r.user_id, p_ruolo: 'hr', p_attivo: true });
          if (f.dipendente) await rpc('admin_collega_dipendente', { p_user: r.user_id, p_dipendente: Number(f.dipendente) });
        } catch (x) { setAvviso(t("Account creato, ma il ruolo o il collegamento non sono stati salvati ({e}). Usa «Cambia ruolo» nell'elenco.", { e: tm(testoErrore(x)) })); }
      }
    }
    catch (x) { setErr(tm((x as Error).message)); }
    finally { setInvio(false); }
  }
  return (
    <Modal titolo={t('Nuovo account')} onClose={fatto ? onSalvato : onClose}>
      {!fatto ? (
        <form className="form" onSubmit={salva}>
          <div className="field"><label htmlFor="a-nome">{t('Nome e cognome')}</label><input id="a-nome" required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-mail">{t('Email aziendale')}</label><input id="a-mail" type="email" dir="ltr" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <SceltaRuolo valore={f.ruolo} onChange={r => setF({ ...f, ruolo: r })} nome="ruolo-nuovo" />
          <SceltaDipendente valore={f.dipendente} onChange={v => setF({ ...f, dipendente: v })} dipendenti={dipendenti} collegati={collegati} />
          <div className="field"><label htmlFor="a-pw">{t('Password iniziale')}</label>
            <div className="row-flex"><input id="a-pw" dir="ltr" className="mono" required minLength={10} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={{ flex: 1 }} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ ...f, password: generaPassword() })}>{t('Genera')}</button></div></div>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" disabled={invio}>{t('Crea account')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
        </form>
      ) : (
        <div className="form">
          <Banner s="ok">{t('Account creato. Comunica di persona email e password iniziale: {e} · {p}', { e: f.email, p: f.password })}</Banner>
          {avviso && <Banner s="warn">{avviso}</Banner>}
          <p className="hint">{t('La password non sarà più visibile dopo la chiusura.')}</p>
          <button className="btn" onClick={onSalvato}>{t('Fatto')}</button>
        </div>
      )}
    </Modal>
  );
}

function NuovaPassword({ a, onClose }: { a: Acc; onClose: () => void }) {
  const { t, tm } = useT();
  const [pw, setPw] = useState(generaPassword);
  const [err, setErr] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  async function salva() {
    setErr(null);
    try { await chiamaAccount({ azione: 'password', user_id: a.user_id, password: pw }); setFatto(true); }
    catch (x) { setErr(tm((x as Error).message)); }
  }
  return (
    <Modal titolo={t('Nuova password per {n}', { n: a.nome })} onClose={onClose}>
      <div className="form">
        {!fatto ? <>
          <div className="field"><label htmlFor="np">{t('Password (almeno 10 caratteri)')}</label>
            <div className="row-flex"><input id="np" dir="ltr" className="mono" value={pw} onChange={e => setPw(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPw(generaPassword())}>{t('Genera')}</button></div></div>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" onClick={salva} disabled={pw.length < 10}>{t('Salva password')}</button><button className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
        </> : <>
          <Banner s="ok">{t('Password cambiata: {p}', { p: pw })}</Banner>
          <button className="btn" onClick={onClose}>{t('Fatto')}</button>
        </>}
      </div>
    </Modal>
  );
}
