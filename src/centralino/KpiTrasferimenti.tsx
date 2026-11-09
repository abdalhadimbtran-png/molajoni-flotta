import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { STATI_CLIENTE, nomeTipoContatto } from '../lib/centralino/tipi';
import { calcolaTrasf } from '../lib/centralino/kpi';
import { linkAnalisi, valuta, kpi, type Dataset } from '../lib/centralino/registro';
import { orologio, giornoRoma } from '../lib/centralino/sla';
import { fmtOra } from '../lib/format';
import { Cifra, Tessera } from './Tessera';
import { useAdesso } from './comune';

/** Blocco «Chiamate trasferite»: oggi (home di Jennifer) o nel periodo (Direzione). Ogni numero apre l'elenco filtrato. */
export default function KpiTrasferimenti({ d, da, a, base, trend }: { d: Dataset; da: string; a: string; base: string; trend?: Dataset['trasf'] }) {
  const ora = useAdesso(30000);
  const k = useMemo(() => calcolaTrasf(d.trasf, ora), [d.trasf, ora]);
  const scadute = valuta(kpi('trasf_scadute')!, d, {}, ora).righe as Dataset['trasf'];
  const giorni = useMemo(() => {
    const l = trend ?? d.trasf; const m = new Map<string, number>();
    for (let i = 29; i >= 0; i--) m.set(giornoRoma(new Date(Date.now() - i * 864e5)), 0);
    for (const t of l) { const g = giornoRoma(t.at); if (m.has(g)) m.set(g, (m.get(g) ?? 0) + 1); }
    return [...m.entries()];
  }, [trend, d.trasf]);
  const max = Math.max(1, ...giorni.map(g => g[1]));
  const riga = (nome: string, f: { dest?: string; arg?: string; stato?: string; chi?: string }, g: { tot: number; minuti: number; fatti: number }) => (
    <tr key={nome}><td>{nome}</td><td><Cifra id="trasferite" d={d} da={da} a={a} f={f} /></td>
      <td><Cifra id="trasf_in_tempo" d={d} da={da} a={a} f={f} pct /></td><td>{g.fatti ? orologio((g.minuti / g.fatti) * 60) : '—'}</td><td><Cifra id="trasf_da_richiamare" d={d} da={da} a={a} f={f} /></td></tr>);
  return (
    <section className="ct-blocco ct-kt">
      <h2>Chiamate trasferite</h2>
      <div className="kpis">
        <Tessera id="trasferite" d={d} da={da} a={a} />
        <Tessera id="trasf_in_tempo" d={d} da={da} a={a} soglia={90} />
        <Tessera id="trasf_da_richiamare" d={d} da={da} a={a} sub={k.tempoMedioRichiamo != null ? `tempo medio di richiamo ${orologio(k.tempoMedioRichiamo * 60)}` : undefined} />
        <Tessera id="trasf_scadute" d={d} da={da} a={a} rossoSe />
        <Tessera id="trasf_email_ref" d={d} da={da} a={a} soglia={100} />
        <Tessera id="trasf_email_cli" d={d} da={da} a={a} soglia={100} />
      </div>
      {scadute.length > 0 && (
        <div className="ct-scadute">
          <b>Scadute non richiamate</b>
          {scadute.map(t => (
            <Link key={t.id} to={t.pratica_id ? `${base}/pratica/${t.pratica_id}` : `${base.replace('/direzione/centralino', '/centralino')}/trasferimenti`} className="ct-scaduta">
              <span><b>{t.destinatario_nome}</b> · {t.cliente_nome ?? t.telefono ?? 'cliente'}</span>
              <span className="sub">scadenza {fmtOra(t.richiamo_scadenza)}</span>
              <span className="ko-t">in ritardo da {orologio((ora.getTime() - new Date(t.richiamo_scadenza!).getTime()) / 1000)}</span>
            </Link>))}
        </div>)}
      <div className="ct-dir-g">
        <div><h3 className="ct-h3">Per destinatario</h3>
          <table className="ct-tab"><thead><tr><th>Destinatario</th><th>Chiamate</th><th>Richiamati in tempo</th><th>Tempo medio richiamo</th><th>Da richiamare</th></tr></thead>
            <tbody>{Object.entries(k.perDestinatario).sort((x, y) => y[1].tot - x[1].tot).map(([n, g]) => riga(n, { dest: n }, g))}</tbody></table>
          {!Object.keys(k.perDestinatario).length && <p className="ct-vuoto">Nessuna chiamata trasferita nel periodo.</p>}</div>
        <div><h3 className="ct-h3">Per argomento</h3>
          <table className="ct-tab"><thead><tr><th>Argomento</th><th>Chiamate</th><th>In tempo</th><th>Medio</th><th>Aperti</th></tr></thead>
            <tbody>{Object.entries(k.perArgomento).sort((x, y) => y[1].tot - x[1].tot).map(([n, g]) => riga(n, { arg: n }, g))}</tbody></table>
          <h3 className="ct-h3">Chi chiama</h3>
          <table className="ct-tab"><tbody>{Object.entries(k.perTipoContatto).map(([n, g]) => riga(nomeTipoContatto(n), { chi: n }, g))}</tbody></table>
          <h3 className="ct-h3">Per stato del cliente <span className="sub">(solo clienti)</span></h3>
          <table className="ct-tab"><tbody>{Object.entries(k.perStatoCliente).map(([n, g]) => riga(STATI_CLIENTE[n as 'nuovo']?.[1] ?? 'Non indicato', { stato: n }, g))}</tbody></table></div>
      </div>
      <h3 className="ct-h3">Ultimi 30 giorni</h3>
      <div className="ct-trend" role="img" aria-label="Chiamate trasferite negli ultimi 30 giorni">
        {giorni.map(([g, n]) => <Link key={g} to={linkAnalisi(base, 'trasferite', g, g)} title={`${g.split('-').reverse().join('/')}: ${n}`} className="ct-trend-b"><i style={{ height: `${(n / max) * 100}%` }} /></Link>)}
      </div>
    </section>
  );
}
