import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtData, giorniA, oggiISO } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_TECNICI, type Tecnico } from '../lib/tipi';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';

interface Assenza { id: number; tecnico_id: number; dal: string; al: string; motivo: string }
const MOTIVI = ['Ferie', 'Permesso', 'Assenza', 'Formazione', 'Altro'];

export default function Tecnici() {
  const { t, tm } = useT();
  const [modifica, setModifica] = useState<Tecnico | 'nuovo' | null>(null);
  const [pin, setPin] = useState<Tecnico | null>(null);
  const [mostraInattivi, setMostraInattivi] = useState(false);
  const { data, errore, reload } = useLoad(async () => {
    const [tc, a] = await Promise.all([
      supabase.from('tecnici').select(SEL_TECNICI).order('cognome'),
      supabase.from('assenze').select('*').gte('al', oggiISO()).order('dal'),
    ]);
    if (tc.error) throw tc.error; if (a.error) throw a.error;
    return { tecnici: tc.data as Tecnico[], assenze: a.data as Assenza[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.tecnici.filter(x => mostraInattivi || x.attivo);
  const nome = (id: number) => { const x = data.tecnici.find(y => y.id === id); return x ? `${x.nome} ${x.cognome}` : '—'; };

  async function sblocca(x: Tecnico) {
    const { error } = await supabase.from('tecnici').update({ tentativi_falliti: 0, bloccato_fino: null }).eq('id', x.id);
    if (error) toast(tm(testoErrore(error))); else { toast(t('Accesso sbloccato')); reload(); }
  }
  async function eliminaAssenza(id: number) {
    const { error } = await supabase.from('assenze').delete().eq('id', id);
    if (error) toast(tm(testoErrore(error))); else reload();
  }

  return (
    <>
      <div className="section-title">{t('Tecnici e conducenti')} <span className="meta">{lista.length}</span><span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={mostraInattivi} onChange={e => setMostraInattivi(e.target.checked)} /> {t('Mostra non attivi')}</label>
        <Link className="btn-ghost btn-sm" to="/installa-tecnici">📱 {t('Istruzioni app per i tecnici')}</Link>
        <button className="btn btn-sm" onClick={() => setModifica('nuovo')}>{t('Nuovo tecnico')}</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Tecnico')}</th><th>{t('Codice app')}</th><th>{t('Ruolo')}</th><th>{t('Patente')}</th><th>{t('Accesso app')}</th><th></th></tr></thead>
        <tbody>{lista.length ? lista.map(x => {
          const g = giorniA(x.patente_scadenza);
          const bloccato = x.bloccato_fino && new Date(x.bloccato_fino) > new Date();
          return (
            <tr key={x.id} className={x.attivo ? '' : 'muted'}>
              <td><div style={{ fontWeight: 600 }}>{x.nome} {x.cognome}</div><div className="sub">{x.telefono ?? ''}{!x.attivo ? ` · ${t('non attivo')}` : ''}</div></td>
              <td className="mono">{x.codice}</td>
              <td>{x.ruolo ?? '—'}</td>
              <td>{x.patente_categoria ?? '—'} <div className="scad" style={{ marginTop: 3 }}>{g == null ? <Pill s="warn">{t('Scadenza non registrata')}</Pill>
                : <><Pill s={g < 0 ? 'ko' : g <= 30 ? 'warn' : 'ok'}>{g < 0 ? t('Scaduta') : g <= 30 ? t('Tra {n} gg', { n: g }) : t('Valida')}</Pill><span className="mono sub">{fmtData(x.patente_scadenza)}</span></>}</div></td>
              <td>{bloccato ? <Pill s="ko">{t('Bloccato')}</Pill> : x.ha_pin ? <Pill s="ok">{t('PIN attivo')}</Pill> : <Pill s="warn">{t('PIN da impostare')}</Pill>}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setModifica(x)}>{t('Modifica')}</button>
                <button className="btn-ghost btn-sm" onClick={() => setPin(x)}>{x.ha_pin ? t('Nuovo PIN') : t('Imposta PIN')}</button>
                {bloccato && <button className="btn-ghost btn-sm" onClick={() => sblocca(x)}>{t('Sblocca')}</button>}
              </td>
            </tr>
          );
        }) : <tr><td colSpan={6} className="sub">{t('Nessun tecnico. Usa "Nuovo tecnico".')}</td></tr>}</tbody>
      </table></div>

      <div className="section-title">{t('Assenze in corso e future')} <span className="meta">{t('i tecnici assenti non ricevono veicoli nel piano')}</span></div>
      <NuovaAssenza tecnici={data.tecnici.filter(x => x.attivo)} onSalvato={reload} />
      <div className="table-wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>{t('Tecnico')}</th><th>{t('Dal')}</th><th>{t('Al')}</th><th>{t('Motivo')}</th><th></th></tr></thead>
        <tbody>{data.assenze.length ? data.assenze.map(a => (
          <tr key={a.id}><td>{nome(a.tecnico_id)}</td><td className="mono">{fmtData(a.dal)}</td><td className="mono">{fmtData(a.al)}</td><td>{t(a.motivo)}</td>
            <td><button className="btn-ghost btn-sm" onClick={() => eliminaAssenza(a.id)}>{t('Elimina')}</button></td></tr>
        )) : <tr><td colSpan={5} className="sub">{t('Nessuna assenza registrata')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Le assenze qui sono temporanee: in seguito arriveranno dal sistema HR, così non si inseriscono due volte.')}</p>

      {modifica && <FormTecnico x={modifica === 'nuovo' ? null : modifica} onClose={() => setModifica(null)} onSalvato={() => { setModifica(null); reload(); }} />}
      {pin && <ModalePin x={pin} onClose={() => setPin(null)} onSalvato={() => { setPin(null); reload(); }} />}
    </>
  );
}

function FormTecnico({ x, onClose, onSalvato }: { x: Tecnico | null; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({
    codice: x?.codice ?? '', nome: x?.nome ?? '', cognome: x?.cognome ?? '', ruolo: x?.ruolo ?? '', telefono: x?.telefono ?? '',
    patente_categoria: x?.patente_categoria ?? 'B', patente_scadenza: x?.patente_scadenza ?? '', attivo: x?.attivo ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const rec = { codice: f.codice.toUpperCase().replace(/[^A-Z0-9]/g, ''), nome: f.nome.trim(), cognome: f.cognome.trim(), ruolo: f.ruolo.trim() || null,
      telefono: f.telefono.trim() || null, patente_categoria: f.patente_categoria.trim() || null, patente_scadenza: f.patente_scadenza || null, attivo: f.attivo };
    const { error } = x ? await supabase.from('tecnici').update(rec).eq('id', x.id) : await supabase.from('tecnici').insert(rec);
    if (error) { setErr(tm(testoErrore(error))); return; }
    toast(x ? t('Tecnico aggiornato') : t('Tecnico aggiunto: ora imposta il PIN')); onSalvato();
  }
  return (
    <Modal titolo={x ? t('Modifica {n}', { n: `${x.nome} ${x.cognome}` }) : t('Nuovo tecnico')} onClose={onClose}>
      <form className="form grid2" onSubmit={salva}>
        <div className="field"><label htmlFor="t-nome">{t('Nome')}</label><input id="t-nome" required value={f.nome} onChange={set('nome')} /></div>
        <div className="field"><label htmlFor="t-cog">{t('Cognome')}</label><input id="t-cog" required value={f.cognome} onChange={set('cognome')} /></div>
        <div className="field"><label htmlFor="t-cod">{t("Codice per l'app")}</label><input id="t-cod" dir="ltr" required value={f.codice} onChange={set('codice')} placeholder="ROSSIM" /></div>
        <div className="field"><label htmlFor="t-ruolo">{t('Ruolo')}</label><input id="t-ruolo" value={f.ruolo} onChange={set('ruolo')} /></div>
        <div className="field"><label htmlFor="t-tel">{t('Telefono')}</label><input id="t-tel" dir="ltr" value={f.telefono} onChange={set('telefono')} /></div>
        <div className="field"><label htmlFor="t-cat">{t('Categoria patente')}</label><input id="t-cat" value={f.patente_categoria} onChange={set('patente_categoria')} /></div>
        <div className="field"><label htmlFor="t-scad">{t('Scadenza patente')}</label><input id="t-scad" type="date" value={f.patente_scadenza} onChange={set('patente_scadenza')} /></div>
        {x && <label className="chk"><input type="checkbox" checked={f.attivo} onChange={set('attivo')} /> {t('Attivo')}</label>}
        <p className="hint span2">{t("Il codice è quello che il tecnico digita nell'app insieme al PIN. Registra solo i dati necessari alla gestione dei veicoli.")}</p>
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn">{t('Salva')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}

function ModalePin({ x, onClose, onSalvato }: { x: Tecnico; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const genera = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const [pin, setPin] = useState(genera);
  const [salvato, setSalvato] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function salva() {
    setErr(null);
    try { await rpc('imposta_pin', { p_tecnico: x.id, p_pin: pin }); setSalvato(true); }
    catch (e) { setErr(tm(testoErrore(e))); }
  }
  return (
    <Modal titolo={t('PIN per {n}', { n: `${x.nome} ${x.cognome}` })} onClose={salvato ? onSalvato : onClose}>
      <div className="form">
        {!salvato ? <>
          <div className="field"><label htmlFor="pin">{t('PIN di 6 cifre')}</label>
            <input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
          <p className="hint">{t('Impostando un nuovo PIN il tecnico viene disconnesso da tutti i telefoni.')}</p>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" onClick={salva} disabled={pin.length !== 6}>{t('Salva PIN')}</button><button className="btn-ghost" onClick={() => setPin(genera())}>{t('Genera un altro')}</button></div>
        </> : <>
          <Banner s="ok">{t('PIN salvato. Comunicalo al tecnico di persona: codice {c}, PIN {p}. Dopo la chiusura non sarà più visibile.', { c: x.codice, p: pin })}</Banner>
          <button className="btn" onClick={onSalvato}>{t('Fatto')}</button>
        </>}
      </div>
    </Modal>
  );
}

function NuovaAssenza({ tecnici, onSalvato }: { tecnici: Tecnico[]; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({ tecnico_id: '', dal: oggiISO(), al: oggiISO(), motivo: 'Ferie' });
  const [err, setErr] = useState<string | null>(null);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('assenze').insert({ ...f, tecnico_id: Number(f.tecnico_id) });
    if (error) { setErr(error.message.includes('check') ? t('La data "al" non può essere prima della data "dal".') : tm(testoErrore(error))); return; }
    toast(t('Assenza registrata')); onSalvato();
  }
  return (
    <form className="row-flex wrap-end" onSubmit={salva}>
      <div className="field"><label htmlFor="a-t">{t('Tecnico')}</label><select id="a-t" required value={f.tecnico_id} onChange={e => setF({ ...f, tecnico_id: e.target.value })}>
        <option value="">{t('Seleziona')}</option>{tecnici.map(x => <option key={x.id} value={x.id}>{x.nome} {x.cognome}</option>)}</select></div>
      <div className="field"><label htmlFor="a-dal">{t('Dal')}</label><input id="a-dal" type="date" required value={f.dal} onChange={e => setF({ ...f, dal: e.target.value })} /></div>
      <div className="field"><label htmlFor="a-al">{t('Al')}</label><input id="a-al" type="date" required value={f.al} onChange={e => setF({ ...f, al: e.target.value })} /></div>
      <div className="field"><label htmlFor="a-m">{t('Motivo')}</label><select id="a-m" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })}>
        {MOTIVI.map(m => <option key={m} value={m}>{t(m)}</option>)}</select></div>
      <button className="btn">{t('Aggiungi assenza')}</button>
      {err && <div className="msg ko">{err}</div>}
    </form>
  );
}
