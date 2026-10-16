import { Link } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { CATEGORIE, GRAVITA, STATI_VEICOLO, fmtData, fmtKm, fmtOra, giorniA, prossimoLavorativo } from '../lib/format';
import { SEL_TECNICI, SEL_VEICOLI, type Piano, type Segnalazione, type Tecnico, type Veicolo } from '../lib/tipi';
import { Caricamento, Errore, Pill, useLoad } from '../ui';

interface Eccezione { s: 'ko' | 'warn'; t: string; d: string; to: string }

export default function Cruscotto() {
  const giorno = prossimoLavorativo();
  const { data, errore, reload } = useLoad(async () => {
    const [v, t, s, p] = await Promise.all([
      supabase.from('v_veicoli').select(SEL_VEICOLI).eq('dismesso', false).order('targa'),
      supabase.from('tecnici').select(SEL_TECNICI).eq('attivo', true),
      supabase.from('segnalazioni').select('*, veicoli(targa), tecnici(nome,cognome)').neq('stato', 'chiusa').order('creato_il', { ascending: false }),
      rpc<Piano>('piano_giorno', { p_data: giorno }),
    ]);
    for (const r of [v, t, s]) if (r.error) throw r.error;
    return { veicoli: v.data as unknown as Veicolo[], tecnici: t.data as Tecnico[], segn: s.data as Segnalazione[], piano: p };
  }, [giorno]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const { veicoli, tecnici, segn, piano } = data;

  let scadute = 0, inScad = 0;
  const exc: Eccezione[] = [];
  veicoli.forEach(v => v.controlli.forEach(c => {
    if (c.l === 'ko') exc.push({ s: 'ko', t: `${v.targa} · ${c.m}`, d: v.marca_modello, to: '/flotta' });
    if (c.l === 'warn') exc.push({ s: 'warn', t: `${v.targa} · ${c.m}`, d: v.marca_modello, to: '/flotta' });
    if (/scadut|superato/.test(c.m)) scadute++; else if (/in scadenza|Tagliando tra/.test(c.m)) inScad++;
  }));
  tecnici.forEach(t => {
    const g = giorniA(t.patente_scadenza);
    if (g != null && g < 0) { scadute++; exc.push({ s: 'ko', t: `${t.nome} ${t.cognome}: patente scaduta il ${fmtData(t.patente_scadenza)}`, d: 'Non può guidare', to: '/tecnici' }); }
    else if (g != null && g <= 30) { inScad++; exc.push({ s: 'warn', t: `${t.nome} ${t.cognome}: patente in scadenza il ${fmtData(t.patente_scadenza)}`, d: 'Richiedere il rinnovo', to: '/tecnici' }); }
    if (!t.ha_pin) exc.push({ s: 'warn', t: `${t.nome} ${t.cognome}: PIN non impostato`, d: 'Non può usare l\'app QR', to: '/tecnici' });
  });
  let bloccati = 0;
  piano.righe.forEach(r => {
    if (r.livello === 'ko') bloccati++;
    r.messaggi.forEach(m => {
      const daPiano = m.l === 'ko' && (m.m.startsWith('Nessun veicolo') || m.m.startsWith('Veicolo già'));
      const passaggio = m.l === 'warn' && (m.m.startsWith('Ha in carico') || m.m.startsWith('Oggi è in carico'));
      if (daPiano || passaggio) exc.push({ s: m.l as 'ko' | 'warn', t: `${r.nome}: ${m.m}`, d: `Piano di ${fmtData(giorno)}`, to: '/piano' });
    });
  });
  exc.sort((a, b) => (a.s === b.s ? 0 : a.s === 'ko' ? -1 : 1));

  const conta = (s: string) => veicoli.filter(v => v.stato === s).length;

  return (
    <>
      <div className="stat-strip">
        <div className="stat"><div className="num c-ok">{conta('disponibile')}</div><div className="lbl">Veicoli disponibili</div></div>
        <div className="stat"><div className="num c-info">{conta('in_uso')}</div><div className="lbl">In uso ai tecnici</div></div>
        <div className="stat"><div className="num c-ko">{conta('fermo') + conta('non_utilizzabile')}</div><div className="lbl">Fermi o non utilizzabili</div></div>
        <div className="stat"><div className="num c-ko">{scadute}</div><div className="lbl">Scadenze superate</div></div>
        <div className="stat"><div className="num c-warn">{inScad}</div><div className="lbl">Scadenze entro 30 gg / 1.500 km</div></div>
        <div className="stat"><div className="num">{bloccati}</div><div className="lbl">Tecnici bloccati nel piano di {fmtData(giorno)}</div></div>
      </div>

      <div className="two-col">
        <div>
          <div className="section-title">Da gestire <span className="meta">{exc.length} voci, prima le bloccanti</span></div>
          {exc.length ? (
            <div className="exc-list">{exc.map((e, i) => (
              <div key={i} className={`exc ${e.s}`}><div className="stripe" /><div className="t">{e.t}<div className="d">{e.d}</div></div><Link className="btn-ghost btn-sm" to={e.to}>Apri</Link></div>
            ))}</div>
          ) : <div className="banner ok">Nessuna eccezione aperta.</div>}
        </div>
        <div>
          <div className="section-title">Dove sono i veicoli adesso</div>
          <div className="table-wrap"><table>
            <thead><tr><th>Veicolo</th><th>Dove / con chi</th><th>Km</th></tr></thead>
            <tbody>{veicoli.length ? veicoli.map(v => {
              const [s, l] = STATI_VEICOLO[v.stato] ?? ['na', v.stato];
              return <tr key={v.id}><td><span className="targa">{v.targa}</span><div className="sub">{v.marca_modello}</div></td>
                <td>{v.in_carico_nome ?? 'In sede'}<div style={{ marginTop: 3 }}><Pill s={s}>{l}</Pill></div></td><td className="mono">{fmtKm(v.km_attuali)}</td></tr>;
            }) : <tr><td colSpan={3} className="sub">Nessun veicolo registrato. <Link to="/flotta">Aggiungi il primo</Link>.</td></tr>}</tbody>
          </table></div>
          <div className="section-title">Segnalazioni aperte</div>
          <div className="table-wrap"><table>
            <thead><tr><th>Veicolo</th><th>Problema</th><th>Gravità</th></tr></thead>
            <tbody>{segn.length ? segn.map(s => {
              const [g, gl] = GRAVITA[s.gravita];
              return <tr key={s.id}><td><span className="targa">{s.veicoli?.targa}</span></td>
                <td>{CATEGORIE[s.categoria]}<div className="sub">{s.tecnici ? `${s.tecnici.nome} ${s.tecnici.cognome}` : 'Responsabile'} · {fmtOra(s.creato_il)}</div></td><td><Pill s={g}>{gl}</Pill></td></tr>;
            }) : <tr><td colSpan={3} className="sub">Nessuna segnalazione aperta</td></tr>}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
