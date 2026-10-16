import { FormEvent, useState } from 'react';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtData, giorniA, oggiISO } from '../lib/format';
import { SEL_TECNICI, type Tecnico } from '../lib/tipi';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';

interface Assenza { id: number; tecnico_id: number; dal: string; al: string; motivo: string }

export default function Tecnici() {
  const [modifica, setModifica] = useState<Tecnico | 'nuovo' | null>(null);
  const [pin, setPin] = useState<Tecnico | null>(null);
  const [mostraInattivi, setMostraInattivi] = useState(false);
  const { data, errore, reload } = useLoad(async () => {
    const [t, a] = await Promise.all([
      supabase.from('tecnici').select(SEL_TECNICI).order('cognome'),
      supabase.from('assenze').select('*').gte('al', oggiISO()).order('dal'),
    ]);
    if (t.error) throw t.error; if (a.error) throw a.error;
    return { tecnici: t.data as Tecnico[], assenze: a.data as Assenza[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.tecnici.filter(t => mostraInattivi || t.attivo);
  const nome = (id: number) => { const t = data.tecnici.find(x => x.id === id); return t ? `${t.nome} ${t.cognome}` : '—'; };

  async function sblocca(t: Tecnico) {
    const { error } = await supabase.from('tecnici').update({ tentativi_falliti: 0, bloccato_fino: null }).eq('id', t.id);
    if (error) toast(testoErrore(error)); else { toast('Accesso sbloccato'); reload(); }
  }
  async function eliminaAssenza(id: number) {
    const { error } = await supabase.from('assenze').delete().eq('id', id);
    if (error) toast(testoErrore(error)); else reload();
  }

  return (
    <>
      <div className="section-title">Tecnici e conducenti <span className="meta">{lista.length}</span><span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={mostraInattivi} onChange={e => setMostraInattivi(e.target.checked)} /> Mostra non attivi</label>
        <button className="btn btn-sm" onClick={() => setModifica('nuovo')}>Nuovo tecnico</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Tecnico</th><th>Codice app</th><th>Ruolo</th><th>Patente</th><th>Accesso app</th><th></th></tr></thead>
        <tbody>{lista.length ? lista.map(t => {
          const g = giorniA(t.patente_scadenza);
          const bloccato = t.bloccato_fino && new Date(t.bloccato_fino) > new Date();
          return (
            <tr key={t.id} className={t.attivo ? '' : 'muted'}>
              <td><div style={{ fontWeight: 500 }}>{t.nome} {t.cognome}</div><div className="sub">{t.telefono ?? ''}{!t.attivo ? ' · non attivo' : ''}</div></td>
              <td className="mono">{t.codice}</td>
              <td>{t.ruolo ?? '—'}</td>
              <td>{t.patente_categoria ?? '—'} <div className="scad" style={{ marginTop: 3 }}>{g == null ? <Pill s="warn">Scadenza non registrata</Pill>
                : <><Pill s={g < 0 ? 'ko' : g <= 30 ? 'warn' : 'ok'}>{g < 0 ? 'Scaduta' : g <= 30 ? `Tra ${g} gg` : 'Valida'}</Pill><span className="mono sub">{fmtData(t.patente_scadenza)}</span></>}</div></td>
              <td>{bloccato ? <Pill s="ko">Bloccato</Pill> : t.ha_pin ? <Pill s="ok">PIN attivo</Pill> : <Pill s="warn">PIN da impostare</Pill>}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setModifica(t)}>Modifica</button>
                <button className="btn-ghost btn-sm" onClick={() => setPin(t)}>{t.ha_pin ? 'Nuovo PIN' : 'Imposta PIN'}</button>
                {bloccato && <button className="btn-ghost btn-sm" onClick={() => sblocca(t)}>Sblocca</button>}
              </td>
            </tr>
          );
        }) : <tr><td colSpan={6} className="sub">Nessun tecnico. Usa "Nuovo tecnico".</td></tr>}</tbody>
      </table></div>

      <div className="section-title">Assenze in corso e future <span className="meta">i tecnici assenti non ricevono veicoli nel piano</span></div>
      <NuovaAssenza tecnici={data.tecnici.filter(t => t.attivo)} onSalvato={reload} />
      <div className="table-wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Tecnico</th><th>Dal</th><th>Al</th><th>Motivo</th><th></th></tr></thead>
        <tbody>{data.assenze.length ? data.assenze.map(a => (
          <tr key={a.id}><td>{nome(a.tecnico_id)}</td><td className="mono">{fmtData(a.dal)}</td><td className="mono">{fmtData(a.al)}</td><td>{a.motivo}</td>
            <td><button className="btn-ghost btn-sm" onClick={() => eliminaAssenza(a.id)}>Elimina</button></td></tr>
        )) : <tr><td colSpan={5} className="sub">Nessuna assenza registrata</td></tr>}</tbody>
      </table></div>
      <p className="hint">Le assenze qui sono temporanee: in seguito arriveranno dal sistema HR, così non si inseriscono due volte.</p>

      {modifica && <FormTecnico t={modifica === 'nuovo' ? null : modifica} onClose={() => setModifica(null)} onSalvato={() => { setModifica(null); reload(); }} />}
      {pin && <ModalePin t={pin} onClose={() => setPin(null)} onSalvato={() => { setPin(null); reload(); }} />}
    </>
  );
}

function FormTecnico({ t, onClose, onSalvato }: { t: Tecnico | null; onClose: () => void; onSalvato: () => void }) {
  const [f, setF] = useState({
    codice: t?.codice ?? '', nome: t?.nome ?? '', cognome: t?.cognome ?? '', ruolo: t?.ruolo ?? '', telefono: t?.telefono ?? '',
    patente_categoria: t?.patente_categoria ?? 'B', patente_scadenza: t?.patente_scadenza ?? '', attivo: t?.attivo ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const rec = { codice: f.codice.toUpperCase().replace(/[^A-Z0-9]/g, ''), nome: f.nome.trim(), cognome: f.cognome.trim(), ruolo: f.ruolo.trim() || null,
      telefono: f.telefono.trim() || null, patente_categoria: f.patente_categoria.trim() || null, patente_scadenza: f.patente_scadenza || null, attivo: f.attivo };
    const { error } = t ? await supabase.from('tecnici').update(rec).eq('id', t.id) : await supabase.from('tecnici').insert(rec);
    if (error) { setErr(testoErrore(error)); return; }
    toast(t ? 'Tecnico aggiornato' : 'Tecnico aggiunto: ora imposta il PIN'); onSalvato();
  }
  return (
    <Modal titolo={t ? `Modifica ${t.nome} ${t.cognome}` : 'Nuovo tecnico'} onClose={onClose}>
      <form className="form grid2" onSubmit={salva}>
        <div className="field"><label htmlFor="t-nome">Nome</label><input id="t-nome" required value={f.nome} onChange={set('nome')} /></div>
        <div className="field"><label htmlFor="t-cog">Cognome</label><input id="t-cog" required value={f.cognome} onChange={set('cognome')} /></div>
        <div className="field"><label htmlFor="t-cod">Codice per l'app</label><input id="t-cod" required value={f.codice} onChange={set('codice')} placeholder="Es. ROSSIM" /></div>
        <div className="field"><label htmlFor="t-ruolo">Ruolo</label><input id="t-ruolo" value={f.ruolo} onChange={set('ruolo')} placeholder="Tecnico manutenzione" /></div>
        <div className="field"><label htmlFor="t-tel">Telefono</label><input id="t-tel" value={f.telefono} onChange={set('telefono')} /></div>
        <div className="field"><label htmlFor="t-cat">Categoria patente</label><input id="t-cat" value={f.patente_categoria} onChange={set('patente_categoria')} /></div>
        <div className="field"><label htmlFor="t-scad">Scadenza patente</label><input id="t-scad" type="date" value={f.patente_scadenza} onChange={set('patente_scadenza')} /></div>
        {t && <label className="chk"><input type="checkbox" checked={f.attivo} onChange={set('attivo')} /> Attivo</label>}
        <p className="hint span2">Il codice è quello che il tecnico digita nell'app insieme al PIN. Registra solo i dati necessari alla gestione dei veicoli.</p>
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn">Salva</button><button type="button" className="btn-ghost" onClick={onClose}>Annulla</button></div>
      </form>
    </Modal>
  );
}

function ModalePin({ t, onClose, onSalvato }: { t: Tecnico; onClose: () => void; onSalvato: () => void }) {
  const genera = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const [pin, setPin] = useState(genera);
  const [salvato, setSalvato] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function salva() {
    setErr(null);
    try { await rpc('imposta_pin', { p_tecnico: t.id, p_pin: pin }); setSalvato(true); }
    catch (e) { setErr(testoErrore(e)); }
  }
  return (
    <Modal titolo={`PIN per ${t.nome} ${t.cognome}`} onClose={salvato ? onSalvato : onClose}>
      <div className="form">
        {!salvato ? <>
          <div className="field"><label htmlFor="pin">PIN di 6 cifre</label>
            <input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="pin-input" /></div>
          <p className="hint">Impostando un nuovo PIN il tecnico viene disconnesso da tutti i telefoni.</p>
          {err && <Banner s="ko">{err}</Banner>}
          <div className="row-flex"><button className="btn" onClick={salva} disabled={pin.length !== 6}>Salva PIN</button><button className="btn-ghost" onClick={() => setPin(genera())}>Genera un altro</button></div>
        </> : <>
          <Banner s="ok">PIN salvato. Comunicalo al tecnico di persona: codice <b className="mono">{t.codice}</b>, PIN <b className="mono">{pin}</b>. Dopo la chiusura non sarà più visibile.</Banner>
          <button className="btn" onClick={onSalvato}>Fatto</button>
        </>}
      </div>
    </Modal>
  );
}

function NuovaAssenza({ tecnici, onSalvato }: { tecnici: Tecnico[]; onSalvato: () => void }) {
  const [f, setF] = useState({ tecnico_id: '', dal: oggiISO(), al: oggiISO(), motivo: 'Ferie' });
  const [err, setErr] = useState<string | null>(null);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('assenze').insert({ ...f, tecnico_id: Number(f.tecnico_id) });
    if (error) { setErr(error.message.includes('check') ? 'La data "al" non può essere prima della data "dal".' : testoErrore(error)); return; }
    toast('Assenza registrata'); onSalvato();
  }
  return (
    <form className="row-flex wrap-end" onSubmit={salva}>
      <div className="field"><label htmlFor="a-t">Tecnico</label><select id="a-t" required value={f.tecnico_id} onChange={e => setF({ ...f, tecnico_id: e.target.value })}>
        <option value="">Seleziona</option>{tecnici.map(t => <option key={t.id} value={t.id}>{t.nome} {t.cognome}</option>)}</select></div>
      <div className="field"><label htmlFor="a-dal">Dal</label><input id="a-dal" type="date" required value={f.dal} onChange={e => setF({ ...f, dal: e.target.value })} /></div>
      <div className="field"><label htmlFor="a-al">Al</label><input id="a-al" type="date" required value={f.al} onChange={e => setF({ ...f, al: e.target.value })} /></div>
      <div className="field"><label htmlFor="a-m">Motivo</label><select id="a-m" value={f.motivo} onChange={e => setF({ ...f, motivo: e.target.value })}>
        {['Ferie', 'Permesso', 'Assenza', 'Formazione', 'Altro'].map(m => <option key={m}>{m}</option>)}</select></div>
      <button className="btn">Aggiungi assenza</button>
      {err && <div className="msg ko">{err}</div>}
    </form>
  );
}
