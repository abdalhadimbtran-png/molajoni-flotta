import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Banner, Errore, toast, useLoad } from '../ui';
import { NOME_TIPO, REGOLA_SQUILLI, SCRIPT_TELEFONO, prossimoStadio, senzaRiepilogo, type Pratica, type Trasferimento } from '../lib/centralino/tipi';
import { giornoRoma, semaforo } from '../lib/centralino/sla';
import { praticheAperte, useAdesso, useAggiornamento, useConfig } from './comune';
import { CardPratica, Ic, Vuoto, nomeStadio } from './componenti';
import Avanza, { avanzaDiretto } from './Avanza';
import { RigaTrasf, daRichiamare, segnaRichiamato, trasferimenti } from './Trasferimento';
import EmailTrasferimento from './EmailTrasferimento';
import { bip, suonoAttivo, useCtx } from './ShellCentralino';
import { datiPeriodo } from './Direzione';
import { Cifra, Tessera } from './Tessera';
import { Scheletro } from './Scheletro';

const PESO: Record<string, number> = { rosso: 0, arancio: 1, verde: 2, nessuno: 3 };
const ETICHETTA_EV: Record<string, string> = { creata: 'ha aperto', stato: 'è passata a', email_inviata: 'email', chiamata: 'chiamata', nota: 'nota', assegnata: 'assegnata', appuntamento: 'appuntamento', allegato: 'allegato', sla_scaduto: 'SLA scaduto', chiusa: 'chiusa', modifica: 'dati modificati' };

