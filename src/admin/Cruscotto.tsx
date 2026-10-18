import { Link } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { CATEGORIE, GRAVITA, STATI_VEICOLO, fmtData, fmtGiorno, fmtKm, fmtOra, giorniA, prossimoLavorativo } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_TECNICI, SEL_VEICOLI, type Piano, type Segnalazione, type Tecnico, type Veicolo } from '../lib/tipi';
import { Caricamento, Errore, Pill, useLoad , Targa } from '../ui';

interface Eccezione { s: 'ko' | 'warn'; t: string; d: string; to: string }

export default function Cruscotto() {
  const { t, tm, locale } = useT();
  const giorno = prossimoLavorativo();
  const { data, errore, reload } = useLoad(async () => {
    const [v, tc, s, p] = await Promise.all([
      supabase.from('v_veicoli').select(SEL_VEICOLI).eq('dismesso', false).order('targa'),
      supabase.from('tecnici').select(SEL_TECNICI).eq('attivo', true),
      supabase.from('segnalazioni').select('*, veicoli(targa), tecnici(nome,cognome)').neq('stato', 'chiusa').order('creato_il', { ascending: false }),
      rpc<Piano>('piano_giorno', { p_data: giorno }),
    ]);
    for (const r of [v, tc, s]) if (r.error) throw r.error;
    const mu = await supabase.from('multe').select('id,scadenza_comunicazione,stato,veicoli(targa)').in('stato', ['da_identificare', 'da_comunicare']);
    return { veicoli: v.data as unknown as Veicolo[], tecnici: tc.data as Tecnico[], segn: s.data as Segnalazione[], piano: p, multe: (mu.data ?? []) as unknown as { id: number; scadenza_comunicazione: string | null; stato: string; veicoli: { targa: string } | null }[] };
  }, [giorno]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const { veicoli, tecnici, segn, piano } = data;

  let scadute = 0, inScad = 0;
  const exc: Eccezione[] = [];
  veicoli.forEach(v => v.controlli.forEach(c => {
    if (c.l === 'ko' || c.l === 'warn') exc.push({ s: c.l, t: `${v.targa} · ${tm(c.m)}`, d: v.marca_modello, to: '/flotta' });
    if (/scadut|superato/.test(c.m)) scadute++; else if (/in scadenza|Tagliando tra/.test(c.m)) inScad++;
  }));
  tecnici.forEach(tc => {
    const n = `${tc.nome} ${tc.cognome}`;
    const g = giorniA(tc.patente_scadenza);
    if (g != null && g < 0) { scadute++; exc.push({ s: 'ko', t: t('{n}: patente scaduta il {d}', { n, d: fmtData(tc.patente_scadenza) }), d: t('Non può guidare'), to: '/tecnici' }); }
    else if (g != null && g <= 30) { inScad++; exc.push({ s: 'warn', t: t('{n}: patente in scadenza il {d}', { n, d: fmtData(tc.patente_scadenza) }), d: t('Richiedere il rinnovo'), to: '/tecnici' }); }
    if (!tc.ha_pin) exc.push({ s: 'warn', t: t('{n}: PIN non impostato', { n }), d: t("Non può usare l'app QR"), to: '/tecnici' });
  });
  let bloccati = 0;
  piano.righe.forEach(r => {
    if (r.livello === 'ko') bloccati++;
    r.messaggi.forEach(m => {
      const daPiano = m.l === 'ko' && (m.m.startsWith('Nessun veicolo') || m.m.startsWith('Veicolo già'));
      const passaggio = m.l === 'warn' && (m.m.startsWith('Ha in carico') || m.m.startsWith('Oggi è in carico'));
      if (daPiano || passaggio) exc.push({ s: m.l as 'ko' | 'warn', t: `${r.nome}: ${tm(m.m)}`, d: t('Piano di {d}', { d: fmtData(giorno) }), to: '/piano' });
    });
  });
  data.multe.forEach(m => {
    const g = giorniA(m.scadenza_comunicazione);
    const s: 'ko' | 'warn' = g != null && g <= 15 ? 'ko' : 'warn';
    exc.push({ s, t: `${m.veicoli?.targa ?? ''} · ${m.stato === 'da_identificare' ? t('Multa: conducente da identificare') : t('Multa: conducente da comunicare')}`,
      d: m.scadenza_comunicazione ? (g! < 0 ? t('Termine scaduto il {d}', { d: fmtData(m.scadenza_comunicazione) }) : t('Entro il {d} ({n} giorni)', { d: fmtData(m.scadenza_comunicazione), n: g! })) : t('Senza decurtazione punti'), to: '/multe' });
  });
  exc.sort((a, b) => (a.s === b.s ? 0 : a.s === 'ko' ? -1 : 1));
  const conta = (s: string) => veicoli.filter(v => v.stato === s).length;

  return (
    <>
      <div className="page-hero">
        <div>
          <h1>{t('Situazione flotta')}</h1>
          <p className="sub data-oggi">{fmtGiorno(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }), locale)}, {t('{v} veicoli attivi e {n} tecnici', { v: veicoli.length, n: tecnici.length })}</p>
        </div>
        <Link to="/piano" className={`piano-chip ${piano.confermato_il ? 'ok' : bloccati ? 'ko' : 'warn'}`}>
          <span className="dot" />
          <span><b>{t('Piano di {d}', { d: fmtData(giorno) })}</b>
            <span className="sub">{piano.confermato_il ? t('Confermato e inviato') : bloccati ? t('{n} tecnici bloccati: da sistemare', { n: bloccati }) : t('Da confermare')}</span></span>
        </Link>
      </div>
      <div className="kpis">
        <Link to="/flotta" className="kpi ok"><div className="lbl">{t('Veicoli disponibili')}</div><div className="num">{conta('disponibile')}</div></Link>
        <Link to="/flotta" className="kpi info"><div className="lbl">{t('In uso ai tecnici')}</div><div className="num">{conta('in_uso')}</div></Link>
        <Link to="/segnalazioni" className="kpi ko"><div className="lbl">{t('Fermi o non utilizzabili')}</div><div className="num">{conta('fermo') + conta('non_utilizzabile')}</div></Link>
        <Link to="/flotta" className="kpi ko"><div className="lbl">{t('Scadenze superate')}</div><div className="num">{scadute}</div></Link>
        <Link to="/flotta" className="kpi warn"><div className="lbl">{t('Scadenze entro 30 gg / 1.500 km')}</div><div className="num">{inScad}</div></Link>
        <Link to="/piano" className={`kpi ${bloccati ? 'ko' : 'ok'}`}><div className="lbl">{t('Tecnici bloccati nel piano di {d}', { d: fmtData(giorno) })}</div><div className="num">{bloccati}</div></Link>
      </div>

      <div className="two-col">
        <div>
          <div className="section-title">{t('Da gestire')} <span className="meta">{t('{n} voci, prima le bloccanti', { n: exc.length })}</span></div>
          {exc.length ? (
            <div className="exc-list">{exc.map((e, i) => (
              <div key={i} className={`exc ${e.s}`}><div className="stripe" /><div className="t">{e.t}<div className="d">{e.d}</div></div><Link className="btn-ghost btn-sm" to={e.to}>{t('Apri')}</Link></div>
            ))}</div>
          ) : <div className="banner ok">{t('Nessuna eccezione aperta.')}</div>}
        </div>
        <div>
          <div className="section-title">{t('Dove sono i veicoli adesso')}</div>
          <div className="table-wrap"><table>
            <thead><tr><th>{t('Veicolo')}</th><th>{t('Dove / con chi')}</th><th>{t('Km')}</th></tr></thead>
            <tbody>{veicoli.length ? veicoli.map(v => {
              const [s, l] = STATI_VEICOLO[v.stato] ?? ['na', v.stato];
              return <tr key={v.id}><td><Targa t={v.targa} /><div className="sub">{v.marca_modello}</div></td>
                <td>{v.in_carico_nome ?? t('In sede')}<div style={{ marginTop: 3 }}><Pill s={s}>{t(l)}</Pill></div></td><td className="mono">{fmtKm(v.km_attuali)}</td></tr>;
            }) : <tr><td colSpan={3} className="sub">{t('Nessun veicolo registrato.')} <Link to="/flotta">{t('Aggiungi il primo')}</Link></td></tr>}</tbody>
          </table></div>
          <div className="section-title">{t('Segnalazioni aperte')}</div>
          <div className="table-wrap"><table>
            <thead><tr><th>{t('Veicolo')}</th><th>{t('Problema')}</th><th>{t('Gravità')}</th></tr></thead>
            <tbody>{segn.length ? segn.map(s => {
              const [g, gl] = GRAVITA[s.gravita];
              return <tr key={s.id}><td><Targa t={s.veicoli?.targa} /></td>
                <td>{t(CATEGORIE[s.categoria])}<div className="sub">{s.tecnici ? `${s.tecnici.nome} ${s.tecnici.cognome}` : t('Responsabile')} · {fmtOra(s.creato_il, locale)}</div></td><td><Pill s={g}>{t(gl)}</Pill></td></tr>;
            }) : <tr><td colSpan={3} className="sub">{t('Nessuna segnalazione aperta')}</td></tr>}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
