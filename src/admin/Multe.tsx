import { FormEvent, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { STATI_MULTA, fmtData, fmtEuro, fmtOra, giorniA, oggiISO } from '../lib/format';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, Modal, Pill, Targa, toast, useLoad } from '../ui';

interface Multa {
  id: number; veicolo_id: number; data_ora_infrazione: string; luogo: string | null; ente: string | null; numero_verbale: string | null;
  importo: number | null; decurtazione_punti: boolean; data_ricezione: string | null; scadenza_comunicazione: string | null;
  tecnico_id: number | null; stato: string; data_comunicazione: string | null; note: string | null;
  veicoli: { targa: string } | null; tecnici: { nome: string; cognome: string } | null;
}
interface Conducente { tecnico_id: number | null; esito: string; nome?: string; dal?: string | null; al?: string | null }

export default function Multe() {
  const { t } = useT();
  const [modifica, setModifica] = useState<Multa | 'nuova' | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [m, v, tc] = await Promise.all([
      supabase.from('multe').select('*, veicoli(targa), tecnici(nome,cognome)').order('data_ora_infrazione', { ascending: false }).limit(300),
      supabase.from('veicoli').select('id,targa').order('targa'),
      supabase.from('tecnici').select('id,nome,cognome').order('cognome'),
    ]);
    for (const r of [m, v, tc]) if (r.error) throw r.error;
    return { multe: m.data as unknown as Multa[], veicoli: v.data as { id: number; targa: string }[], tecnici: tc.data as { id: number; nome: string; cognome: string }[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const aperte = data.multe.filter(m => ['da_identificare', 'da_comunicare'].includes(m.stato));
  return (
    <>
      <div className="section-title">{t('Multe')} <span className="meta">{t('{n} da gestire', { n: aperte.length })}</span><span className="spacer" />
        <button className="btn btn-sm" onClick={() => setModifica('nuova')}>{t('Registra multa')}</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Infrazione')}</th><th>{t('Veicolo')}</th><th>{t('Conducente')}</th><th>{t('Verbale')}</th><th>{t('Importo')}</th><th>{t('Comunicazione entro')}</th><th>{t('Stato')}</th><th></th></tr></thead>
        <tbody>{data.multe.length ? data.multe.map(m => {
          const [s, l] = STATI_MULTA[m.stato];
          const g = giorniA(m.scadenza_comunicazione);
          const daFare = ['da_identificare', 'da_comunicare'].includes(m.stato);
          return (
            <tr key={m.id}>
              <td className="mono">{fmtOra(m.data_ora_infrazione)}<div className="sub" style={{ whiteSpace: 'normal' }}>{m.luogo}</div></td>
              <td><Targa t={m.veicoli?.targa} /></td>
              <td>{m.tecnici ? `${m.tecnici.nome} ${m.tecnici.cognome}` : <span className="sub">—</span>}</td>
              <td>{m.ente ?? '—'}<div className="sub mono">{m.numero_verbale}</div></td>
              <td className="mono">{fmtEuro(m.importo)}{m.decurtazione_punti && <div><Pill s="warn">{t('Punti patente')}</Pill></div>}</td>
              <td>{m.scadenza_comunicazione ? <div className="scad"><Pill s={!daFare ? 'na' : g! < 0 ? 'ko' : g! <= 15 ? 'warn' : 'ok'}>{!daFare ? t('Fatto') : g! < 0 ? t('Scaduta') : t('Tra {n} gg', { n: g! })}</Pill><span className="mono sub">{fmtData(m.scadenza_comunicazione)}</span></div> : <span className="sub">—</span>}</td>
              <td><Pill s={s}>{t(l)}</Pill></td>
              <td><button className="btn-ghost btn-sm" onClick={() => setModifica(m)}>{t('Apri')}</button></td>
            </tr>
          );
        }) : <tr><td colSpan={8} className="sub">{t('Nessuna multa registrata')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Per le infrazioni con decurtazione punti il conducente va comunicato entro 60 giorni dalla ricezione del verbale. Il sistema trova il conducente dal registro movimenti: verifica sempre prima di comunicarlo.')}</p>
      {modifica && <FormMulta m={modifica === 'nuova' ? null : modifica} veicoli={data.veicoli} tecnici={data.tecnici} onClose={() => setModifica(null)} onSalvato={() => { setModifica(null); reload(); }} />}
    </>
  );
}

function locale16(ts: string | null | undefined) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function FormMulta({ m, veicoli, tecnici, onClose, onSalvato }: { m: Multa | null; veicoli: { id: number; targa: string }[]; tecnici: { id: number; nome: string; cognome: string }[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({
    veicolo_id: m ? String(m.veicolo_id) : '', data_ora: locale16(m?.data_ora_infrazione), luogo: m?.luogo ?? '', ente: m?.ente ?? '', numero_verbale: m?.numero_verbale ?? '',
    importo: m?.importo != null ? String(m.importo) : '', decurtazione_punti: m?.decurtazione_punti ?? false, data_ricezione: m?.data_ricezione ?? oggiISO(),
    tecnico_id: m?.tecnico_id ? String(m.tecnico_id) : '', stato: m?.stato ?? 'da_identificare', data_comunicazione: m?.data_comunicazione ?? '', note: m?.note ?? '',
  });
  const [cond, setCond] = useState<Conducente | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function trova() {
    setErr(null); setCond(null);
    if (!f.veicolo_id || !f.data_ora) { setErr(t('Indica veicolo, data e ora dell\'infrazione.')); return; }
    try {
      const r = await rpc<Conducente>('conducente_alle', { p_veicolo: Number(f.veicolo_id), p_ts: new Date(f.data_ora).toISOString() });
      setCond(r);
      if (r.tecnico_id) setF(x => ({ ...x, tecnico_id: String(r.tecnico_id), stato: x.stato === 'da_identificare' ? 'da_comunicare' : x.stato }));
    } catch (e) { setErr(tm(testoErrore(e))); }
  }
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const rec = {
      veicolo_id: Number(f.veicolo_id), data_ora_infrazione: new Date(f.data_ora).toISOString(), luogo: f.luogo.trim() || null, ente: f.ente.trim() || null,
      numero_verbale: f.numero_verbale.trim() || null, importo: f.importo ? Number(f.importo.replace(',', '.')) : null, decurtazione_punti: f.decurtazione_punti,
      data_ricezione: f.data_ricezione || null, tecnico_id: f.tecnico_id ? Number(f.tecnico_id) : null, stato: f.stato,
      data_comunicazione: f.data_comunicazione || null, note: f.note.trim() || null,
    };
    const { error } = m ? await supabase.from('multe').update(rec).eq('id', m.id) : await supabase.from('multe').insert(rec);
    if (error) { setErr(tm(testoErrore(error))); return; }
    toast(t('Multa salvata')); onSalvato();
  }
  return (
    <Modal titolo={m ? t('Multa') : t('Registra multa')} onClose={onClose}>
      <form className="form grid2" onSubmit={salva}>
        <div className="field"><label htmlFor="mu-v">{t('Veicolo')}</label><select id="mu-v" required value={f.veicolo_id} onChange={set('veicolo_id')}>
          <option value="">{t('Seleziona')}</option>{veicoli.map(v => <option key={v.id} value={v.id}>{v.targa}</option>)}</select></div>
        <div className="field"><label htmlFor="mu-d">{t('Data e ora infrazione')}</label><input id="mu-d" type="datetime-local" required value={f.data_ora} onChange={set('data_ora')} /></div>
        <div className="span2 row-flex"><button type="button" className="btn-ghost" onClick={trova}>🔎 {t('Trova il conducente dal registro')}</button>
          {cond && (cond.tecnico_id
            ? <span className="msg ok">{t('{n} aveva il veicolo (dal {d})', { n: cond.nome ?? '', d: fmtOra(cond.dal) })}</span>
            : <span className="msg warn">{cond.esito === 'in_sede' ? t('Il veicolo risultava in sede: verifica a mano.') : t('Nessun movimento registrato prima di quell\'ora.')}</span>)}</div>
        <div className="field"><label htmlFor="mu-t">{t('Conducente')}</label><select id="mu-t" value={f.tecnico_id} onChange={set('tecnico_id')}>
          <option value="">—</option>{tecnici.map(x => <option key={x.id} value={x.id}>{x.nome} {x.cognome}</option>)}</select></div>
        <div className="field"><label htmlFor="mu-s">{t('Stato')}</label><select id="mu-s" value={f.stato} onChange={set('stato')}>
          {Object.entries(STATI_MULTA).map(([k, [, l]]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        <div className="field"><label htmlFor="mu-l">{t('Luogo')}</label><input id="mu-l" value={f.luogo} onChange={set('luogo')} /></div>
        <div className="field"><label htmlFor="mu-e">{t('Ente')}</label><input id="mu-e" value={f.ente} onChange={set('ente')} placeholder="Polizia Locale…" /></div>
        <div className="field"><label htmlFor="mu-n">{t('Numero verbale')}</label><input id="mu-n" dir="ltr" value={f.numero_verbale} onChange={set('numero_verbale')} /></div>
        <div className="field"><label htmlFor="mu-i">{t('Importo (€)')}</label><input id="mu-i" inputMode="decimal" value={f.importo} onChange={set('importo')} /></div>
        <div className="field"><label htmlFor="mu-r">{t('Data ricezione verbale')}</label><input id="mu-r" type="date" value={f.data_ricezione} onChange={set('data_ricezione')} /></div>
        <div className="field"><label htmlFor="mu-c">{t('Data comunicazione conducente')}</label><input id="mu-c" type="date" value={f.data_comunicazione} onChange={set('data_comunicazione')} /></div>
        <label className="chk span2"><input type="checkbox" checked={f.decurtazione_punti} onChange={set('decurtazione_punti')} /> {t('Prevede decurtazione punti (comunicazione conducente entro 60 giorni)')}</label>
        <div className="field span2"><label htmlFor="mu-no">{t('Note')}</label><input id="mu-no" value={f.note} onChange={set('note')} /></div>
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn">{t('Salva')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}
