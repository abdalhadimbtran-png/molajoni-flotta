import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { fmtData, oggiISO } from '../lib/format';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';
import { ModuloRegistra } from './ModaleRegistra';
import { STATO_CORSO, apriAttestato, statoDi, type Corso, type CorsoFatto, type DipBase, type StatoCorso } from './comune';

const CAT: Record<string, string> = { TEC: 'Tecnico', UFFICIO: 'Ufficio', MAGAZZINO: 'Magazzino', ALTRO: 'Altro' };
const PillC = ({ s }: { s: StatoCorso }) => <Pill s={STATO_CORSO[s][0]}>{STATO_CORSO[s][1]}</Pill>;

/** Per dipendente+corso: ultima registrazione (attuale) e storico. */
function riassunto(d: DipBase, corsi: Corso[], fatti: CorsoFatto[], oggi: string) {
  const miei = fatti.filter(f => f.dipendente_id === d.id)
    .sort((a, b) => b.data_conseguimento.localeCompare(a.data_conseguimento) || b.id - a.id);
  const righe: { corso: Corso; attuale: CorsoFatto | null; storico: CorsoFatto[]; stato: StatoCorso }[] = [];
  for (const c of corsi) {
    const l = miei.filter(f => f.corso_id === c.id);
    const obbl = d.categoria === 'TEC' && c.attivo && c.obbligatorio_per_tec;
    if (!l.length && !obbl) continue;
    righe.push({ corso: c, attuale: l[0] ?? null, storico: l.slice(1), stato: l[0] ? statoDi(l[0].data_scadenza, oggi) : 'mancante' });
  }
  return righe;
}

