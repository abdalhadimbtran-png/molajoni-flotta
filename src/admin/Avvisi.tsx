import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, Pill, toast, useLoad } from '../ui';

interface T { id: number; nome: string; cognome: string; patente_scadenza: string | null }
interface Inviato { id: number; tecnico_id: number; dati: { livello: string; titolo: string; testo?: string; ora?: string; luogo?: string }; creato_il: string; letta_il: string | null; tecnici: { nome: string; cognome: string } | null }

/** Avvisi manuali ai tecnici: urgenze, patente in scadenza, comunicazioni. */
export default function Avvisi() {
  const { t, tm, locale } = useT();
  const [sp] = useSearchParams();
  const { data, errore, reload } = useLoad(async () => {
    const [tc, n] = await Promise.all([
      supabase.from('tecnici').select('id,nome,cognome,patente_scadenza').eq('attivo', true).order('cognome'),
      supabase.from('notifiche').select('id,tecnico_id,dati,creato_il,letta_il,tecnici(nome,cognome)').eq('tipo', 'avviso').order('creato_il', { ascending: false }).limit(100),
    ]);
    if (tc.error) throw tc.error; if (n.error) throw n.error;
    return { tecnici: tc.data as T[], inviati: n.data as unknown as Inviato[] };
  });
  const pre = sp.get('t');
  const modello = sp.get('modello');
  const [sel, setSel] = useState<number[]>(pre ? [Number(pre)] : []);
  const [f, setF] = useState(() => ({
    livello: modello === 'patente' ? 'importante' : 'urgente',
    titolo: modello === 'patente' ? 'Patente in scadenza' : '',
    testo: modello === 'patente' ? `La tua patente scade il ${sp.get('d') ?? ''}. Rinnovala e porta la nuova in ufficio.` : '',
    ora: '', luogo: '', contatto: '', telefono: '', targa: '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function invia(e: FormEvent) {
    e.preventDefault(); setErr(null); setInvio(true);
    try {
      const r = await rpc<{ inviati: number }>('invia_avviso', { p_tecnici: sel, p_livello: f.livello, p_titolo: f.titolo, p_testo: f.testo,
        p_ora: f.ora || null, p_luogo: f.luogo || null, p_contatto: f.contatto || null, p_telefono: f.telefono || null, p_targa: f.targa || null });
      toast(t('Avviso inviato a {n} tecnici', { n: r.inviati }));
      setF({ ...f, titolo: '', testo: '', ora: '', luogo: '', contatto: '', telefono: '', targa: '' }); setSel([]); reload();
    } catch (x) { setErr(tm(testoErrore(x))); }
    finally { setInvio(false); }
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const tutti = sel.length === data.tecnici.length;
  return (
    <>
      <div className="section-title">{t('Invia un avviso ai tecnici')}</div>
      <form className="panel form" onSubmit={invia}>
        <div className="field"><label htmlFor="av-chi">{t('A chi')}</label>
          <div className="row-flex">
            <select id="av-chi" value="" onChange={e => { const id = Number(e.target.value); if (id && !sel.includes(id)) setSel([...sel, id]); }} style={{ minWidth: 260 }}>
              <option value="">{sel.length ? t('Aggiungi un altro tecnico…') : t('Scegli il tecnico…')}</option>
              {data.tecnici.filter(x => !sel.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.cognome} {x.nome}</option>)}
            </select>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSel(tutti ? [] : data.tecnici.map(x => x.id))}>{tutti ? t('Togli tutti') : t('Tutti i tecnici')}</button>
          </div>
          {sel.length > 0 && <div className="scelte-tec">{sel.map(id => { const x = data.tecnici.find(y => y.id === id); return x ? (
            <button type="button" key={id} className="on" onClick={() => setSel(sel.filter(y => y !== id))} aria-label={t('Togli {n}', { n: `${x.nome} ${x.cognome}` })}>{x.nome} {x.cognome} ✕</button>) : null; })}</div>}
        </div>
        <div className="field"><span className="lbl-sm">{t('Tipo')}</span>
          <div className="scelte-liv">{(['urgente', 'importante', 'info'] as const).map(l => (
            <button type="button" key={l} className={`${l} ${f.livello === l ? 'on' : ''}`} onClick={() => setF({ ...f, livello: l })}>
              {l === 'urgente' ? `🔴 ${t('Urgente')}` : l === 'importante' ? `⚠️ ${t('Importante')}` : `ℹ️ ${t('Informazione')}`}</button>))}</div></div>
        <div className="form grid2">
          <div className="field span2"><label htmlFor="av-t">{t('Titolo')}</label><input id="av-t" required value={f.titolo} onChange={set('titolo')} placeholder={t('Es. Intervento urgente: allarme IRAI')} /></div>
          <div className="field"><label htmlFor="av-o">{t('Quando')}</label><input id="av-o" value={f.ora} onChange={set('ora')} placeholder={t('Es. Subito / oggi 14:30')} /></div>
          <div className="field"><label htmlFor="av-l">{t('Dove')}</label><input id="av-l" value={f.luogo} onChange={set('luogo')} placeholder={t('Cliente e indirizzo')} /></div>
          <div className="field"><label htmlFor="av-c">{t('Contatto sul posto')}</label><input id="av-c" value={f.contatto} onChange={set('contatto')} /></div>
          <div className="field"><label htmlFor="av-p">{t('Telefono')}</label><input id="av-p" dir="ltr" inputMode="tel" value={f.telefono} onChange={set('telefono')} /></div>
          <div className="field"><label htmlFor="av-v">{t('Veicolo (facoltativo)')}</label><input id="av-v" dir="ltr" value={f.targa} onChange={set('targa')} placeholder="AB 123 CD" /></div>
          <div className="field span2"><label htmlFor="av-x">{t('Messaggio')}</label><textarea id="av-x" value={f.testo} onChange={set('testo')} placeholder={t('Cosa deve fare, in poche parole')} /></div>
        </div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className={`btn ${f.livello === 'urgente' ? 'brand' : ''}`} disabled={invio || !sel.length}>{t('Invia a {n} tecnici', { n: sel.length })}</button>
          <span className="sub">{t('Il tecnico lo vede in alto nell\'app e riceve la notifica sul telefono. Qui sotto vedi chi l\'ha letto.')}</span></div>
      </form>

      <div className="section-title">{t('Avvisi inviati')}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Inviato')}</th><th>{t('Tecnico')}</th><th>{t('Avviso')}</th><th>{t('Letto')}</th></tr></thead>
        <tbody>{data.inviati.length ? data.inviati.map(n => (
          <tr key={n.id}>
            <td className="mono">{fmtOra(n.creato_il, locale)}</td>
            <td>{n.tecnici ? `${n.tecnici.nome} ${n.tecnici.cognome}` : '—'}</td>
            <td className="wrap-cell"><Pill s={n.dati.livello === 'urgente' ? 'ko' : n.dati.livello === 'importante' ? 'warn' : 'info'}>{t(n.dati.livello === 'urgente' ? 'Urgente' : n.dati.livello === 'importante' ? 'Importante' : 'Informazione')}</Pill> <b>{n.dati.titolo}</b>
              <div className="sub">{[n.dati.ora, n.dati.luogo, n.dati.testo].filter(Boolean).join(' · ')}</div></td>
            <td>{n.letta_il ? <span className="msg ok">{fmtOra(n.letta_il, locale)}</span> : <span className="msg warn">{t('Non ancora')}</span>}</td>
          </tr>)) : <tr><td colSpan={4} className="sub">{t('Nessun avviso inviato')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Patente in scadenza: da Tecnici usa "Avvisa" accanto al tecnico, il messaggio è già pronto.')}</p>
    </>
  );
}
