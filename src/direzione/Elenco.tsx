import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { Banner, Errore, toast, useLoad } from '../ui';
import type { Col, Report, Riga } from '../admin/report/catalogo';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { Scheletro } from '../centralino/Scheletro';
import { TagDopo } from '../centralino/componenti';
import { caricaOfferte, dataOra } from '../centralino/OfferteComuni';
import { useAdesso } from '../centralino/comune';
import { fineGiornoRoma, inizioGiornoRoma } from '../lib/centralino/sla';
import { DEFS, PARAMETRI, defDrill, rigaDrill, righeDrill, type DatiDrill, type ParDrill } from '../lib/centralino/drill';
import { ANALISI, CANALI_NOMI, DIR, ELENCO, STATI_OFFERTA, TIPI_RICHIESTA } from '../lib/centralino/testiDirezione';
import { BASE, oggiRoma } from './comuni';
import { indietro, useRicordaScroll } from './scroll';

/** Carica i dati di un numero: la stessa fonte della pagina Direzione (stesso periodo, stessi filtri). */
export async function datiDrill(fonte: string, da: string, a: string): Promise<DatiDrill> {
  if (fonte === 'offerte_aperte') return { off: await caricaOfferte({ aperte: true }), pratiche: [], chiuse: [] };
  if (fonte === 'offerte') return { off: await caricaOfferte({ da: inizioGiornoRoma(da), a: fineGiornoRoma(a) }), pratiche: [], chiuse: [] };
  const d = await datiPeriodo(da, a);
  return { off: null, pratiche: d.pratiche, chiuse: d.chiuse };
}

const gg = (s: string) => s.split('-').reverse().join('/');
const nomePar = (k: keyof ParDrill, v: string) => {
  if (k === 'chi') return `${ELENCO.filtro_chi.it}: ${v === 'jennifer' ? DIR.jennifer.it : DIR.colleghi.it}`;
  if (k === 'gruppo') return `${ELENCO.col_tipo.it}: ${(TIPI_RICHIESTA as Record<string, { it: string }>)[v]?.it ?? v}`;
  if (k === 'canale') return `${ELENCO.col_canale.it}: ${(CANALI_NOMI as Record<string, { it: string }>)[v]?.it ?? v}`;
  if (k === 'stato') return `${DIR.col_stato.it}: ${(STATI_OFFERTA as Record<string, { it: string }>)[v]?.it ?? v}`;
  if (k === 'giorno') return `${ELENCO.filtro_giorno.it}: ${gg(v)}`;
  const l = { persona: ELENCO.filtro_persona.it, motivo: ELENCO.filtro_motivo.it, motivo_rit: ELENCO.filtro_motivo_rit.it }[k as 'persona'];
  return `${l}: ${v}`;
};

/**
 * /direzione/centralino/elenco?n=…&da=…&a=…&… — le righe ESATTE contate da un numero della Direzione.
 * Titolo = etichetta del numero, sotto definizione e periodo. Clic su una riga → pratica completa. Excel della lista.
 */
