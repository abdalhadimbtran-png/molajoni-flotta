import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../../lib/supabase';
import { useT } from '../../lib/i18n';
import { Caricamento, Errore, Modal, Pill, toast, useLoad } from '../../ui';
import { avvisiTutti, domani, oggi, percorsiDel, salva, type Percorso } from '../../lib/percorsi/piano';

interface Tec { id: number; nome: string; cognome: string }
const ore = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}′`;

/** Riepilogo percorsi di un giorno (per cruscotto flotta e panoramica amministratore). */
export function RiepilogoPercorsi({ giorno, titolo }: { giorno: string; titolo: string }) {
  const { t } = useT();
  const { data } = useLoad(async () => {
    const [tc, pp] = await Promise.all([supabase.from('tecnici').select('id', { count: 'exact', head: true }).eq('attivo', true), percorsiDel(giorno)]);
    return { tot: tc.count ?? 0, pp };
  }, [giorno]);
  if (!data) return null;
  const pianificati = new Set(data.pp.filter(p => p.tecnico_id != null).map(p => p.tecnico_id)).size;
  const avvisi = data.pp.reduce((s, p) => s + avvisiTutti(p).length, 0);
  const km = data.pp.reduce((s, p) => s + (p.risultato?.totali.km ?? 0), 0);
  return (
    <Link to={`/percorsi?data=${giorno}`} className={`kpi ${avvisi ? 'warn' : pianificati ? 'ok' : 'info'}`}>
      <div className="lbl">{t(titolo)}</div>
      <div className="num">{pianificati}/{data.tot}</div>
      <div className="sub">{t('tecnici pianificati · avvisi {n}', { n: avvisi })}{km ? ` · ${Math.round(km)} km` : ''}</div>
    </Link>
  );
}

/** Cruscotto dei percorsi: una scheda per tecnico attivo nel giorno scelto. */
export default function Percorsi() {
  const { t, tm, locale } = useT();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const giorno = sp.get('data') || domani();
  const [dup, setDup] = useState<{ tec: Tec; da: string } | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [tc, pp] = await Promise.all([supabase.from('tecnici').select('id,nome,cognome').eq('attivo', true).order('cognome'), percorsiDel(giorno)]);
    if (tc.error) throw tc.error;
    return { tecnici: tc.data as Tec[], pp };
  }, [giorno]);
  const setGiorno = (d: string) => setSp({ data: d });

  async function duplica() {
    if (!dup) return;
    try {
      const src = (await percorsiDel(dup.da)).find(p => p.tecnico_id === dup.tec.id);
      if (!src) { toast(t('Nessun percorso di {n} il giorno scelto.', { n: dup.tec.nome })); return; }
      const nid = await salva({ ...src, id: undefined, data: giorno, stato: 'bozza' });
      setDup(null); nav(`/percorsi/${nid}`);
    } catch (e) { toast(testoErrore(e)); }
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const lbl = new Date(giorno + 'T12:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="percorsi">
      <div className="page-hero">
        <div><h1>{t('Percorsi')}</h1><p className="sub">{lbl}</p></div>
        <div className="perc-bar">
          <div className="segmented" role="group" aria-label={t('Giorno')}>
            <button className={giorno === oggi() ? 'on' : ''} onClick={() => setGiorno(oggi())}>{t('Oggi')}</button>
            <button className={giorno === domani() ? 'on' : ''} onClick={() => setGiorno(domani())}>{t('Domani')}</button>
          </div>
          <input type="date" value={giorno} onChange={e => e.target.value && setGiorno(e.target.value)} />
          <Link className="btn brand" to={`/percorsi/nuovo?data=${giorno}`}>{t('Nuovo percorso')}</Link>
        </div>
      </div>
      {!data ? <Caricamento /> : (() => {
        const perTec = new Map(data.pp.filter(p => p.tecnico_id != null).map(p => [p.tecnico_id!, p]));
        const senzaTec = data.pp.filter(p => p.tecnico_id == null);
        const tot = data.pp.reduce((s, p) => ({ km: s.km + (p.risultato?.totali.km ?? 0), guida: s.guida + (p.risultato?.totali.guida ?? 0), lavoro: s.lavoro + (p.risultato?.totali.lavoro ?? 0) }), { km: 0, guida: 0, lavoro: 0 });
        const tardi = data.pp.map(p => p.risultato?.totali.fine).filter(Boolean).sort().pop();
        const scheda = (p: Percorso | undefined, tec: Tec | null) => {
          const R = p?.risultato; const avv = p ? avvisiTutti(p) : [];
          return (
            <div className="card perc-card" key={p?.id ?? `t${tec?.id}`}>
              <div className="perc-card-h"><strong>{tec ? `${tec.nome} ${tec.cognome}` : t('Senza tecnico')}</strong>
                {!p ? <Pill s="info">{t('Nessun percorso')}</Pill> : p.stato === 'confermato' ? <Pill s="ok">{t('Confermato')}</Pill> : <Pill s="warn">{t('Bozza')}</Pill>}</div>
              {p && <div className="perc-card-n">
                <span>{t('{n} tappe', { n: p.stops.length })}</span>
                {R && <><span>{R.totali.km} km</span><span>{t('guida {o}', { o: ore(R.totali.guida) })}</span><span>{t('lavoro {o}', { o: ore(R.totali.lavoro) })}</span>
                  <span>{R.totali.partenza} → {R.totali.fine}</span></>}
              </div>}
              {p && p.stops.length > 0 && <ol className="perc-card-l">{(R ? R.ordine.map(id => p.stops.find(s => s.id === id)).filter(Boolean) : p.stops).map(s => s && (
                <li key={s.id} title={[s.attivita, s.note].filter(Boolean).join(' — ')}>{s.nome || s.indirizzo || '—'}{s.attivita ? <span className="sub"> · {s.attivita}</span> : null}{s.note ? <span className="sub"> · {s.note.length > 40 ? s.note.slice(0, 40) + '…' : s.note}</span> : null}{(s.allegati ?? []).some(a => !a.rimosso) ? ' 📎' : ''}</li>))}</ol>}
              {avv.map(a => <div key={a} className="perc-avv">⚠ {tm(a)}</div>)}
              <div className="perc-bar">
                {p ? <Link className="btn btn-sm" to={`/percorsi/${p.id}`}>{t('Apri')}</Link>
                  : tec && <Link className="btn btn-sm" to={`/percorsi/nuovo?data=${giorno}&tecnico=${tec.id}`}>{t('Crea')}</Link>}
                {!p && tec && <button className="btn-ghost btn-sm" onClick={() => setDup({ tec, da: giorno === oggi() ? '' : oggi() })}>{t('Duplica da altro giorno')}</button>}
              </div>
            </div>);
        };
        return <>
          <div className="kpis">
            <div className="kpi"><div className="lbl">{t('Tecnici pianificati')}</div><div className="num">{perTec.size}/{data.tecnici.length}</div></div>
            <div className="kpi"><div className="lbl">{t('Km totali')}</div><div className="num">{Math.round(tot.km)}</div></div>
            <div className="kpi"><div className="lbl">{t('Guida totale')}</div><div className="num num-sm">{ore(tot.guida)}</div></div>
            <div className="kpi"><div className="lbl">{t('Rientro più tardivo')}</div><div className="num">{tardi ?? '—'}</div></div>
          </div>
          <div className="perc-griglia">
            {data.tecnici.map(x => scheda(perTec.get(x.id), x))}
            {senzaTec.map(p => scheda(p, null))}
          </div>
          {!data.tecnici.length && <p className="sub">{t('Nessun tecnico attivo.')}</p>}
        </>;
      })()}
      {dup && <Modal titolo={t('Duplica percorso di {n}', { n: dup.tec.nome })} onClose={() => setDup(null)}>
        <div className="field"><label>{t('Copia dal giorno')}</label><input type="date" value={dup.da} onChange={e => setDup({ ...dup, da: e.target.value })} /></div>
        <p className="hint">{t('Viene creata una bozza per il {d} con le stesse tappe: ricalcola gli orari prima di confermare.', { d: new Date(giorno + 'T12:00').toLocaleDateString(locale) })}</p>
        <button className="btn" disabled={!dup.da} onClick={duplica}>{t('Duplica')}</button>
      </Modal>}
    </div>
  );
}
