import { FormEvent, useState } from 'react';
import { fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../../ui';
import { chiamaAccount } from './AreaAdmin';

interface Acc { user_id: string; nome: string; email: string; ruolo: 'admin' | 'responsabile'; attivo: boolean; creato_il: string; ultimo_accesso: string | null; io: boolean }

const generaPassword = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), n => a[n % a.length]).join('');
};

/** Account del pannello: amministratori e responsabili flotta. I tecnici si gestiscono in "Tecnici". */
export default function Account() {
  const { t, tm, locale } = useT();
  const { data, errore, reload } = useLoad(() => chiamaAccount<{ account: Acc[] }>({ azione: 'elenco' }));
  const [nuovo, setNuovo] = useState(false);
  const [pw, setPw] = useState<Acc | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;

  async function stato(a: Acc, attivo: boolean, ruolo: Acc['ruolo']) {
    const msg = !attivo ? t('Disattivare {n}? Non potrà più accedere.', { n: a.nome }) : ruolo !== a.ruolo ? t('Cambiare il ruolo di {n}?', { n: a.nome }) : null;
    if (msg && !window.confirm(msg)) return;
    try { await chiamaAccount({ azione: 'stato', user_id: a.user_id, attivo, ruolo }); toast(t('Account aggiornato')); reload(); }
    catch (e) { toast(tm((e as Error).message)); }
  }

  return (
    <>
      <div className="section-title">{t('Account del pannello')} <span className="meta">{t('amministratori e responsabili flotta')}</span><span className="spacer" />
        <button className="btn btn-sm" onClick={() => setNuovo(true)}>{t('Nuovo account')}</button></div>
      <div className="livelli">
        <div><b>{t('Amministratore')}</b><span>{t('Tutto il sistema: account, analisi, sicurezza e pannello responsabile.')}</span></div>
        <div><b>{t('Responsabile flotta')}</b><span>{t('Piano, veicoli, tecnici, segnalazioni, avvisi, multe, carburante.')}</span></div>
        <div><b>{t('Tecnico')}</b><span>{t('App con codice e PIN: veicolo, km, segnalazioni.')}</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Nome')}</th><th>{t('Email')}</th><th>{t('Ruolo')}</th><th>{t('Stato')}</th><th>{t('Ultimo accesso')}</th><th></th></tr></thead>
        <tbody>{data.account.map(a => (
          <tr key={a.user_id} className={a.attivo ? '' : 'muted'}>
            <td style={{ fontWeight: 600 }}>{a.nome}{a.io && <span className="sub"> · {t('tu')}</span>}</td>
            <td className="mono" dir="ltr">{a.email}</td>
            <td><Pill s={a.ruolo === 'admin' ? 'info' : 'na'}>{a.ruolo === 'admin' ? t('Amministratore') : t('Responsabile flotta')}</Pill></td>
            <td>{a.attivo ? <Pill s="ok">{t('Attivo')}</Pill> : <Pill s="ko">{t('Disattivato')}</Pill>}</td>
            <td className="mono">{a.ultimo_accesso ? fmtOra(a.ultimo_accesso, locale) : '—'}</td>
            <td className="nowrap actions">
              <button className="btn-ghost btn-sm" onClick={() => setPw(a)}>{t('Nuova password')}</button>
              {!a.io && <>
                <button className="btn-ghost btn-sm" onClick={() => stato(a, a.attivo, a.ruolo === 'admin' ? 'responsabile' : 'admin')}>{a.ruolo === 'admin' ? t('Rendi responsabile') : t('Rendi amministratore')}</button>
                <button className="btn-ghost btn-sm" onClick={() => stato(a, !a.attivo, a.ruolo)}>{a.attivo ? t('Disattiva') : t('Riattiva')}</button>
              </>}
            </td>
          </tr>))}</tbody>
      </table></div>
      <p className="hint">{t('Gli account non si cancellano: si disattivano, così lo storico resta leggibile. Ogni modifica è registrata.')}</p>
      {nuovo && <NuovoAccount onClose={() => setNuovo(false)} onSalvato={() => { setNuovo(false); reload(); }} />}
      {pw && <NuovaPassword a={pw} onClose={() => setPw(null)} />}
    </>
  );
}

function NuovoAccount({ onClose, onSalvato }: { onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({ nome: '', email: '', ruolo: 'responsabile', password: generaPassword() });
  const [err, setErr] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [invio, setInvio] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try { await chiamaAccount({ azione: 'crea', ...f }); setFatto(true); }
    catch (x) { setErr(tm((x as Error).message)); }
    finally { setInvio(false); }
  }
  return (
    <Modal titolo={t('Nuovo account')} onClose={fatto ? onSalvato : onClose}>
      {!fatto ? (
        <form className="form" onSubmit={salva}>
          <div className="field"><label htmlFor="a-nome">{t('Nome e cognome')}</label><input id="a-nome" required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-mail">{t('Email aziendale')}</label><input id="a-mail" type="email" dir="ltr" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-ruolo">{t('Ruolo')}</label>
            <select id="a-ruolo" value={f.ruolo} onChange={e => setF({ ...f, ruolo: e.target.value })}>
              <option value="responsabile">{t('Responsabile flotta')}</option><option value="admin">{t('Amministratore')}</option></select></div>
          <div className="field"><label htmlFor="a-pw">{t('Password iniziale')}</label>
            <div className="row-flex"><input id="a-pw" dir="ltr" className="mono" required minLength={10} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={{ flex: 1 }} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ ...f, password: generaPassword() })}>{t('Genera')}</button></div></div>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" disabled={invio}>{t('Crea account')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
        </form>
      ) : (
        <div className="form">
          <Banner s="ok">{t('Account creato. Comunica di persona email e password iniziale: {e} · {p}', { e: f.email, p: f.password })}</Banner>
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
