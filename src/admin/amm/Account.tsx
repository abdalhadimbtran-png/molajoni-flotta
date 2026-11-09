import { FormEvent, useMemo, useState } from 'react';
import { fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { rpc, supabase, testoErrore } from '../../lib/supabase';
import { almenoUno, mailtoInvito, normalizza, NESSUN_PANNELLO, PANNELLI, STATO_EMAIL, type Pannelli, type StatoEmail } from '../../lib/account';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../../ui';
import { chiamaAccount } from './AreaAdmin';

type StatoAcc = 'invitato' | 'attivo' | 'disattivato';
interface Acc {
  user_id: string; nome: string; email: string; ruolo: 'admin' | 'responsabile'; attivo: boolean; creato_il: string; ultimo_accesso: string | null; io: boolean;
  flotta: boolean; hr: boolean; formazione: boolean; centralino: boolean; direzione: boolean; dipendente_id: number | null; cambio_password: boolean; invitato_il: string | null; stato: StatoAcc;
}
interface Dip { id: number; nome: string; cognome: string; codice: string; categoria: string; attivo: boolean }
interface EsitoLink { link: string; oggetto: string; testo: string; email: { id: number | null; stato: StatoEmail }; tipo?: string }

const pannelliDi = (a: Acc): Pannelli => ({ admin: a.ruolo === 'admin', flotta: a.flotta, hr: a.hr, formazione: a.formazione, centralino: a.centralino, direzione: a.direzione });
const STATO: Record<StatoAcc, { l: string; s: 'ok' | 'ko' | 'na' | 'warn' }> = { invitato: { l: 'Invitato', s: 'warn' }, attivo: { l: 'Attivo', s: 'ok' }, disattivato: { l: 'Disattivato', s: 'ko' } };
const generaPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), n => a[n % a.length]).join('') + String(crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10);
};

