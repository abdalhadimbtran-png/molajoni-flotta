import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Errore, useLoad } from '../ui';
import { aggiornamentoObbligatorio, aperta, daAggiornareOggi, statoOfferta, type Offerta } from '../lib/centralino/offerte';
import { DIR, JEN } from '../lib/centralino/testiDirezione';
import { useAdesso, useAggiornamento, useConfig } from './comune';
import { useListaTastiera } from './tastiera';
import { useCtx } from './ShellCentralino';
import { Scheletro } from './Scheletro';
import { AzioneOfferta, AzioniRiga, PillStato, caricaOfferte, dataOra, type TipoAzione } from './OfferteComuni';

const TASTI: Record<string, TipoAzione> = { i: 'inviata', y: 'accettata', x: 'non_accettata', o: 'nota' };

/** /centralino/offerte: Jennifer aggiorna le offerte passate ai colleghi (e le sue). Regola del titolare: ogni offerta aperta va aggiornata ogni giorno. */
export default function Offerte() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso();
  const { config } = useConfig();
  const obbl = aggiornamentoObbligatorio(config?.impostazioni as unknown as Record<string, unknown> | undefined);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'mie' ? 'mie' : 'colleghi';
  const [chiuse, setChiuse] = useState(false);
  const [az, setAz] = useState<{ o: Offerta; t: TipoAzione } | null>(null);
  const { data, errore, reload } = useLoad(() => caricaOfferte(chiuse ? { da: new Date(Date.now() - 60 * 864e5).toISOString() } : { aperte: true }), [chiuse, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r, 60000);
  const lista = useRef<HTMLElement>(null);
  useListaTastiera(lista, '.of-riga');
  const righe = useMemo(() => {
    const l = (data ?? []).filter(o => (tab === 'mie' ? o.gestione === 'jennifer' : o.gestione === 'collega') && (chiuse || aperta(o)));
    // in cima: da aggiornare oggi, poi in ritardo, poi per scadenza
    const peso = (o: Offerta) => (obbl && daAggiornareOggi(o, ora) ? 0 : ['in_ritardo', 'scaduta'].includes(statoOfferta(o, ora)) ? 1 : aperta(o) ? 2 : 3);
    return l.sort((a, b) => peso(a) - peso(b) || a.scadenza.localeCompare(b.scadenza));
  }, [data, tab, chiuse, ora, obbl]);
  const nAgg = obbl ? (data ?? []).filter(o => daAggiornareOggi(o, ora)) : [];
  const nTab = (t: 'jennifer' | 'collega') => nAgg.filter(o => o.gestione === t).length;

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (data === undefined || (data === null && !errore && !righe)) return <Scheletro tessere={0} righe={8} />;
  if (data === null) return <div className="of-pag"><h1>{JEN.titolo.it}</h1><Banner s="warn">{DIR.db_mancante.it}</Banner></div>;

  return (
    <div className="of-pag">
      <header className="of-h">
        <div><h1>{JEN.titolo.it}</h1><p className="sub">{obbl ? JEN.regola.it : JEN.facoltativo.it} <span className="k-hint"><kbd>J</kbd><kbd>K</kbd> scorri · <kbd>I</kbd> inviata · <kbd>Y</kbd> accettata · <kbd>X</kbd> non accettata · <kbd>O</kbd> nota · <kbd>Invio</kbd> apri</span></p></div>
        <div className="segmented" role="tablist" aria-label="Offerte">
          <button role="tab" aria-selected={tab === 'colleghi'} className={tab === 'colleghi' ? 'on' : ''} onClick={() => setSp({})}>{JEN.tab_colleghi.it}{nTab('collega') > 0 && <span className="of-n">{nTab('collega')}</span>}</button>
          <button role="tab" aria-selected={tab === 'mie'} className={tab === 'mie' ? 'on' : ''} onClick={() => setSp({ tab: 'mie' })}>{JEN.tab_mie.it}{nTab('jennifer') > 0 && <span className="of-n">{nTab('jennifer')}</span>}</button>
        </div>
      </header>
      {nAgg.length > 0 && <div className="of-allarme" role="alert"><b>{nAgg.length}</b> {JEN.banner_oggi.it}</div>}
      <label className="of-chk"><input type="checkbox" checked={chiuse} onChange={e => setChiuse(e.target.checked)} /> {JEN.chiuse.it}</label>
      <section ref={lista} className="of-tab-w">
        {righe.length === 0 ? <p className="ct-vuoto">{JEN.nessuna.it}</p> :
          <table className="of-tab">
            <thead><tr><th>{DIR.col_cliente.it}</th><th>{DIR.col_richiesta.it}</th><th>{DIR.col_gestita.it}</th><th>{DIR.col_arrivata.it}</th><th>{JEN.col_scadenza.it}</th><th>{DIR.col_stato.it}</th><th>{JEN.col_ultimo.it}</th><th /></tr></thead>
            <tbody>{righe.map(o => {
              const agg = obbl && daAggiornareOggi(o, ora);
              return (
                <tr key={o.pratica_id} className={`of-riga ${agg ? 'of-agg' : ''}`} tabIndex={0}
                  onClick={() => nav(`${ctx.base}/pratica/${o.pratica_id}`)}
                  onKeyDown={e => {
                    if (e.ctrlKey || e.metaKey || e.altKey || e.target !== e.currentTarget) return;
                    if (e.key === 'Enter') { e.preventDefault(); nav(`${ctx.base}/pratica/${o.pratica_id}`); return; }
                    const t = TASTI[e.key.toLowerCase()];
                    if (t && ctx.scrive) { e.preventDefault(); setAz({ o, t }); }
                  }}>
                  <td><b>{o.pratiche?.cliente_nome ?? '—'}</b><span className="sub of-num">{o.pratiche?.numero}</span></td>
                  <td className="of-desc">{o.pratiche?.descrizione ?? '—'}</td>
                  <td>{o.gestita_da}</td>
                  <td className="of-nowrap">{dataOra(o.arrivata_il)}</td>
                  <td className="of-nowrap">{o.inviata_il ? <span className="sub">inviata {dataOra(o.inviata_il)}</span> : dataOra(o.scadenza)}</td>
                  <td><PillStato o={o} ora={ora} />{agg && <span className="of-pill of-giallo">{JEN.da_aggiornare.it}</span>}</td>
                  <td className="of-nowrap">{dataOra(o.aggiornata_il)}{o.aggiornata_da ? <span className="sub"> · {o.aggiornata_da.split(' ')[0]}</span> : null}</td>
                  <td>{ctx.scrive && <AzioniRiga o={o} onAzione={t => setAz({ o, t })} />}</td>
                </tr>);
            })}</tbody>
          </table>}
      </section>
      {az && <AzioneOfferta o={az.o} tipo={az.t} onClose={() => setAz(null)} onFatto={() => { setAz(null); reload(); ctx.aggiorna(); }} />}
    </div>
  );
}
