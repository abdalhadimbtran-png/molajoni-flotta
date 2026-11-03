import { FormEvent, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, toast, useLoad } from '../ui';

/** Elenco delle attività pronte da scegliere negli interventi. Le voci non si cancellano: si disattivano. */
export interface AttivitaPred { id: number; nome: string; gruppo: string | null; durata_minuti: number | null; ordine: number; attiva: boolean }
export const GRUPPI_ATTIVITA = ['Estintori', 'Idranti', 'Porte REI', 'IRAI', 'EVAC', 'Spegnimento', 'Altro'];

export default function ElencoAttivita() {
  const { t, tm } = useT();
  const { data, errore, reload } = useLoad(async () => {
    const r = await supabase.from('attivita_predefinite').select('id,nome,gruppo,durata_minuti,ordine,attiva').order('ordine').order('nome');
    if (r.error) throw r.error;
    return r.data as AttivitaPred[];
  }, []);
  const [nuovo, setNuovo] = useState({ nome: '', gruppo: 'Altro', durata: '' });
  const [err, setErr] = useState<string | null>(null);

  async function esegui(f: () => PromiseLike<{ error: unknown }>, ok?: string) {
    setErr(null);
    const { error } = await f();
    if (error) { setErr(tm(testoErrore(error))); return; }
    if (ok) toast(ok);
    reload();
  }
  const aggiorna = (a: AttivitaPred, v: Partial<AttivitaPred>) => esegui(() => supabase.from('attivita_predefinite').update(v).eq('id', a.id));

  function aggiungi(e: FormEvent) {
    e.preventDefault();
    if (!nuovo.nome.trim()) { setErr(t("Scrivi il nome dell'attività.")); return; }
    const ordine = Math.max(0, ...(data ?? []).map(x => x.ordine)) + 10;
    esegui(() => supabase.from('attivita_predefinite').insert({ nome: nuovo.nome.trim(), gruppo: nuovo.gruppo || null, durata_minuti: nuovo.durata ? Number(nuovo.durata) : null, ordine }), t('Attività aggiunta.'))
      .then(() => setNuovo({ nome: '', gruppo: nuovo.gruppo, durata: '' }));
  }

  async function sposta(i: number, d: -1 | 1) {
    if (!data) return;
    const a = data[i], b = data[i + d]; if (!b) return;
    // riassegna ordini distinti, poi scambia i due
    const ord = data.map((x, k) => ({ id: x.id, ordine: (k + 1) * 10 }));
    [ord[i].ordine, ord[i + d].ordine] = [ord[i + d].ordine, ord[i].ordine];
    setErr(null);
    for (const o of ord) { const { error } = await supabase.from('attivita_predefinite').update({ ordine: o.ordine }).eq('id', o.id); if (error) { setErr(tm(testoErrore(error))); break; } }
    void a; reload();
  }

  function rinomina(a: AttivitaPred) {
    const n = window.prompt(t('Nuovo nome'), a.nome);
    if (n && n.trim() && n.trim() !== a.nome) aggiorna(a, { nome: n.trim() });
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  return (
    <div className="att">
      <div className="page-hero"><div><h1>{t('Elenco attività')}</h1>
        <p className="sub">{t('Le attività pronte da scegliere quando si inserisce un intervento. Con la durata, l\'ora di fine si compila da sola.')}</p></div></div>
      {err && <Banner s="ko">{err}</Banner>}
      <form className="att-nuova" onSubmit={aggiungi}>
        <input aria-label={t('Nome attività')} placeholder={t('Nome attività, es. Controllo estintori')} value={nuovo.nome} onChange={e => setNuovo({ ...nuovo, nome: e.target.value })} />
        <select aria-label={t('Gruppo')} value={nuovo.gruppo} onChange={e => setNuovo({ ...nuovo, gruppo: e.target.value })}>{GRUPPI_ATTIVITA.map(g => <option key={g} value={g}>{t(g)}</option>)}</select>
        <select aria-label={t('Durata')} value={nuovo.durata} onChange={e => setNuovo({ ...nuovo, durata: e.target.value })}><option value="">{t('Durata: nessuna')}</option>{DURATE.map(m => <option key={m} value={m}>{durataTesto(m)}</option>)}</select>
        <button className="btn wk-big">{t('+ Aggiungi')}</button>
      </form>
      {!data ? <Caricamento /> : data.length === 0 ? <Banner s="warn">{t('Nessuna attività. Aggiungi la prima qui sopra.')}</Banner> : (
        <ul className="att-lista">{data.map((a, i) => (
          <li key={a.id} className={a.attiva ? '' : 'att-off'}>
            <div className="att-frecce">
              <button className="btn-ghost" aria-label={t('Sposta su')} disabled={i === 0} onClick={() => sposta(i, -1)}>▲</button>
              <button className="btn-ghost" aria-label={t('Sposta giù')} disabled={i === data.length - 1} onClick={() => sposta(i, 1)}>▼</button>
            </div>
            <div className="att-nome"><b>{a.nome}</b>{!a.attiva && <span className="sub"> · {t('disattivata')}</span>}</div>
            <select aria-label={t('Gruppo')} value={a.gruppo ?? ''} onChange={e => aggiorna(a, { gruppo: e.target.value || null })}>
              <option value="">—</option>{[...new Set([...GRUPPI_ATTIVITA, ...(a.gruppo ? [a.gruppo] : [])])].map(g => <option key={g} value={g}>{t(g)}</option>)}</select>
            <select aria-label={t('Durata')} value={a.durata_minuti ?? ''} onChange={e => aggiorna(a, { durata_minuti: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('Durata: nessuna')}</option>{[...new Set([...DURATE, ...(a.durata_minuti ? [a.durata_minuti] : [])])].sort((x, y) => x - y).map(m => <option key={m} value={m}>{durataTesto(m)}</option>)}</select>
            <button className="btn-ghost" onClick={() => rinomina(a)}>{t('Rinomina')}</button>
            <label className="att-toggle"><input type="checkbox" checked={a.attiva} onChange={() => aggiorna(a, { attiva: !a.attiva })} /> {t('Attiva')}</label>
          </li>
        ))}</ul>
      )}
      <p className="hint">{t('Le attività non si cancellano: se non servono più, togli la spunta «Attiva». Gli interventi già fatti restano com\'erano.')}</p>
    </div>
  );
}

const DURATE = [30, 60, 90, 120, 180, 240, 300, 360, 480];
export const durataTesto = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