/** Account e ruoli: account personali dell'ufficio (email aziendale + pannelli). I dipendenti entrano con codice e PIN. */
export default function Account() {
  const { t, tm, locale } = useT();
  const { data, errore, reload } = useLoad(async () => {
    const [el, dp] = await Promise.all([
      chiamaAccount<{ account: Acc[] }>({ azione: 'elenco' }),
      supabase.from('dipendenti').select('id,nome,cognome,codice,categoria,attivo').order('cognome'),
    ]);
    return { account: el.account, dipendenti: (dp.data ?? []) as Dip[] };
  });
  const [cerca, setCerca] = useState('');
  const [nuovo, setNuovo] = useState(false);
  const [ruoli, setRuoli] = useState<Acc | null>(null);
  const [pw, setPw] = useState<Acc | null>(null);
  const [link, setLink] = useState<{ a: Acc; esito: EsitoLink } | null>(null);
  const [disattiva, setDisattiva] = useState<Acc | null>(null);
  const [lavoro, setLavoro] = useState<string | null>(null);
  const elenco = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return (data?.account ?? []).filter(a => !q || a.nome.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [data, cerca]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const dip = (id: number | null) => data.dipendenti.find(d => d.id === id);

  async function cambiaStato(a: Acc, attivo: boolean) {
    try { await chiamaAccount({ azione: 'stato', user_id: a.user_id, attivo }); toast(attivo ? t('Account riattivato') : t('Account disattivato')); setDisattiva(null); reload(); }
    catch (e) { toast(tm((e as Error).message)); }
  }
  async function inviaLink(a: Acc) {
    setLavoro(a.user_id);
    try { const esito = await chiamaAccount<EsitoLink>({ azione: 'invito', user_id: a.user_id }); setLink({ a, esito }); reload(); }
    catch (e) { toast(tm((e as Error).message)); }
    finally { setLavoro(null); }
  }

  return (
    <>
      <div className="page-hero">
        <div><h1>{t('Account e ruoli')}</h1>
          <p className="sub">{t("Account personali con email aziendale. Ognuno sceglie la sua password dal link d'invito; i pannelli si decidono qui.")}</p></div>
        <button className="btn" onClick={() => setNuovo(true)}>{t('Nuovo account')}</button>
      </div>
      <div className="row-flex" style={{ marginBottom: 12 }}>
        <input type="search" placeholder={t('Cerca per nome o email…')} value={cerca} onChange={e => setCerca(e.target.value)} style={{ flex: 1, maxWidth: 420 }} aria-label={t('Cerca')} />
        <span className="sub">{t('{n} account', { n: elenco.length })}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Nome')}</th><th>{t('Email')}</th><th>{t('Pannelli')}</th><th>{t('Stato')}</th><th>{t('Ultimo accesso')}</th><th></th></tr></thead>
        <tbody>{elenco.map(a => {
          const d = dip(a.dipendente_id);
          const p = pannelliDi(a);
          return (
            <tr key={a.user_id} className={a.attivo ? '' : 'muted'}>
              <td><span style={{ fontWeight: 600 }}>{a.nome}</span>{a.io && <span className="sub"> · {t('tu')}</span>}
                {d && <div className="sub">{t('Dipendente: {n}', { n: `${d.nome} ${d.cognome}` })}</div>}</td>
              <td className="mono" dir="ltr">{a.email}</td>
              <td><div className="row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                {p.admin ? <Pill s="info">{t('Amministratore')}</Pill> : PANNELLI.filter(x => x.v !== 'admin' && p[x.v]).map(x => <Pill key={x.v} s="na">{t(x.l)}</Pill>)}
              </div></td>
              <td><Pill s={STATO[a.stato].s}>{t(STATO[a.stato].l)}</Pill>
                {a.cambio_password && a.attivo && <div className="sub">{t('cambio password al primo accesso')}</div>}</td>
              <td className="mono">{a.ultimo_accesso ? fmtOra(a.ultimo_accesso, locale) : '—'}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setRuoli(a)}>{a.io ? t('Collega dipendente') : t('Modifica ruoli')}</button>
                {a.attivo && <button className="btn-ghost btn-sm" disabled={lavoro === a.user_id} onClick={() => inviaLink(a)}>
                  {lavoro === a.user_id ? t('Invio…') : a.stato === 'invitato' ? t('Reinvia invito') : t('Link nuova password')}</button>}
                {a.attivo && !a.io && <button className="btn-ghost btn-sm" onClick={() => setPw(a)}>{t('Password temporanea')}</button>}
                {!a.io && (a.attivo
                  ? <button className="btn-ghost btn-sm" onClick={() => setDisattiva(a)}>{t('Disattiva')}</button>
                  : <button className="btn-ghost btn-sm" onClick={() => cambiaStato(a, true)}>{t('Riattiva')}</button>)}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="hint">{t('Gli account non si cancellano: si disattivano (accesso bloccato), così lo storico resta leggibile. Ogni modifica è registrata nel registro movimenti.')}</p>
      {nuovo && <NuovoAccount dipendenti={data.dipendenti} collegati={data.account} onClose={() => setNuovo(false)} onSalvato={() => { setNuovo(false); reload(); }} />}
      {ruoli && <ModaleRuoli a={ruoli} dipendenti={data.dipendenti} collegati={data.account} onClose={() => setRuoli(null)} onSalvato={() => { setRuoli(null); reload(); }} />}
      {pw && <PasswordTemporanea a={pw} onClose={() => { setPw(null); reload(); }} />}
      {link && <Modal titolo={link.a.stato === 'invitato' ? t('Invito per {n}', { n: link.a.nome }) : t('Link nuova password per {n}', { n: link.a.nome })} onClose={() => setLink(null)}>
        <div className="form"><InvioLink email={link.a.email} esito={link.esito} /><button className="btn" onClick={() => setLink(null)}>{t('Fatto')}</button></div>
      </Modal>}
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

/** Caselle dei pannelli con descrizione. «Amministratore» comprende tutto. */
function CaselleRuoli({ valore, onChange, disabilitato }: { valore: Pannelli; onChange: (p: Pannelli) => void; disabilitato?: boolean }) {
  const { t } = useT();
  return (
    <fieldset className="seg" disabled={disabilitato}>
      <legend className="sub">{t('Pannelli e ruoli')}</legend>
      {PANNELLI.map(r => {
        const coperto = r.v !== 'admin' && valore.admin;
        return (
          <label key={r.v} style={coperto ? { opacity: .55 } : undefined}>
            <input type="checkbox" checked={valore[r.v] || coperto} disabled={coperto}
              onChange={e => onChange(normalizza({ ...valore, [r.v]: e.target.checked }))} />
            <span><b>{t(r.l)}</b><span className="sub seg-d">{t(r.d)}</span></span>
          </label>
        );
      })}
    </fieldset>
  );
}

function SceltaDipendente({ valore, onChange, dipendenti, collegati, io }: { valore: string; onChange: (v: string) => void; dipendenti: Dip[]; collegati: Acc[]; io?: string }) {
  const { t } = useT();
  const occupato = (id: number) => collegati.find(a => a.dipendente_id === id && a.user_id !== io);
  return (
    <div className="field"><label htmlFor="acc-dip">{t('Collega a un dipendente (facoltativo)')}</label>
      <select id="acc-dip" value={valore} onChange={e => onChange(e.target.value)}>
        <option value="">{t('— nessuno —')}</option>
        {dipendenti.filter(d => d.attivo || String(d.id) === valore).map(d => {
          const o = occupato(d.id);
          return <option key={d.id} value={d.id} disabled={!!o}>{d.cognome} {d.nome} · {d.codice} · {d.categoria}{o ? ` (${t('già collegato a {n}', { n: o.nome })})` : ''}</option>;
        })}
      </select>
    </div>
  );
}

/** Esito dell'invio: stato dell'email + copia link + apri in Outlook (Resend in modalità test). */
function InvioLink({ email, esito }: { email: string; esito: EsitoLink }) {
  const { t } = useT();
  const [stato, setStato] = useState<StatoEmail>(esito.email.stato);
  const [verifica, setVerifica] = useState(false);
  const se = STATO_EMAIL[stato];
  async function aggiorna() {
    if (!esito.email.id) return;
    setVerifica(true);
    try { const r = await chiamaAccount<{ stato: StatoEmail }>({ azione: 'stato_email', id: esito.email.id }); setStato(r.stato); } catch { /* resta com'è */ }
    finally { setVerifica(false); }
  }
  async function copia() {
    try { await navigator.clipboard.writeText(esito.link); toast(t('Link copiato')); }
    catch { window.prompt(t('Copia il link'), esito.link); }
  }
  return (
    <>
      <div className="row-flex"><Pill s={se.s}>{t(se.l)}</Pill>
        {stato === 'in_coda' && esito.email.id && <button className="btn-ghost btn-sm" onClick={aggiorna} disabled={verifica}>{t('Aggiorna stato')}</button>}</div>
      {stato === 'non_consegnabile_test' && <Banner s="warn">{t("Il servizio email è ancora in modalità test: consegna solo alla casella dell'amministratore finché il dominio aziendale non è verificato. Invia ora l'invito dalla tua casella con «Apri in Outlook».")}</Banner>}
      <p className="hint">{t("Nessuna password viaggia per email: la persona riceve un link sicuro e personale (valido 24 ore) per creare la sua password.")}</p>
      <div className="row-flex" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={mailtoInvito(email, esito.oggetto, esito.testo)}>{t('Apri in Outlook')}</a>
        <button type="button" className="btn-ghost" onClick={copia}>{t("Copia link d'invito")}</button>
      </div>
    </>
  );
}

function ModaleRuoli({ a, dipendenti, collegati, onClose, onSalvato }: { a: Acc; dipendenti: Dip[]; collegati: Acc[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [p, setP] = useState<Pannelli>(pannelliDi(a));
  const [d, setD] = useState(a.dipendente_id ? String(a.dipendente_id) : '');
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function cambiaRuoli(nuovi: Pannelli) {
    // modifica immediata, casella per casella
    if (!almenoUno(nuovi)) { setErr(t('Lascia almeno un pannello. Per togliere l\'accesso usa «Disattiva».')); return; }
    const prima = p; setP(nuovi); setErr(null);
    try {
      await rpc('admin_imposta_pannelli', { p_user: a.user_id, p_admin: nuovi.admin, p_flotta: nuovi.flotta, p_hr: nuovi.hr, p_formazione: nuovi.formazione, p_centralino: nuovi.centralino, p_direzione: nuovi.direzione });
      toast(t('Ruoli aggiornati'));
    } catch (x) { setP(prima); setErr(tm(testoErrore(x))); }
  }
  async function salvaDip(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const nuovo = d ? Number(d) : null;
      if (nuovo !== a.dipendente_id) await rpc('admin_collega_dipendente', { p_user: a.user_id, p_dipendente: nuovo });
      onSalvato();
    } catch (x) { setErr(tm(testoErrore(x))); setInvio(false); }
  }
  return (
    <Modal titolo={a.io ? t('Il tuo account') : t('Ruoli di {n}', { n: a.nome })} onClose={onSalvato}>
      <form className="form" onSubmit={salvaDip}>
        {a.io ? <p className="hint">{t('Non puoi cambiare i ruoli del tuo account: chiedi a un altro amministratore.')}</p>
          : <><CaselleRuoli valore={p} onChange={cambiaRuoli} /><p className="hint">{t('Le caselle si salvano subito. Con più pannelli, in alto compare il selettore per passare da uno all\'altro.')}</p></>}
        <SceltaDipendente valore={d} onChange={setD} dipendenti={dipendenti} collegati={collegati} io={a.user_id} />
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" disabled={invio}>{t('Fatto')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Chiudi')}</button></div>
      </form>
    </Modal>
  );
}

function NuovoAccount({ dipendenti, collegati, onClose, onSalvato }: { dipendenti: Dip[]; collegati: Acc[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({ nome: '', email: '', saluto: 'Benvenuta/o', dipendente: '' });
  const [p, setP] = useState<Pannelli>(NESSUN_PANNELLO);
  const [err, setErr] = useState<string | null>(null);
  const [esito, setEsito] = useState<EsitoLink | null>(null);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!almenoUno(p)) { setErr(t('Scegli almeno un pannello.')); return; }
    setInvio(true);
    try {
      setEsito(await chiamaAccount<EsitoLink>({ azione: 'crea', nome: f.nome, email: f.email, pannelli: p, saluto: f.saluto, dipendente_id: f.dipendente || null }));
    } catch (x) { setErr(tm((x as Error).message)); }
    finally { setInvio(false); }
  }
  return (
    <Modal titolo={t('Nuovo account')} onClose={esito ? onSalvato : onClose}>
      {!esito ? (
        <form className="form" onSubmit={salva}>
          <div className="field"><label htmlFor="a-nome">{t('Nome e cognome')}</label><input id="a-nome" required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-mail">{t('Email aziendale')}</label><input id="a-mail" type="email" dir="ltr" required placeholder="nome.cognome@molajoni.it" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-sal">{t("Saluto nell'email")}</label>
            <select id="a-sal" value={f.saluto} onChange={e => setF({ ...f, saluto: e.target.value })}>
              <option>Benvenuta/o</option><option>Benvenuta</option><option>Benvenuto</option></select></div>
          <CaselleRuoli valore={p} onChange={setP} />
          <SceltaDipendente valore={f.dipendente} onChange={v => setF({ ...f, dipendente: v })} dipendenti={dipendenti} collegati={collegati} />
          <Banner s="ok">{t("Non serve inventare una password: riceverà un'email «Benvenuta/o nel Portale Molajoni» con un link sicuro per crearla lei stessa. Se preferisci, dopo puoi impostare una password temporanea da cambiare al primo accesso.")}</Banner>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" disabled={invio}>{invio ? t('Creazione e invio…') : t('Crea e invia invito')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
        </form>
      ) : (
        <div className="form">
          <Banner s="ok">{t('Account creato per {e}.', { e: f.email })}</Banner>
          <InvioLink email={f.email} esito={esito} />
          <button className="btn-ghost" onClick={onSalvato}>{t('Fatto')}</button>
        </div>
      )}
    </Modal>
  );
}

/** Password temporanea (alternativa al link): da comunicare di persona, cambio obbligatorio al primo accesso. */
function PasswordTemporanea({ a, onClose }: { a: Acc; onClose: () => void }) {
  const { t, tm } = useT();
  const [pw, setPw] = useState(generaPassword);
  const [err, setErr] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  async function salva() {
    setErr(null);
    try { await chiamaAccount({ azione: 'password', user_id: a.user_id, password: pw, obbligo: true }); setFatto(true); }
    catch (x) { setErr(tm((x as Error).message)); }
  }
  return (
    <Modal titolo={t('Password temporanea per {n}', { n: a.nome })} onClose={onClose}>
      <div className="form">
        {!fatto ? <>
          <p className="hint">{t("Consigliato: «Link nuova password» (la persona sceglie la sua). Usa la password temporanea solo se devi comunicarla di persona o al telefono: non inviarla per email. Al primo accesso dovrà cambiarla.")}</p>
          <div className="field"><label htmlFor="np">{t('Password temporanea (almeno 10 caratteri)')}</label>
            <div className="row-flex"><input id="np" dir="ltr" className="mono" value={pw} onChange={e => setPw(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPw(generaPassword())}>{t('Genera')}</button></div></div>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" onClick={salva} disabled={pw.length < 10}>{t('Imposta password temporanea')}</button><button className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
        </> : <>
          <Banner s="ok">{t('Password temporanea impostata: {p}. Comunicala di persona; al primo accesso dovrà sceglierne una nuova.', { p: pw })}</Banner>
          <button className="btn" onClick={onClose}>{t('Fatto')}</button>
        </>}
      </div>
    </Modal>
  );
}
