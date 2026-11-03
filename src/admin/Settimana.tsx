import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, Modal, toast, useLoad } from '../ui';
import { CATALOGO, type Riga } from './report/catalogo';

/** Vista settimanale: inserimento rapido degli interventi lun–ven, pensata per chi usa poco il computer. */
interface Int { id: number; data: string; tecnico_id: number; ora: string | null; luogo: string; attivita: string; note: string | null }
interface Tec { id: number; nome: string; cognome: string }
type Bozza = { id?: number; data: string; tecnico_id: number; ora: string; luogo: string; attivita: string; note: string };

const GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
const pd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fd = (d: Date) => d.toISOString().slice(0, 10);
const add = (s: string, n: number) => { const d = pd(s); d.setUTCDate(d.getUTCDate() + n); return fd(d); };
const lunedi = (s: string) => add(s, -((pd(s).getUTCDay() + 6) % 7));
const hhmm = (o: string | null) => (o ? o.slice(0, 5) : '');
const chiave = (x: { data: string; tecnico_id: number; ora: string | null; luogo: string; attivita: string }) =>
  [x.data, x.tecnico_id, hhmm(x.ora), x.luogo.trim().toLowerCase(), x.attivita.trim().toLowerCase()].join('|');

export default function Settimana() {
  const { t, tm, locale } = useT();
  const [lun, setLun] = useState(() => add(lunedi(oggiISO()), 7));
  const giorni = useMemo(() => [0, 1, 2, 3, 4].map(i => add(lun, i)), [lun]);
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [copia, setCopia] = useState<Int | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data, errore, reload } = useLoad(async () => {
    const ven = add(lun, 4);
    const [tc, it, as, st] = await Promise.all([
      supabase.from('tecnici').select('id,nome,cognome').eq('attivo', true).order('cognome'),
      supabase.from('interventi').select('id,data,tecnico_id,ora,luogo,attivita,note').gte('data', lun).lte('data', ven).order('ora', { nullsFirst: false }),
      supabase.from('assenze').select('tecnico_id,dal,al').lte('dal', ven).gte('al', lun),
      supabase.from('interventi').select('luogo,attivita').order('id', { ascending: false }).limit(1500),
    ]);
    if (tc.error) throw tc.error; if (it.error) throw it.error;
    // festività: un giorno feriale non è lavorativo se il server indica un altro «prossimo lavorativo»
    const fest = new Set<string>();
    await Promise.all(giorni.map(async g => { try { if ((await rpc<string>('prossimo_lavorativo', { p_da: add(g, -1) })) !== g) fest.add(g); } catch { /* ignora */ } }));
    const conta = (k: 'luogo' | 'attivita') => { const m = new Map<string, number>(); (st.data ?? []).forEach(r => { const v = (r[k] ?? '').trim(); if (v) m.set(v, (m.get(v) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 300); };
    return { tecnici: tc.data as Tec[], interventi: it.data as Int[], assenze: (as.data ?? []) as { tecnico_id: number; dal: string; al: string }[], fest, luoghi: conta('luogo'), attivita: conta('attivita') };
  }, [lun]);

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const assente = (tec: number, g: string) => !!data?.assenze.some(a => a.tecnico_id === tec && a.dal <= g && a.al >= g);
  const bloccato = (tec: number, g: string) => !!data && (data.fest.has(g) || assente(tec, g));
  const nomeT = (id: number) => { const x = data?.tecnici.find(z => z.id === id); return x ? `${x.nome} ${x.cognome}` : ''; };
  const fmtG = (g: string) => pd(g).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  async function esegui(f: () => Promise<void>) {
    setErr(null);
    try { await f(); await reload(); } catch (e) { setErr(tm(testoErrore(e))); }
  }

  function apriNuovo(tec: number, g: string) {
    if (data?.fest.has(g)) { window.alert(t('{g} è un giorno festivo: non si possono aggiungere interventi.', { g: fmtG(g) })); return; }
    if (assente(tec, g)) { window.alert(t('{n} è assente il {g}: non si possono aggiungere interventi.', { n: nomeT(tec), g: fmtG(g) })); return; }
    setBozza({ data: g, tecnico_id: tec, ora: '', luogo: '', attivita: '', note: '' });
  }

  /** Inserisce copie saltando giorni bloccati e duplicati già presenti. */
  async function inserisciCopie(righe: Omit<Int, 'id'>[]) {
    const esist = new Set((data?.interventi ?? []).map(chiave));
    let saltati = 0;
    const nuove = righe.filter(r => {
      if (bloccato(r.tecnico_id, r.data) || esist.has(chiave(r))) { saltati++; return false; }
      esist.add(chiave(r)); return true;
    });
    if (nuove.length) { const { error } = await supabase.from('interventi').insert(nuove); if (error) throw error; }
    toast(saltati ? t('{n} interventi copiati, {s} saltati (assenza, festivo o già presenti).', { n: nuove.length, s: saltati }) : t('{n} interventi copiati.', { n: nuove.length }));
  }

  const elimina = (i: Int) => {
    if (!window.confirm(t('Eliminare «{l} · {a}»?', { l: i.luogo, a: i.attivita }))) return;
    esegui(async () => { const { error } = await supabase.from('interventi').delete().eq('id', i.id); if (error) throw error; toast(t('Intervento eliminato.')); });
  };

  const ripeti = (i: Int) => esegui(() => inserisciCopie(giorni.filter(g => g !== i.data).map(g => ({ data: g, tecnico_id: i.tecnico_id, ora: i.ora, luogo: i.luogo, attivita: i.attivita, note: i.note }))));

  const copiaPrecedente = (tec: Tec) => {
    if (!window.confirm(t('Copiare gli interventi della settimana precedente di {n} in questa settimana? I giorni di assenza e gli interventi già presenti vengono saltati.', { n: `${tec.nome} ${tec.cognome}` }))) return;
    esegui(async () => {
      const { data: prec, error } = await supabase.from('interventi').select('data,tecnico_id,ora,luogo,attivita,note').eq('tecnico_id', tec.id).gte('data', add(lun, -7)).lte('data', add(lun, -3));
      if (error) throw error;
      if (!prec?.length) { toast(t('La settimana precedente non ha interventi per {n}.', { n: tec.nome })); return; }
      await inserisciCopie(prec.map(p => ({ ...p, data: add(p.data, 7) })));
    });
  };

  const venerdi = add(lun, 4);
  const questa = lunedi(oggiISO());
  return (
    <>
      <div className="wk-head">
        <div className="wk-nav">
          <button className="btn-ghost wk-big" aria-label={t('Settimana precedente')} onClick={() => setLun(add(lun, -7))}>‹</button>
          <div className="wk-titolo">{t('Settimana dal {a} al {b}', { a: fmtG(lun), b: fmtG(venerdi) })}</div>
          <button className="btn-ghost wk-big" aria-label={t('Settimana successiva')} onClick={() => setLun(add(lun, 7))}>›</button>
          {lun !== questa && <button className="btn-ghost" onClick={() => setLun(questa)}>{t('Questa settimana')}</button>}
          {lun !== add(questa, 7) && <button className="btn-ghost" onClick={() => setLun(add(questa, 7))}>{t('Settimana prossima')}</button>}
        </div>
        <div className="row-flex">
          <Stampa lun={lun} tecnici={data?.tecnici ?? []} etichetta={t('Stampa tutti')} />
          <Link className="btn-ghost" to={`/admin/report?report=agenda&da=${lun}&a=${venerdi}`}>{t('Apri nei report')}</Link>
        </div>
      </div>
      <p className="hint">{t('Tocca una casella vuota o il pulsante + per aggiungere un intervento.')}</p>
      {err && <Banner s="ko">{err}</Banner>}
      {!data ? <Caricamento /> : data.tecnici.length === 0 ? <Banner s="warn">{t("Nessun tecnico attivo. I tecnici li inserisce l'ufficio personale.")}</Banner> : (
        <div className="wk-wrap"><table className="wk">
          <thead><tr><th>{t('Tecnico')}</th>{giorni.map((g, i) => <th key={g} className={data.fest.has(g) ? 'wk-off' : ''}>{t(GIORNI[i])}<div className="sub">{fmtG(g)}{data.fest.has(g) ? ` · ${t('Festivo')}` : ''}</div></th>)}</tr></thead>
          <tbody>{data.tecnici.map(tec => (
            <tr key={tec.id}>
              <th className="wk-tec"><div className="wk-nome">{tec.nome} {tec.cognome}<Stampa lun={lun} tecnici={[tec]} singolo /></div>
                <button className="link wk-prec" onClick={() => copiaPrecedente(tec)}>{t('Copia la settimana precedente')}</button></th>
              {giorni.map((g, gi) => {
                const ass = assente(tec.id, g), fes = data.fest.has(g);
                const lista = data.interventi.filter(i => i.tecnico_id === tec.id && i.data === g);
                return (
                  <td key={g} className={`wk-cell${ass || fes ? ' wk-off' : ''}`} data-giorno={t(GIORNI[gi])}
                    onClick={e => { if (e.target === e.currentTarget) apriNuovo(tec.id, g); }}>
                    {(ass || fes) && <div className="wk-stato">{fes ? t('Festivo') : t('Assente')}</div>}
                    {lista.map(i => (
                      <div key={i.id} className="wk-card">
                        <div><b>{hhmm(i.ora) || '—'}</b> · {i.luogo}</div>
                        <div className="sub">{i.attivita}{i.note ? ` — ${i.note}` : ''}</div>
                        <div className="wk-azioni">
                          <button className="btn-ghost btn-sm" onClick={() => setBozza({ id: i.id, data: i.data, tecnico_id: i.tecnico_id, ora: hhmm(i.ora), luogo: i.luogo, attivita: i.attivita, note: i.note ?? '' })}>{t('Modifica')}</button>
                          <button className="btn-ghost btn-sm" onClick={() => setCopia(i)}>{t('Copia su…')}</button>
                          <button className="btn-ghost btn-sm" onClick={() => ripeti(i)}>{t('Ripeti tutta la settimana')}</button>
                          <button className="btn-ghost btn-sm wk-del" onClick={() => elimina(i)}>{t('Elimina')}</button>
                        </div>
                      </div>
                    ))}
                    {!ass && !fes && <button className="wk-add" aria-label={t('Aggiungi intervento')} onClick={() => apriNuovo(tec.id, g)}>+</button>}
                    {lista.length === 0 && !ass && !fes && <div className="wk-vuoto">{t('Nessun intervento')}</div>}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {bozza && data && <ModaleIntervento b={bozza} titolo={`${nomeT(bozza.tecnico_id)} · ${fmtG(bozza.data)}`} luoghi={data.luoghi} attivita={data.attivita}
        onClose={() => setBozza(null)} onSalvato={() => { setBozza(null); reload(); }} />}
      {copia && data && <ModaleCopia i={copia} giorni={giorni} tecnici={data.tecnici} fmtG={fmtG} bloccato={bloccato}
        onClose={() => setCopia(null)} onCopia={dest => { setCopia(null); esegui(() => inserisciCopie(dest.map(d => ({ data: d.g, tecnico_id: d.tec, ora: copia.ora, luogo: copia.luogo, attivita: copia.attivita, note: copia.note })))); }} />}
    </>
  );
}

function ModaleIntervento({ b, titolo, luoghi, attivita, onClose, onSalvato }: { b: Bozza; titolo: string; luoghi: string[]; attivita: string[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState(b);
  const [err, setErr] = useState<string | null>(null);
  const [inv, setInv] = useState(false);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!f.luogo.trim() || !f.attivita.trim()) { setErr(t('Scrivi il luogo e l\'attività.')); return; }
    setInv(true);
    const rec = { data: f.data, tecnico_id: f.tecnico_id, ora: f.ora || null, luogo: f.luogo.trim(), attivita: f.attivita.trim(), note: f.note.trim() || null };
    const { error } = f.id ? await supabase.from('interventi').update(rec).eq('id', f.id) : await supabase.from('interventi').insert(rec);
    setInv(false);
    if (error) { setErr(tm(testoErrore(error))); return; }
    toast(f.id ? t('Intervento modificato.') : t('Intervento aggiunto.'));
    onSalvato();
  }
  return (
    <Modal titolo={titolo} onClose={onClose}>
      <form className="form wk-form" onSubmit={salva}>
        <div className="field"><label htmlFor="wk-l">{t('Luogo')}</label>
          <input id="wk-l" list="wk-luoghi" autoFocus autoComplete="off" value={f.luogo} onChange={e => setF({ ...f, luogo: e.target.value })} placeholder={t('Es. Scuola Verdi, Roma')} />
          <datalist id="wk-luoghi">{luoghi.map(x => <option key={x} value={x} />)}</datalist></div>
        <div className="field"><label htmlFor="wk-a">{t('Attività')}</label>
          <input id="wk-a" list="wk-att" autoComplete="off" value={f.attivita} onChange={e => setF({ ...f, attivita: e.target.value })} placeholder={t('Es. Controllo estintori')} />
          <datalist id="wk-att">{attivita.map(x => <option key={x} value={x} />)}</datalist></div>
        <div className="field"><label htmlFor="wk-o">{t('Ora (facoltativa)')}</label>
          <input id="wk-o" type="time" value={f.ora} onChange={e => setF({ ...f, ora: e.target.value })} /></div>
        <div className="field"><label htmlFor="wk-n">{t('Note (facoltative)')}</label>
          <input id="wk-n" type="text" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        {err && <div className="msg ko">{err}</div>}
        <div className="wk-btns"><button className="btn wk-big" disabled={inv}>{t('Salva')}</button><button type="button" className="btn-ghost wk-big" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}

function ModaleCopia({ i, giorni, tecnici, fmtG, bloccato, onClose, onCopia }: {
  i: Int; giorni: string[]; tecnici: Tec[]; fmtG: (g: string) => string; bloccato: (tec: number, g: string) => boolean; onClose: () => void; onCopia: (d: { g: string; tec: number }[]) => void;
}) {
  const { t } = useT();
  const [gs, setGs] = useState<string[]>([]);
  const [ts, setTs] = useState<number[]>([i.tecnico_id]);
  const tog = <T,>(l: T[], v: T) => (l.includes(v) ? l.filter(x => x !== v) : [...l, v]);
  const dest = (gs.length ? gs : [i.data]).flatMap(g => ts.map(tec => ({ g, tec }))).filter(d => !(d.g === i.data && d.tec === i.tecnico_id));
  const ok = dest.filter(d => !bloccato(d.tec, d.g));
  return (
    <Modal titolo={t('Copia «{l}» su…', { l: i.luogo })} onClose={onClose}>
      <div className="form">
        <div className="field"><label>{t('Giorni')}</label>
          <div className="wk-checks">{giorni.map(g => <label key={g} className="wk-check"><input type="checkbox" checked={gs.includes(g)} onChange={() => setGs(tog(gs, g))} /> {fmtG(g)}</label>)}</div></div>
        <div className="field"><label>{t('Tecnici')}</label>
          <div className="wk-checks">{tecnici.map(x => <label key={x.id} className="wk-check"><input type="checkbox" checked={ts.includes(x.id)} onChange={() => setTs(tog(ts, x.id))} /> {x.nome} {x.cognome}</label>)}</div></div>
        <p className="hint">{t('Se non scegli giorni, si copia sullo stesso giorno. I giorni di assenza o festivi vengono saltati.')}</p>
        {dest.length > ok.length && <div className="msg warn">{t('{n} destinazioni saltate: tecnico assente o giorno festivo.', { n: dest.length - ok.length })}</div>}
        <div className="wk-btns"><button className="btn wk-big" disabled={!ok.length} onClick={() => onCopia(dest)}>{t('Copia ({n})', { n: ok.length })}</button><button className="btn-ghost wk-big" onClick={onClose}>{t('Annulla')}</button></div>
      </div>
    </Modal>
  );
}

/** Stampa agenda (PDF/Excel) di un tecnico o di tutti: giorno, settimana mostrata o mese. */
function Stampa({ lun, tecnici, singolo = false, etichetta }: { lun: string; tecnici: Tec[]; singolo?: boolean; etichetta?: string }) {
  const { t, tm } = useT();
  const [aperto, setAperto] = useState(false);
  const [per, setPer] = useState<'giorno' | 'settimana' | 'mese'>('settimana');
  const [giorno, setGiorno] = useState(() => add(oggiISO(), 1));
  const [inCorso, setInCorso] = useState(false);
  async function vai(tipo: 'pdf' | 'xlsx') {
    const [da, a] = per === 'giorno' ? [giorno, giorno] : per === 'settimana' ? [lun, add(lun, 4)]
      : (() => { const d = pd(lun); const p = fd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))); return [p, fd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))]; })();
    setInCorso(true);
    try {
      const rep = CATALOGO.find(c => c.id === 'agenda')!;
      const r = await rpc<{ righe: Riga[] }>('report_agenda', { p_da: da, p_a: a, p_tecnico: singolo ? tecnici[0].id : null });
      // giorni feriali senza lavori: riga «—» così la settimana si legge per intero
      const righe = [...r.righe];
      const feriali: string[] = []; for (let g = da; g <= a; g = add(g, 1)) if (pd(g).getUTCDay() % 6 !== 0) feriali.push(g);
      for (const tec of tecnici) {
        const nome = `${tec.cognome} ${tec.nome}`;
        const pieni = new Set(righe.filter(x => x.tecnico === nome).map(x => String(x.data)));
        feriali.filter(g => !pieni.has(g)).forEach(g => righe.push({ tecnico: nome, data: g, ora: '', luogo: '', attivita: '', note: '', veicolo: '', stato: 'Vuoto', fatto: '' }));
      }
      righe.sort((p, q) => String(p.tecnico).localeCompare(String(q.tecnico)) || String(p.data).localeCompare(String(q.data)) || String(p.ora ?? '').localeCompare(String(q.ora ?? '')));
      const m = await import('./report/esporta');
      const it = (s: string) => s.split('-').reverse().join('/');
      const ctx = { periodo: da === a ? it(da) : `${it(da)} – ${it(a)}`, filtri: singolo ? `Tecnico ${tecnici[0].nome} ${tecnici[0].cognome}` : '', autore: 'responsabile flotta', generato: new Date() };
      await (tipo === 'pdf' ? m.esportaPdf(rep, righe, ctx) : m.esportaExcel(rep, righe, ctx));
      toast(tipo === 'pdf' ? t('File PDF pronto') : t('File Excel pronto'));
      setAperto(false);
    } catch (e) { toast(tm(testoErrore(e))); }
    finally { setInCorso(false); }
  }
  return (
    <span className="wk-stampa">
      {singolo
        ? <button className="wk-ico" title={t('Stampa agenda')} aria-label={t('Stampa agenda')} onClick={() => setAperto(!aperto)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z" /></svg></button>
        : <button className="btn" onClick={() => setAperto(!aperto)}>{etichetta}</button>}
      {aperto && (
        <div className="wk-pop" role="dialog" aria-label={t('Stampa agenda')}>
          <div className="wk-seg">{(['giorno', 'settimana', 'mese'] as const).map(p => <button key={p} className={per === p ? 'on' : ''} onClick={() => setPer(p)}>{t(p === 'giorno' ? 'Giorno' : p === 'settimana' ? 'Settimana' : 'Mese')}</button>)}</div>
          {per === 'giorno' && <input type="date" aria-label={t('Giorno')} value={giorno} onChange={e => e.target.value && setGiorno(e.target.value)} />}
          <div className="wk-btns"><button className="btn" disabled={inCorso} onClick={() => vai('pdf')}>PDF</button><button className="btn-ghost" disabled={inCorso} onClick={() => vai('xlsx')}>Excel</button>
            <button className="btn-ghost" onClick={() => setAperto(false)}>{t('Chiudi')}</button></div>
        </div>
      )}
    </span>
  );
}
