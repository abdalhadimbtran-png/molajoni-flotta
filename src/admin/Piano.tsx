import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtGiorno, fmtOra, prossimoLavorativo, STATI_VEICOLO } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_VEICOLI, type Intervento, type Piano as TPiano, type RigaPiano, type Veicolo } from '../lib/tipi';
import { Banner, Caricamento, Errore, Msgs, Pill, toast, useLoad } from '../ui';
import PillPresenza, { presenzaDaNota, type Presenza } from './PillPresenza';

/** Campi aggiunti a piano_giorno dal modulo ferie (migrazioni 0013-0014): mai il tipo di assenza. */
interface RigaFerie extends RigaPiano { possibile_assenza?: boolean; note_assenza?: string[] }
type VeicoloPiano = Veicolo & { in_carico_assente?: boolean };

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
/** Messaggi del server già detti dalla pill di presenza: non si ripetono. */
const RIDONDANTI = new Set(['Assente: Assente', 'Possibile assenza: richiesta in attesa di decisione']);

export default function Piano() {
  const { t, tm, locale } = useT();
  const [sp, setSp] = useSearchParams();
  const daUrl = sp.get('data');
  const [giorno, setGiornoStato] = useState(daUrl && DATA_OK.test(daUrl) ? daUrl : prossimoLavorativo());
  const setGiorno = (g: string) => { setGiornoStato(g); setSp({ data: g }, { replace: true }); };
  // la notifica «Interventi da riassegnare» può aprire un altro giorno mentre il piano è già aperto
  useEffect(() => { if (daUrl && DATA_OK.test(daUrl)) setGiornoStato(daUrl); }, [daUrl]);
  const [esito, setEsito] = useState<{ s: 'ok' | 'ko'; t: string } | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [p, v, a] = await Promise.all([
      rpc<TPiano>('piano_giorno', { p_data: giorno }),
      supabase.from('v_veicoli').select(`${SEL_VEICOLI},in_carico_assente`).eq('dismesso', false).order('targa'),
      supabase.from('assenze').select('tecnico_id,al').lte('dal', giorno).gte('al', giorno),
    ]);
    if (v.error) throw v.error;
    const n = await supabase.from('notifiche').select('tecnico_id,letta_il,creato_il').eq('tipo', 'piano').eq('dati->>data', giorno).order('creato_il', { ascending: false });
    const lette: Record<number, { letta_il: string | null; creato_il: string }> = {};
    (n.data ?? []).forEach(x => { if (x.tecnico_id && !lette[x.tecnico_id]) lette[x.tecnico_id] = x; });
    // giorno di rientro: primo giorno lavorativo dopo la fine dell'assenza (festività comprese, lo calcola il server)
    const fine: Record<number, string> = {};
    ((a.data ?? []) as { tecnico_id: number; al: string }[]).forEach(x => { if (!fine[x.tecnico_id] || x.al > fine[x.tecnico_id]) fine[x.tecnico_id] = x.al; });
    const rientri: Record<number, string> = {};
    await Promise.all(Object.entries(fine).map(async ([id, al]) => {
      try { rientri[Number(id)] = await rpc<string>('prossimo_lavorativo', { p_da: al }); } catch { rientri[Number(id)] = prossimoLavorativo(al); }
    }));
    return { piano: p as TPiano & { righe: RigaFerie[] }, veicoli: v.data as unknown as VeicoloPiano[], lette, rientri };
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
    const r = await rpc<{ ok: boolean; bloccati?: string[]; notificati?: number }>('conferma_piano', { p_data: giorno });
    if (!r.ok) throw new Error(t("Il piano non può essere confermato: {n} tecnici hanno un blocco ({l}). Cambia il veicolo, sposta l'intervento o risolvi la scadenza.", { n: r.bloccati!.length, l: r.bloccati!.join(', ') }));
    toast(r.notificati ? t('Piano confermato. Notificati solo i {n} tecnici con modifiche.', { n: r.notificati }) : t('Piano confermato. Nessuna modifica: nessuna nuova notifica.'));
  });

  const eliminaIntervento = (id: number) => azione(async () => {
    const { error } = await supabase.from('interventi').delete().eq('id', id);
    if (error) throw error;
  });

  const sposta = (i: Intervento, a: RigaPiano) => azione(async () => {
    const { error } = await supabase.from('interventi').update({ tecnico_id: a.tecnico_id }).eq('id', i.id);
    if (error) throw error;
    toast(t('Intervento spostato a {n}.', { n: a.nome }));
  });

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const righe = data ? [...data.piano.righe].sort((a, b) => (a.prima_ora ?? '99').localeCompare(b.prima_ora ?? '99') || a.nome.localeCompare(b.nome)) : [];
  const n = (l: string) => righe.filter(r => r.livello === l).length;
  const presenza = (r: RigaFerie): Presenza | null =>
    r.assenza ? { tipo: 'intera', rientro: data?.rientri[r.tecnico_id] }
      : r.note_assenza?.length ? presenzaDaNota(r.note_assenza[0])
      : r.possibile_assenza ? { tipo: 'intera', possibile: true } : null;
  const daRiassegnare = righe.filter(r => r.assenza && r.interventi.length > 0);
  const presenti = righe.filter(r => !r.assenza);
  const assenti = righe.filter(r => r.assenza).length;
  const nInt = daRiassegnare.reduce((s, r) => s + r.interventi.length, 0);

  return (
    <>
      <div className="plan-head">
        <div>
          <div className="field"><label htmlFor="giorno">{t('Giorno')}</label>
            <input id="giorno" type="date" value={giorno} onChange={e => e.target.value && setGiorno(e.target.value)} /></div>
          <div className="plan-day">{fmtGiorno(giorno, locale)}</div>
          {data && <div className="chips"><Pill s="ko">{t('{n} bloccati', { n: n('ko') })}</Pill><Pill s="warn">{t('{n} con avvisi', { n: n('warn') })}</Pill><Pill s="ok">{t('{n} idonei', { n: n('ok') })}</Pill>
            {assenti > 0 && <Pill s="na">{t('{n} assenti', { n: assenti })}</Pill>}</div>}
        </div>
        <div className="row-flex"><button className="btn-ghost" onClick={proponi}>{t('Proponi assegnazioni')}</button><button className="btn" onClick={conferma}>{t('Conferma piano')}</button></div>
      </div>
      {data?.piano.confermato_il && <Banner s="ok">{t('Piano confermato il {d}. Ogni modifica a interventi, veicoli o assenze di questo giorno annulla la conferma.', { d: fmtOra(data.piano.confermato_il, locale) })}</Banner>}
      {data && daRiassegnare.length > 0 && <Banner s="warn">{t('{nome} sarà assente. {n} interventi da riassegnare prima di confermare il piano.', { nome: daRiassegnare.map(r => r.nome).join(', '), n: nInt })}</Banner>}
      {esito && <Banner s={esito.s}>{esito.t}</Banner>}
      {!data ? <Caricamento /> : righe.length === 0 ? <Banner s="warn">{t("Nessun tecnico attivo. I tecnici li inserisce l'ufficio personale.")}</Banner> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Tecnico')}</th><th>{t('Interventi')}</th><th>{t('Veicolo')}</th><th>{t('Controlli')}</th></tr></thead>
          <tbody>{righe.map(r => {
            const ass = !!r.assenza;
            const riassegna = ass && r.interventi.length > 0;
            const note = new Set(r.note_assenza ?? []);
            const msgs = r.messaggi.filter(m => !RIDONDANTI.has(m.m) && !(m.l === 'info' && note.has(m.m)));
            return (
              <tr key={r.tecnico_id} className={riassegna ? 'row-ko' : ass ? 'muted' : `row-${r.livello}`}>
                <td><div style={{ fontWeight: 500 }}>{r.nome}</div><div className="sub">{r.ruolo ?? '—'}{r.patente ? ` · ${t('Patente')} ${r.patente}` : ''}</div>
                  <PillPresenza assenza={presenza(r)} />
                  {riassegna && <div className="presenza"><Pill s="ko">{t('Da riassegnare')}</Pill></div>}</td>
                <td className="cell-int">
                  {r.interventi.map(i => (
                    <div key={i.id} className={`int${riassegna ? ' int-sposta' : ''}`}><span className="h">{i.ora ?? '—'}</span>
                      <span className="grow">{i.luogo}<div className="sub">{i.attivita}</div>
                        {riassegna && <select className="sposta" aria-label={t('Sposta a…')} value="" onChange={e => { const a = presenti.find(x => x.tecnico_id === Number(e.target.value)); if (a) sposta(i, a); }}>
                          <option value="">{t('Sposta a…')}</option>
                          {presenti.map(a => <option key={a.tecnico_id} value={a.tecnico_id}>{a.nome}{a.note_assenza?.length ? ` · ${t('non disponibile per alcune ore')}` : ''}</option>)}
                        </select>}</span>
                      <button className="x" title={t('Elimina intervento')} aria-label={t('Elimina intervento')} onClick={() => eliminaIntervento(i.id)}>×</button></div>
                  ))}
                  {!ass && <NuovoIntervento giorno={giorno} tecnico={r.tecnico_id} onSalvato={reload} />}
                </td>
                <td>
                  <select aria-label={t('Veicolo per {n}', { n: r.nome })} value={r.veicolo_id ?? ''} disabled={ass} onChange={e => cambiaVeicolo(r, e.target.value)}>
                    <option value="">{t('— nessun veicolo —')}</option>
                    {data.veicoli.map(v => {
                      const [s, l] = STATI_VEICOLO[v.stato] ?? ['na', v.stato];
                      return <option key={v.id} value={v.id}>{v.targa} · {v.marca_modello}{s === 'ko' ? ` (${t(l)})` : v.in_carico_assente ? ` (${t('libero: tecnico assente')})` : ''}</option>;
                    })}
                  </select>
                </td>
                <td><Msgs items={msgs} />
                  {data.lette[r.tecnico_id] && <div className="sub" style={{ marginTop: 6 }}>{data.lette[r.tecnico_id].letta_il
                    ? <span className="msg ok">{t('Piano visto dal tecnico alle {d}', { d: fmtOra(data.lette[r.tecnico_id].letta_il, locale) })}</span>
                    : <span className="msg warn">{t('Notifica inviata, non ancora vista')}</span>}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="hint">{t('"Proponi assegnazioni" riempie solo le righe senza veicolo o con veicolo non utilizzabile, scegliendo tra i veicoli liberi e idonei. Non tocca le assegnazioni già valide. Il piano si conferma solo se nessun tecnico con interventi ha un blocco.')}</p>
      <p className="hint">{t("Le assenze arrivano dall'ufficio personale e aggiornano il piano da sole.")}</p>
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
