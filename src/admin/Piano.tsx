import { FormEvent, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtGiorno, fmtOra, prossimoLavorativo, STATI_VEICOLO } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_VEICOLI, type Piano as TPiano, type RigaPiano, type Veicolo } from '../lib/tipi';
import { Banner, Caricamento, Errore, Msgs, Pill, toast, useLoad } from '../ui';

export default function Piano() {
  const { t, tm, locale } = useT();
  const [giorno, setGiorno] = useState(prossimoLavorativo());
  const [esito, setEsito] = useState<{ s: 'ok' | 'ko'; t: string } | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [p, v] = await Promise.all([
      rpc<TPiano>('piano_giorno', { p_data: giorno }),
      supabase.from('v_veicoli').select(SEL_VEICOLI).eq('dismesso', false).order('targa'),
    ]);
    if (v.error) throw v.error;
    return { piano: p, veicoli: v.data as unknown as Veicolo[] };
  }, [giorno]);

  async function azione(f: () => Promise<void>) {
    setEsito(null);
    try { await f(); await reload(); } catch (e) { setEsito({ s: 'ko', t: tm(testoErrore(e)) }); }
  }

  const cambiaVeicolo = (r: RigaPiano, val: string) => azione(async () => {
    const { error } = await supabase.from('assegnazioni').upsert(
      { data: giorno, tecnico_id: r.tecnico_id, veicolo_id: val ? Number(val) : null, aggiornato_il: new Date().toISOString() },
      { onConflict: 'data,tecnico_id' });
    if (error) throw error;
  });

  const proponi = () => azione(async () => {
    const r = await rpc<{ cambi: number; senza_veicolo: string[] }>('proponi_assegnazioni', { p_data: giorno });
    toast(r.cambi ? t('{n} assegnazioni proposte.', { n: r.cambi }) : t('Nessuna modifica necessaria.'));
    if (r.senza_veicolo.length) setEsito({ s: 'ko', t: t('Nessun veicolo idoneo libero per: {n}.', { n: r.senza_veicolo.join(', ') }) });
  });

  const conferma = () => azione(async () => {
    const r = await rpc<{ ok: boolean; bloccati?: string[] }>('conferma_piano', { p_data: giorno });
    if (!r.ok) throw new Error(t("Il piano non può essere confermato: {n} tecnici hanno un blocco ({l}). Cambia il veicolo, sposta l'intervento o risolvi la scadenza.", { n: r.bloccati!.length, l: r.bloccati!.join(', ') }));
    toast(t("Piano confermato. I tecnici vedono il veicolo assegnato nell'app."));
  });

  const eliminaIntervento = (id: number) => azione(async () => {
    const { error } = await supabase.from('interventi').delete().eq('id', id);
    if (error) throw error;
  });

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const righe = data ? [...data.piano.righe].sort((a, b) => (a.prima_ora ?? '99').localeCompare(b.prima_ora ?? '99') || a.nome.localeCompare(b.nome)) : [];
  const n = (l: string) => righe.filter(r => r.livello === l).length;

  return (
    <>
      <div className="plan-head">
        <div>
          <div className="field"><label htmlFor="giorno">{t('Giorno')}</label>
            <input id="giorno" type="date" value={giorno} onChange={e => e.target.value && setGiorno(e.target.value)} /></div>
          <div className="plan-day">{fmtGiorno(giorno, locale)}</div>
          {data && <div className="chips"><Pill s="ko">{t('{n} bloccati', { n: n('ko') })}</Pill><Pill s="warn">{t('{n} con avvisi', { n: n('warn') })}</Pill><Pill s="ok">{t('{n} idonei', { n: n('ok') })}</Pill></div>}
        </div>
        <div className="row-flex"><button className="btn-ghost" onClick={proponi}>{t('Proponi assegnazioni')}</button><button className="btn" onClick={conferma}>{t('Conferma piano')}</button></div>
      </div>
      {data?.piano.confermato_il && <Banner s="ok">{t('Piano confermato il {d}. Ogni modifica a interventi, veicoli o assenze di questo giorno annulla la conferma.', { d: fmtOra(data.piano.confermato_il, locale) })}</Banner>}
      {esito && <Banner s={esito.s}>{esito.t}</Banner>}
      {!data ? <Caricamento /> : righe.length === 0 ? <Banner s="warn">{t('Nessun tecnico attivo. Aggiungi i tecnici dalla pagina Tecnici.')}</Banner> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Tecnico')}</th><th>{t('Interventi')}</th><th>{t('Veicolo')}</th><th>{t('Controlli')}</th></tr></thead>
          <tbody>{righe.map(r => (
            <tr key={r.tecnico_id} className={`row-${r.livello}`}>
              <td><div style={{ fontWeight: 500 }}>{r.nome}</div><div className="sub">{r.ruolo ?? '—'}{r.patente ? ` · ${t('Patente')} ${r.patente}` : ''}</div></td>
              <td className="cell-int">
                {r.interventi.map(i => (
                  <div key={i.id} className="int"><span className="h">{i.ora ?? '—'}</span>
                    <span className="grow">{i.luogo}<div className="sub">{i.attivita}</div></span>
                    <button className="x" title={t('Elimina intervento')} aria-label={t('Elimina intervento')} onClick={() => eliminaIntervento(i.id)}>×</button></div>
                ))}
                {!r.assenza && <NuovoIntervento giorno={giorno} tecnico={r.tecnico_id} onSalvato={reload} />}
              </td>
              <td>
                <select aria-label={t('Veicolo per {n}', { n: r.nome })} value={r.veicolo_id ?? ''} disabled={!!r.assenza} onChange={e => cambiaVeicolo(r, e.target.value)}>
                  <option value="">{t('— nessun veicolo —')}</option>
                  {data.veicoli.map(v => {
                    const [s, l] = STATI_VEICOLO[v.stato] ?? ['na', v.stato];
                    return <option key={v.id} value={v.id}>{v.targa} · {v.marca_modello}{s === 'ko' ? ` (${t(l)})` : ''}</option>;
                  })}
                </select>
              </td>
              <td><Msgs items={r.messaggi} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="hint">{t('"Proponi assegnazioni" riempie solo le righe senza veicolo o con veicolo non utilizzabile, scegliendo tra i veicoli liberi e idonei. Non tocca le assegnazioni già valide. Il piano si conferma solo se nessun tecnico con interventi ha un blocco.')}</p>
    </>
  );
}

function NuovoIntervento({ giorno, tecnico, onSalvato }: { giorno: string; tecnico: number; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [aperto, setAperto] = useState(false);
  const [ora, setOra] = useState('08:00'); const [luogo, setLuogo] = useState(''); const [att, setAtt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!aperto) return <button className="link" onClick={() => setAperto(true)}>{t('+ Aggiungi intervento')}</button>;
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('interventi').insert({ data: giorno, tecnico_id: tecnico, ora: ora || null, luogo: luogo.trim(), attivita: att.trim() });
    if (error) { setErr(tm(testoErrore(error))); return; }
    setLuogo(''); setAtt(''); setAperto(false); onSalvato();
  }
  return (
    <form className="mini-form" onSubmit={salva}>
      <input type="time" aria-label={t('Ora')} value={ora} onChange={e => setOra(e.target.value)} />
      <input type="text" aria-label={t('Cliente / luogo')} placeholder={t('Cliente / luogo')} required value={luogo} onChange={e => setLuogo(e.target.value)} />
      <input type="text" aria-label={t('Attività')} placeholder={t('Attività')} required value={att} onChange={e => setAtt(e.target.value)} />
      <div className="row-flex"><button className="btn btn-sm">{t('Salva')}</button><button type="button" className="btn-ghost btn-sm" onClick={() => setAperto(false)}>{t('Annulla')}</button></div>
      {err && <div className="msg ko">{err}</div>}
    </form>
  );
}