export default function ElencoDirezione() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso(30000);
  const [qs] = useSearchParams();
  const def = defDrill(qs.get('n') ?? '') ?? DEFS[0];
  const oggi = oggiRoma();
  const da = qs.get('da') ?? oggi, a = qs.get('a') ?? oggi;
  const par: ParDrill = Object.fromEntries(PARAMETRI.map(k => [k, qs.get(k) ?? '']).filter(([, v]) => v));
  const { data, errore, reload } = useLoad(() => datiDrill(def.fonte, da, a), [def.fonte, da, a, ctx.versione]);
  const righe = useMemo(() => (data ? righeDrill(def, data, par, ora).map(r => rigaDrill(r, ora)) : null), [data, def, qs.toString(), ora]); // eslint-disable-line react-hooks/exhaustive-deps
  useRicordaScroll(!!righe);
  const [esporto, setEsporto] = useState(false);
  const offerte = def.fonte.startsWith('offerte');
  const periodo = def.fonte === 'offerte_aperte' ? ELENCO.tutte_le_date.it : `${gg(da)}${da !== a ? ` – ${gg(a)}` : ''}`;
  const filtri = PARAMETRI.filter(k => par[k]).map(k => nomePar(k, par[k]!));
  const titolo = def.t.it + (filtri.length ? ` · ${filtri.join(' · ')}` : '');

  const c = (k: string, l: string, t: Col['t'], w: number): Col => ({ k, l, t, w });
  const colonne: Col[] = [c('arrivo', ELENCO.col_arrivo.it, 'dataora', 16), c('cliente', DIR.col_cliente.it, 'testo', 26), c('cosa', ELENCO.col_cosa.it, 'testo', 34), c('canale', ELENCO.col_canale.it, 'testo', 14),
    c('tipo', ELENCO.col_tipo.it, 'testo', 18), c('gestita', DIR.col_gestita.it, 'testo', 18), c('stato', DIR.col_stato.it, 'testo', 14),
    ...(offerte ? [c('inviata', DIR.col_inviata.it, 'dataora', 16), c('esito', ELENCO.col_esito.it, 'testo', 14), c('motivo', DIR.col_motivo.it, 'testo', 30)] : [])];

  async function esporta() {
    if (!righe) return;
    setEsporto(true);
    try {
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const rep: Report = { id: `dz_${def.id}`, titolo: def.t.it, descrizione: def.t.def ?? '', gruppo: 'Controllo e costi', periodo: 'intervallo', filtri: {}, colonne, orizzontale: true,
        riepilogo: () => [{ l: ANALISI.elementi.it, v: String(righe.length) }] };
      await m.esportaExcel(rep, righe as unknown as Riga[], { periodo, filtri: filtri.join(' · '), autore: u.user?.email ?? 'direzione', generato: new Date(), prodotto: 'Direzione' });
      toast(ELENCO.pronto.it);
    } catch (e) { toast(testoErrore(e)); } finally { setEsporto(false); }
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  return (
    <div className="dz-pag dz-elenco">
      <button type="button" className="ct-indietro btn-link" onClick={() => indietro(nav as (to: string | number) => void, BASE)}>{ANALISI.indietro.it}</button>
      <div className="page-hero"><div>
        <h1>{titolo}</h1>
        <p className="dz2-def">{def.t.def}</p>
        <p className="sub">{ELENCO.periodo.it}: <b>{periodo}</b>{righe && <> · <b className="dz-el-n">{righe.length}</b> {ELENCO.quanti.it}</>}</p>
      </div>
        <button className="btn" onClick={esporta} disabled={!righe?.length || esporto}>{esporto ? ELENCO.preparo.it : ELENCO.excel.it}</button>
      </div>
      {offerte && data && data.off === null && <Banner s="warn">{DIR.db_mancante.it}</Banner>}
      {!righe ? <Scheletro righe={8} /> : righe.length === 0 ? <p className="ct-vuoto">{ELENCO.vuoto.it}</p> : <>
        <p className="dz2-def">{ELENCO.apri.it}</p>
        <div className="dz2-scroll"><table className="dz2-tab dz2-tutte dz-el-tab">
          <thead><tr>{colonne.map(x => <th key={x.k}>{x.l}</th>)}</tr></thead>
          <tbody>{righe.map(r => <tr key={r.id} className="ct-clic" tabIndex={0} onClick={() => nav(`${BASE}/scheda/${r.id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`${BASE}/scheda/${r.id}`); }}>
            <td className="of-nowrap">{dataOra(r.arrivo)}</td>
            <td><b>{r.cliente}</b> <TagDopo p={{ registrata_dopo: r.dopo }} /><div className="sub">{r.numero}</div></td>
            <td className="dz2-desc">{r.cosa}</td><td>{r.canale}</td><td>{r.tipo}</td><td>{r.gestita}</td><td>{r.stato}</td>
            {offerte && <><td className="of-nowrap">{r.inviata ? dataOra(r.inviata) : '—'}</td><td>{r.esito}</td><td>{r.motivo}</td></>}
          </tr>)}</tbody>
        </table></div>
      </>}
    </div>
  );
}