/** «Oggi»: la plancia di Jennifer. Coda «Adesso» per urgenza, contatori del giorno, richiami dovuti, email da inviare, movimenti. */
export default function Home() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso();
  const { config } = useConfig();
  const { data, errore, reload } = useLoad(async () => {
    const g = giornoRoma(new Date());
    const [aperte, oggiD, cop, tr] = await Promise.all([
      praticheAperte(), datiPeriodo(g, g),
      rpc<{ assenti: string[]; sostituto: string }>('centralino_copertura', {}).catch(() => null), trasferimenti(new Date(Date.now() - 30 * 864e5).toISOString()),
    ]);
    return { aperte, oggiD, cop, tr, g };
  }, [ctx.versione]);
  const ricarica = useCallback(() => { reload(); }, [reload]);
  useAggiornamento(ricarica);
  const [avanza, setAvanza] = useState<Pratica | null>(null);
  const [riep, setRiep] = useState<Trasferimento | null>(null);
  const [filtro, setFiltro] = useState<'tutte' | 'rosse' | 'oggi'>('tutte');
  const rosse = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const adesso = new Date();
    const ora_rosse = new Set(data.aperte.filter(p => p.sla_scadenza && new Date(p.sla_scadenza) < adesso).map(p => p.id));
    if (rosse.current) for (const id of ora_rosse) if (!rosse.current.has(id)) {
      const p = data.aperte.find(x => x.id === id)!; toast(`In ritardo: ${p.cliente_nome} (${p.numero})`); if (suonoAttivo()) bip();
    }
    rosse.current = ora_rosse;
  }, [data, ora]);
  const coda = useMemo(() => {
    if (!data || !config) return [];
    const soglia = Number(config.impostazioni.soglia_arancio) || 0.25;
    const s = (p: Pratica) => semaforo(p.created_at, p.sla_scadenza, ora, soglia);
    return [...data.aperte].sort((a, b) => PESO[s(a)] - PESO[s(b)] || (a.priorita === 'urgente' ? -1 : 0) - (b.priorita === 'urgente' ? -1 : 0) || (a.sla_scadenza ?? '9').localeCompare(b.sla_scadenza ?? '9'))
      .filter(p => filtro === 'tutte' || (filtro === 'rosse' ? s(p) === 'rosso' : p.sla_scadenza && giornoRoma(p.sla_scadenza) === data.g));
  }, [data, config, ora, filtro]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Scheletro tessere={8} righe={10} />;
  const fl = (t: string) => config.flussi.find(f => f.tipo === t);
  const richiami = daRichiamare(data.tr);
  const senzaEmail = data.tr.filter(t => senzaRiepilogo(t) && !richiami.includes(t));
  const feed = [...data.oggiD.eventi].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);

  async function avanzaUno(p: Pratica) {
    const st = prossimoStadio(fl(p.tipo), p);
    if (!st) return;
    if (!avanzaDiretto(st)) { setAvanza(p); return; }
    try { await rpc('centralino_avanza', { p_id: p.id, p_stadio: st.key, p_dati: {}, p_testo: null }); toast(`${p.numero}: ${st.nome}`); reload(); }
    catch (e) { toast(testoErrore(e)); }
  }
  async function info(canale: string) {
    try { await rpc('centralino_chiamata_info', { p_canale: canale, p_nota: null }); toast('+1 contatto informativo'); reload(); } catch (e) { toast(testoErrore(e)); }
  }
  async function richiamato(t: Trasferimento) { if (await segnaRichiamato(t)) reload(); }

  return (
    <div className="ct-cockpit">
      {data.cop && data.cop.assenti.length > 0 && <Banner s="warn">Oggi {data.cop.assenti.join(', ')} è assente: centralino coperto da {data.cop.sostituto}.</Banner>}
      <header className="ct-hero2">
        <div>
          <p className="ct-ora">{ora.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · {ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
          <h1>Oggi</h1>
          <p className="ct-script-h">{REGOLA_SQUILLI} «{SCRIPT_TELEFONO}»</p>
        </div>
        {ctx.scrive && <div className="ct-hero2-a">
          <button className="btn ct-btn-xl" onClick={() => ctx.nuovo()}><Ic n="piu" size={20} /> Nuovo contatto <kbd>N</kbd></button>
          <div className="ct-info-rapide"><span className="sub">Solo informazione:</span>
            <button className="btn-ghost btn-sm" onClick={() => info('telefono')}>+1 telefonata</button>
            <button className="btn-ghost btn-sm" onClick={() => info('whatsapp')}>+1 WhatsApp</button>
            <button className="btn-ghost btn-sm" onClick={() => info('email')}>+1 email</button>
            <span className="ct-info-n">oggi <Cifra id="reg_info" d={data.oggiD} da={data.g} a={data.g} /></span></div>
        </div>}
      </header>

      <section className="ct-contatori" aria-label="Il mio registro di oggi">
        {['reg_telefonate', 'reg_whatsapp', 'reg_email', 'reg_tablet', 'reg_wa_offerte', 'reg_cliente', 'reg_anagrafica', 'trasferite', 'reg_chiuse'].map(id => <Tessera key={id} id={id} d={data.oggiD} da={data.g} a={data.g} />)}
      </section>

      <div className="ct-plancia">
        <section className="ct-blocco ct-coda" aria-label="Adesso">
          <div className="ct-blocco-h"><h2>Adesso <span className="ct-n">{coda.length}</span></h2>
            <div className="segmented" role="group" aria-label="Filtro">
              {([['tutte', 'Tutte'], ['rosse', 'In ritardo'], ['oggi', 'Scadono oggi']] as const).map(([v, l]) => <button key={v} className={filtro === v ? 'on' : ''} onClick={() => setFiltro(v)}>{l}</button>)}
            </div></div>
          {coda.length ? coda.slice(0, 40).map(p => <CardPratica key={p.id} p={p} f={fl(p.tipo)} ora={ora} base={ctx.base} onAvanza={ctx.scrive ? avanzaUno : undefined} />)
            : <Vuoto>{filtro === 'tutte' ? 'Nessuna pratica aperta. Quando arriva una chiamata premi N.' : 'Niente qui: ottimo.'}</Vuoto>}
          {coda.length > 40 && <Link to="/centralino/pratiche" className="ct-link">Tutte le {coda.length} pratiche →</Link>}
        </section>

        <aside className="ct-lato">
          <section className="ct-blocco">
            <div className="ct-blocco-h"><h2>Richiami dovuti <span className={`ct-n ${richiami.length ? 'ko' : ''}`}>{richiami.length}</span></h2><Link to="/centralino/trasferimenti" className="ct-link">tutti</Link></div>
            {richiami.length ? richiami.slice(0, 6).map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} onRichiamato={ctx.scrive ? richiamato : undefined} onRiepilogo={ctx.scrive ? setRiep : undefined} />)
              : <Vuoto>Nessun cliente da richiamare.</Vuoto>}
          </section>
          {senzaEmail.length > 0 && <section className="ct-blocco">
            <h2>Email da inviare <span className="ct-n ko">{senzaEmail.length}</span></h2>
            {senzaEmail.slice(0, 5).map(t => <RigaTrasf key={t.id} t={t} ora={ora} base={ctx.base} onRiepilogo={ctx.scrive ? setRiep : undefined} />)}
          </section>}
          <section className="ct-blocco">
            <h2>Movimenti di oggi</h2>
            {feed.length ? <ol className="ct-feed2">{feed.map(e => (
              <li key={e.id} onClick={() => nav(`${ctx.base}/pratica/${e.pratica_id}`)} className="ct-clic">
                <span className="ct-feed2-t">{fmtOra(e.at).split(' ').pop()}</span>
                <span><b>{e.pratiche?.cliente_nome ?? ''}</b> · {e.tipo === 'stato' ? `${ETICHETTA_EV.stato} «${nomeStadio(config.flussi.find(f => f.stadi.some(s => s.key === e.a_stato)), e.a_stato)}»` : `${ETICHETTA_EV[e.tipo] ?? e.tipo}${e.testo ? `: ${e.testo}` : ''}`}
                  <span className="sub"> · {e.autore_nome ?? 'Sistema'}</span></span>
              </li>))}</ol> : <Vuoto>Ancora nessun movimento oggi.</Vuoto>}
          </section>
          <section className="ct-blocco ct-altro">
            <h2>Altre attività</h2>
            <div className="ct-link-list">
              <Link to="/formazione">Attestati di formazione</Link>
              <Link to="/centralino/clienti">Anagrafica clienti</Link>
              <Link to="/centralino/monitoraggio">Analisi del centralino</Link>
            </div>
            <p className="sub">Trasferte e abbigliamento: Nuovo contatto › canale Collega. Tipi: {NOME_TIPO.trasferta}, {NOME_TIPO.abbigliamento}.</p>
          </section>
        </aside>
      </div>

      {avanza && fl(avanza.tipo) && <Avanza p={avanza} f={fl(avanza.tipo)!} onClose={() => setAvanza(null)} onFatto={() => { setAvanza(null); reload(); }} onEmail={t => nav(`${ctx.base}/pratica/${avanza.id}${t ? `?email=${t}` : '?email=1'}`)} />}
      {riep && <EmailTrasferimento trasf={riep} onClose={() => { setRiep(null); reload(); }} onFatto={() => { setRiep(null); reload(); }} />}
    </div>
  );
}