export default function Dipendenti() {
  const [qs, setQs] = useSearchParams();
  const [soloTec, setSoloTec] = useState(true);
  const [cerca, setCerca] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    const [d, c, f] = await Promise.all([
      supabase.from('dipendenti').select('id,codice,nome,cognome,categoria,reparto,attivo').eq('attivo', true).order('cognome').order('nome'),
      supabase.from('corsi').select('*').order('ordine').order('nome'),
      supabase.from('corsi_dipendente').select('*'),
    ]);
    const e = d.error || c.error || f.error; if (e) throw e;
    return { dip: (d.data ?? []) as DipBase[], corsi: (c.data ?? []) as Corso[], fatti: (f.data ?? []) as CorsoFatto[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const oggi = oggiISO();
  const apertoId = Number(qs.get('d')) || null;
  const aperto = data.dip.find(x => x.id === apertoId) ?? null;
  const lista = data.dip.filter(x => (!soloTec || x.categoria === 'TEC') && (!cerca || `${x.nome} ${x.cognome} ${x.codice}`.toLowerCase().includes(cerca.toLowerCase())));
  return (
    <>
      <div className="page-hero"><div><h1>Dipendenti</h1><p className="sub">Tocca un nome per vedere i suoi corsi, registrarne uno nuovo o rinnovarlo.</p></div></div>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <div className="seg-mini row-flex">
          <button className={soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(true)}>Solo tecnici</button>
          <button className={!soloTec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSoloTec(false)}>Tutti</button>
        </div>
        <input type="search" placeholder="Cerca nome o codice" value={cerca} onChange={e => setCerca(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Dipendente</th><th>Categoria</th><th>Corsi</th></tr></thead>
        <tbody>{lista.map(d => {
          const r = riassunto(d, data.corsi, data.fatti, oggi);
          const n = (s: StatoCorso) => r.filter(x => x.stato === s).length;
          return (
            <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setQs({ d: String(d.id) })}>
              <td><b>{d.cognome} {d.nome}</b><div className="sub">{d.codice}</div></td>
              <td>{d.reparto || CAT[d.categoria] || d.categoria}</td>
              <td><div className="row-flex">
                {r.length === 0 && <span className="sub">Nessun corso</span>}
                {(['valido', 'in_scadenza', 'scaduto', 'mancante'] as StatoCorso[]).map(s => n(s) > 0 && <Pill key={s} s={STATO_CORSO[s][0]}>{n(s)} {STATO_CORSO[s][1].toLowerCase()}</Pill>)}
              </div></td>
            </tr>);
        })}</tbody>
      </table></div>
      {aperto && <SchedaDipendente d={aperto} corsi={data.corsi} fatti={data.fatti} corsoIniziale={Number(qs.get('c')) || undefined}
        onClose={() => setQs({})} onCambiato={reload} />}
    </>
  );
}

function SchedaDipendente({ d, corsi, fatti, corsoIniziale, onClose, onCambiato }:
  { d: DipBase; corsi: Corso[]; fatti: CorsoFatto[]; corsoIniziale?: number; onClose: () => void; onCambiato: () => void }) {
  const [aggiungi, setAggiungi] = useState<number | 'nuovo' | null>(corsoIniziale ?? null);
  const [storico, setStorico] = useState<number | null>(null);
  const [correggi, setCorreggi] = useState<CorsoFatto | null>(null);
  const righe = riassunto(d, corsi, fatti, oggiISO());
  const apri = (p: string) => apriAttestato(p).catch(e => toast(e.message));
  if (aggiungi != null) return (
    <Modal titolo={`${typeof aggiungi === 'number' ? 'Rinnova / registra' : 'Aggiungi corso'} · ${d.cognome} ${d.nome}`} onClose={() => setAggiungi(null)}>
      <ModuloRegistra corsi={corsi} dipendenti={[d.id]} corsoIniziale={typeof aggiungi === 'number' ? aggiungi : undefined}
        onFatto={() => { setAggiungi(null); onCambiato(); }} onAnnulla={() => setAggiungi(null)} />
    </Modal>
  );
  if (correggi) return <ModaleCorreggi f={correggi} onClose={() => setCorreggi(null)} onSalvato={() => { setCorreggi(null); onCambiato(); }} />;
  return (
    <Modal titolo={`${d.cognome} ${d.nome}`} onClose={onClose}>
      <div className="form">
        <button className="btn" style={{ fontSize: 17 }} onClick={() => setAggiungi('nuovo')}>+ Aggiungi corso</button>
        {righe.length === 0 && <p className="sub">Nessun corso registrato.</p>}
        {righe.map(r => (
          <section key={r.corso.id} className="tec-card" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <b>{r.corso.nome}</b><PillC s={r.stato} />
            </div>
            {r.attuale ? (
              <p className="sub" style={{ margin: '6px 0' }}>
                Fatto il {fmtData(r.attuale.data_conseguimento)} · {r.attuale.data_scadenza ? `scade il ${fmtData(r.attuale.data_scadenza)}` : 'non scade'}
                {r.attuale.ente && ` · ${r.attuale.ente}`}{r.attuale.ore != null && ` · ${r.attuale.ore} h`}
              </p>) : <p className="sub" style={{ margin: '6px 0' }}>Obbligatorio per i tecnici: non ancora fatto.</p>}
            <div className="row-flex">
              <button className="btn btn-sm" onClick={() => setAggiungi(r.corso.id)}>{r.attuale ? 'Rinnova' : 'Registra'}</button>
              {r.attuale?.attestato_path && <button className="btn-ghost btn-sm" onClick={() => apri(r.attuale!.attestato_path!)}>Vedi attestato</button>}
              {r.attuale && <button className="btn-ghost btn-sm" onClick={() => setCorreggi(r.attuale)}>Correggi</button>}
              {r.storico.length > 0 && <button className="btn-ghost btn-sm" onClick={() => setStorico(storico === r.corso.id ? null : r.corso.id)}>Storico ({r.storico.length})</button>}
            </div>
            {storico === r.corso.id && (
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
                {r.storico.map(h => <li key={h.id} className="sub">{fmtData(h.data_conseguimento)} → {h.data_scadenza ? fmtData(h.data_scadenza) : 'nessuna scadenza'}{h.ente && ` · ${h.ente}`}
                  {h.attestato_path && <> · <button className="btn-ghost btn-sm" onClick={() => apri(h.attestato_path!)}>attestato</button></>}</li>)}
              </ul>)}
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Correzione di un errore di battitura sulla registrazione (il rinnovo invece crea una nuova riga). */
function ModaleCorreggi({ f, onClose, onSalvato }: { f: CorsoFatto; onClose: () => void; onSalvato: () => void }) {
  const [v, setV] = useState({ data: f.data_conseguimento, scad: f.data_scadenza ?? '', ente: f.ente ?? '', ore: f.ore == null ? '' : String(f.ore), note: f.note ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [conferma, setConferma] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (v.scad && v.scad < v.data) return setErr('La scadenza non può essere prima della data del corso.');
    const { error } = await supabase.from('corsi_dipendente').update({ data_conseguimento: v.data, data_scadenza: v.scad || null, ente: v.ente || null,
      ore: v.ore ? Number(v.ore.replace(',', '.')) : null, note: v.note || null }).eq('id', f.id);
    if (error) return setErr(testoErrore(error));
    toast('Correzione salvata'); onSalvato();
  }
  async function elimina() {
    const { error } = await supabase.from('corsi_dipendente').delete().eq('id', f.id);
    if (error) return setErr(testoErrore(error));
    toast('Registrazione eliminata'); onSalvato();
  }
  return (
    <Modal titolo="Correggi registrazione" onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="hint">Usa «Correggi» solo per un errore. Per un corso rifatto usa «Rinnova»: così resta lo storico.</p>
        <div className="field"><label htmlFor="k-d">Data del corso</label><input id="k-d" type="date" value={v.data} max={oggiISO()} onChange={e => setV({ ...v, data: e.target.value })} /></div>
        <div className="field"><label htmlFor="k-s">Scadenza (vuota = non scade)</label><input id="k-s" type="date" value={v.scad} onChange={e => setV({ ...v, scad: e.target.value })} /></div>
        <div className="field"><label htmlFor="k-e">Ente / docente</label><input id="k-e" value={v.ente} onChange={e => setV({ ...v, ente: e.target.value })} /></div>
        <div className="field"><label htmlFor="k-o">Ore</label><input id="k-o" inputMode="decimal" value={v.ore} onChange={e => setV({ ...v, ore: e.target.value })} /></div>
        <div className="field"><label htmlFor="k-n">Note</label><input id="k-n" value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button>
          {!conferma ? <button type="button" className="btn-ghost" onClick={() => setConferma(true)}>Elimina (registrata per errore)</button>
            : <button type="button" className="btn" onClick={elimina}>Sì, elimina</button>}</div>
      </form>
    </Modal>
  );
}
