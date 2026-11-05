import { DragEvent, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { Banner, Caricamento, Errore, toast, useLoad } from '../ui';
import { NOME_TIPO, SCRIPT_TELEFONO, indiceStadio, prossimoStadio, type Pratica, type Stadio, type TipoPratica } from '../lib/centralino/tipi';
import { giornoRoma, semaforo } from '../lib/centralino/sla';
import { praticheAperte, praticheChiuseDal, useAdesso, useAggiornamento, useConfig } from './comune';
import { CardPratica, Ic, Vuoto } from './componenti';
import Avanza, { avanzaDiretto } from './Avanza';
import { ModaleTrasferimento, RigaTrasf, daRichiamare, segnaRichiamato, trasferimenti } from './Trasferimento';
import ModaleEmail from './ModaleEmail';
import { senzaRiepilogo, type Trasferimento } from '../lib/centralino/tipi';
import { useCtx } from './ShellCentralino';

interface Registro { telefonate: number; whatsapp: number; email: number; offerte_tablet: number; offerte_whatsapp: number; offerte_cliente: number; aggiornamenti_anagrafica: number; chiamate_info: number; pratiche: number; chiuse: number }

const PESO: Record<string, number> = { rosso: 0, arancio: 1, verde: 2, nessuno: 3 };

/** Pannello di Jennifer: cosa fare adesso, scadenze, kanban per tipo, registro del giorno. */
export default function Home() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso();
  const { config } = useConfig();
  const inizioGiorno = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const { data, errore, reload } = useLoad(async () => {
    const [aperte, chiuse, reg, cop, tr] = await Promise.all([
      praticheAperte(), praticheChiuseDal(inizioGiorno), rpc<Registro>('centralino_registro_giorno', { p_data: null }),
      rpc<{ assenti: string[]; sostituto: string }>('centralino_copertura', {}).catch(() => null), trasferimenti(new Date(Date.now() - 7 * 864e5).toISOString()),
    ]);
    return { aperte, chiuse, reg, cop, tr };
  }, [ctx.versione]);
  const ricarica = useCallback(() => { reload(); }, [reload]);
  useAggiornamento(ricarica);
  const [avanza, setAvanza] = useState<{ p: Pratica; s?: Stadio | null } | null>(null);
  const [trasf, setTrasf] = useState(false);
  const [riep, setRiep] = useState<Trasferimento | null>(null);
  const [tipoK, setTipoK] = useState<TipoPratica>('manutenzione');
  const [trascina, setTrascina] = useState<number | null>(null);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Caricamento />;
  const fl = (t: string) => config.flussi.find(f => f.tipo === t);
  const soglia = Number(config.impostazioni.soglia_arancio) || 0.25;
  const oggi = giornoRoma(ora);
  const sem = (p: Pratica) => semaforo(p.created_at, p.sla_scadenza, ora, soglia);
  const ordinate = [...data.aperte].sort((a, b) => PESO[sem(a)] - PESO[sem(b)] || (a.priorita === 'urgente' ? -1 : 0) - (b.priorita === 'urgente' ? -1 : 0) || (a.sla_scadenza ?? '9').localeCompare(b.sla_scadenza ?? '9'));
  const scadute = ordinate.filter(p => sem(p) === 'rosso');
  const inScadenza = ordinate.filter(p => sem(p) !== 'rosso' && p.sla_scadenza && giornoRoma(p.sla_scadenza) === oggi);
  const daFare = ordinate.filter(p => sem(p) !== 'nessuno').slice(0, 8);
  const richiami = daRichiamare(data.tr);
  const senzaEmail = data.tr.filter(t => senzaRiepilogo(t) && !richiami.includes(t));

  async function avanzaUno(p: Pratica) {
    const st = prossimoStadio(fl(p.tipo), p);
    if (!st) return;
    if (!avanzaDiretto(st)) { setAvanza({ p }); return; }
    try { await rpc('centralino_avanza', { p_id: p.id, p_stadio: st.key, p_dati: {}, p_testo: null }); toast(`${p.numero}: ${st.nome}`); reload(); }
    catch (e) { toast(testoErrore(e)); }
  }
  async function info(canale: string) {
    try { await rpc('centralino_chiamata_info', { p_canale: canale, p_nota: null }); toast('+1 contatto informativo'); reload(); } catch (e) { toast(testoErrore(e)); }
  }
  async function richiamato(t: Trasferimento) { if (await segnaRichiamato(t)) reload(); }
  const flK = fl(tipoK);
  const colonne = flK ? flK.stadi.slice(0, -1) : [];
  const perTipo = (t: string) => data.aperte.filter(p => p.tipo === t).length;
  function suDrop(e: DragEvent, s: Stadio) {
    e.preventDefault();
    const p = data!.aperte.find(x => x.id === trascina); setTrascina(null);
    if (!p || p.stato_corrente === s.key) return;
    if (indiceStadio(flK, s.key) !== indiceStadio(flK, p.stato_corrente) + 1) { toast(`Un passo alla volta: il prossimo è «${prossimoStadio(flK, p)?.nome ?? ''}».`); return; }
    avanzaUno(p);
  }
  const R = data.reg;

  return (
    <div className="ct-home">
      {data.cop && data.cop.assenti.length > 0 && <Banner s="warn">Oggi {data.cop.assenti.join(', ')} è assente: centralino coperto da {data.cop.sostituto}.</Banner>}
      <div className="ct-hero">
        <div><h1>Buongiorno</h1><p className="sub ct-script-h">«{SCRIPT_TELEFONO}»</p></div>
        {ctx.scrive && <div className="row-flex">
          <button className="btn-ghost" onClick={() => setTrasf(true)}><Ic n="telefono" size={17} /> Chiamata per un responsabile</button>
          <button className="btn ct-btn-xl" onClick={ctx.nuovo}><Ic n="piu" size={20} /> Nuovo contatto <kbd>N</kbd></button>
        </div>}
      </div>

      <section className="ct-registro" aria-label="Il mio registro di oggi">
        <div className="ct-reg-h"><b>Il mio registro di oggi</b><span className="sub">si compila da solo dalle pratiche</span></div>
        <div className="ct-reg-n">
          {[['Telefonate', R.telefonate], ['WhatsApp', R.whatsapp], ['Email', R.email], ['Offerte da tablet', R.offerte_tablet], ['Offerte da WA', R.offerte_whatsapp], ['Offerte da cliente', R.offerte_cliente], ['Aggiorn. anagrafica', R.aggiornamenti_anagrafica], ['Chiuse oggi', R.chiuse]].map(([l, n]) => (
            <div key={l as string}><span className="num">{n}</span><span className="lbl">{l}</span></div>))}
        </div>
        {ctx.scrive && <div className="ct-reg-q"><span className="sub">Solo informazioni, senza pratica:</span>
          <button className="btn-ghost btn-sm" onClick={() => info('telefono')}>+1 chiamata informativa</button>
          <button className="btn-ghost btn-sm" onClick={() => info('whatsapp')}>+1 WhatsApp</button>
          <button className="btn-ghost btn-sm" onClick={() => info('email')}>+1 email</button>
          <span className="sub">({R.chiamate_info} oggi)</span></div>}
      </section>

      <div className="ct-colonne">
        <section className="ct-blocco ct-adesso">
          <h2>Da fare adesso <span className="ct-n">{daFare.length}</span></h2>
          {daFare.length ? daFare.map(p => <CardPratica key={p.id} p={p} f={fl(p.tipo)} ora={ora} base={ctx.base} soglia={soglia} onAvanza={ctx.scrive ? x => avanzaUno(x) : undefined} />)
            : <Vuoto>Tutto in ordine. Nessuna scadenza aperta.</Vuoto>}
        </section>
        <div>
          <section className="ct-blocco">
            <h2>Scadute <span className={`ct-n ${scadute.length ? 'ko' : ''}`}>{scadute.length}</span></h2>
            {scadute.length ? scadute.map(p => <CardPratica key={p.id} p={p} f={fl(p.tipo)} ora={ora} base={ctx.base} soglia={soglia} />) : <Vuoto>Nessuna pratica scaduta.</Vuoto>}
          </section>
          <section className="ct-blocco">
            <h2>In scadenza oggi <span className="ct-n">{inScadenza.length}</span></h2>
            {inScadenza.length ? inScadenza.map(p => <CardPratica key={p.id} p={p} f={fl(p.tipo)} ora={ora} base={ctx.base} soglia={soglia} />) : <Vuoto>Niente in scadenza oggi.</Vuoto>}
          </section>
          {richiami.length > 0 && <section className="ct-blocco">
            <h2>Da richiamare <span className="ct-n ko">{richiami.length}</span></h2>
            {richiami.map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} onRichiamato={ctx.scrive ? richiamato : undefined} onRiepilogo={ctx.scrive ? setRiep : undefined} />)}
          </section>}
          {senzaEmail.length > 0 && <section className="ct-blocco">
            <h2>Email di riepilogo da inviare <span className="ct-n ko">{senzaEmail.length}</span></h2>
            {senzaEmail.map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} onRiepilogo={ctx.scrive ? setRiep : undefined} />)}
          </section>}
        </div>
      </div>

      <section className="ct-blocco">
        <h2>Aperte per tipo</h2>
        <div className="ct-tabs" role="tablist">
          {config.flussi.filter(f => f.attivo).map(f => (
            <button key={f.tipo} role="tab" aria-selected={tipoK === f.tipo} className={tipoK === f.tipo ? 'on' : ''} onClick={() => setTipoK(f.tipo)}>
              <Ic n={f.icona} size={16} />{NOME_TIPO[f.tipo] ?? f.nome}<span className="ct-n">{perTipo(f.tipo)}</span></button>))}
        </div>
        <div className="ct-kanban" style={{ gridTemplateColumns: `repeat(${Math.max(1, colonne.length)}, minmax(220px, 1fr))` }}>
          {colonne.map(s => {
            const l = data.aperte.filter(p => p.tipo === tipoK && p.stato_corrente === s.key).sort((a, b) => PESO[sem(a)] - PESO[sem(b)]);
            return (
              <div key={s.key} className={`ct-col ${trascina ? 'drop' : ''}`} onDragOver={e => ctx.scrive && e.preventDefault()} onDrop={e => suDrop(e, s)}>
                <div className="ct-col-h"><b>{s.nome}</b><span className="ct-n">{l.length}</span></div>
                {l.map(p => (
                  <div key={p.id} draggable={ctx.scrive} onDragStart={() => setTrascina(p.id)} onDragEnd={() => setTrascina(null)}>
                    <CardPratica p={p} f={flK} ora={ora} base={ctx.base} soglia={soglia} onAvanza={ctx.scrive ? x => avanzaUno(x) : undefined} />
                  </div>))}
              </div>);
          })}
        </div>
        {ctx.scrive && <p className="hint">Trascina una scheda nella colonna successiva o usa «Prossimo»: un passo alla volta, con i dati che ogni passo richiede.</p>}
      </section>

      <section className="ct-blocco ct-altro">
        <h2>Altre attività</h2>
        <div className="row-flex">
          <Link to="/formazione" className="btn-ghost btn-sm">Attestati di formazione (D.M. 01.09.2021 · D.Lgs. 81/2008)</Link>
          <span className="sub">Anagrafica clienti/impianti: «Modifica / anagrafica». Trasferte e abbigliamento: «Nuovo contatto» › canale Collega.</span>
        </div>
      </section>

      <section className="ct-blocco">
        <h2>Chiuse oggi <span className="ct-n">{data.chiuse.length}</span></h2>
        <div className="ct-griglia-card">{data.chiuse.length ? data.chiuse.map(p => <CardPratica key={p.id} p={p} f={fl(p.tipo)} ora={ora} base={ctx.base} />) : <Vuoto>Nessuna pratica chiusa oggi.</Vuoto>}</div>
      </section>

      {avanza && fl(avanza.p.tipo) && <Avanza p={avanza.p} f={fl(avanza.p.tipo)!} onClose={() => setAvanza(null)} onFatto={() => { setAvanza(null); reload(); }} onEmail={t => nav(`${ctx.base}/pratica/${avanza.p.id}${t ? `?email=${t}` : '?email=1'}`)} />}
      {riep && <ModaleEmail trasf={riep} onClose={() => { setRiep(null); reload(); }} onFatto={() => { setRiep(null); reload(); }} />}
      {trasf && <ModaleTrasferimento onClose={() => setTrasf(false)} onFatto={() => { setTrasf(false); reload(); }} />}
    </div>
  );
}
