import { rpc, supabase, testoErrore } from '../../lib/supabase';
import { fmtOra } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Caricamento, Errore, Pill, toast, useLoad } from '../../ui';

interface Tc { id: number; nome: string; codice: string; ultimo_accesso: string | null; sessioni_attive: number; dispositivi: number; bloccato: boolean; ha_pin: boolean }
interface Riga { id: number; azione: string; record_id: string; dopo: Record<string, unknown> | null; creato_il: string }

/** Accessi dei tecnici, sessioni aperte e registro delle modifiche agli account. */
export default function Sicurezza() {
  const { t, tm, locale } = useT();
  const { data, errore, reload } = useLoad(async () => {
    const [a, log] = await Promise.all([
      rpc<{ tecnici: Tc[] }>('analisi_admin', { p_mesi: 1 }),
      supabase.from('audit_log').select('id,azione,record_id,dopo,creato_il').eq('tabella', 'account').order('creato_il', { ascending: false }).limit(30),
    ]);
    if (log.error) throw log.error;
    return { tecnici: a.tecnici, log: log.data as Riga[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;

  async function chiudi(x: Tc) {
    if (!window.confirm(t('Disconnettere {n} da tutti i telefoni? Dovrà accedere di nuovo con codice e PIN.', { n: x.nome }))) return;
    try { const n = await rpc<number>('admin_revoca_sessioni', { p_tecnico: x.id }); toast(t('{n} sessioni chiuse', { n })); reload(); }
    catch (e) { toast(tm(testoErrore(e))); }
  }
  async function sblocca(x: Tc) {
    const { error } = await supabase.from('tecnici').update({ tentativi_falliti: 0, bloccato_fino: null }).eq('id', x.id);
    if (error) toast(tm(testoErrore(error))); else { toast(t('Accesso sbloccato')); reload(); }
  }

  return (
    <>
      <div className="section-title">{t('Accessi dei tecnici')} <span className="meta">{t('un telefono perso? Chiudi le sessioni e genera un PIN nuovo')}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Tecnico')}</th><th>{t('Stato')}</th><th className="num-c">{t('Telefoni connessi')}</th><th className="num-c">{t('Notifiche attive')}</th><th>{t('Ultimo accesso')}</th><th></th></tr></thead>
        <tbody>{data.tecnici.map(x => (
          <tr key={x.id}><td><b>{x.nome}</b><div className="sub mono">{x.codice}</div></td>
            <td>{x.bloccato ? <Pill s="ko">{t('Bloccato')}</Pill> : !x.ha_pin ? <Pill s="warn">{t('PIN da impostare')}</Pill> : <Pill s="ok">{t('Regolare')}</Pill>}</td>
            <td className="mono num-c">{x.sessioni_attive}</td>
            <td className="num-c">{x.dispositivi ? <span className="mono">{x.dispositivi}</span> : <Pill s="warn">{t('No')}</Pill>}</td>
            <td className="mono">{x.ultimo_accesso ? fmtOra(x.ultimo_accesso, locale) : '—'}</td>
            <td className="nowrap actions">
              {x.sessioni_attive > 0 && <button className="btn-ghost btn-sm" onClick={() => chiudi(x)}>{t('Disconnetti')}</button>}
              {x.bloccato && <button className="btn-ghost btn-sm" onClick={() => sblocca(x)}>{t('Sblocca')}</button>}
            </td></tr>))}</tbody>
      </table></div>

      <div className="section-title">{t('Modifiche agli account del pannello')}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Quando')}</th><th>{t('Operazione')}</th><th>{t('Dettaglio')}</th></tr></thead>
        <tbody>{data.log.length ? data.log.map(r => (
          <tr key={r.id}><td className="mono">{fmtOra(r.creato_il, locale)}</td>
            <td>{r.azione === 'CREA' ? t('Account creato') : r.azione === 'PASSWORD' ? t('Password cambiata') : t('Ruolo o stato cambiato')}</td>
            <td className="sub">{r.dopo ? Object.entries(r.dopo).filter(([k]) => k !== 'cambiata').map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : ''}</td></tr>))
          : <tr><td colSpan={3} className="sub">{t('Nessuna modifica registrata')}</td></tr>}</tbody>
      </table></div>

      <div className="section-title">{t('Impostazioni consigliate (pannello Supabase › Authentication)')}</div>
      <div className="panel"><ol className="lista-check">
        <li>{t('Disattivare «Allow new users to sign up»: gli account si creano solo da qui.')}</li>
        <li>{t('Attivare «Leaked password protection».')}</li>
        <li>{t('Impostare Site URL = https://molajoni-flotta.vercel.app')}</li>
      </ol></div>
    </>
  );
}
