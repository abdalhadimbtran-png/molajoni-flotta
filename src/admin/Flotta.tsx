import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { STATI_VEICOLO, fmtData, fmtKm, giorniA, normTarga } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_TECNICI, SEL_VEICOLI, type Tecnico, type Veicolo } from '../lib/tipi';
import { Banner, Caricamento, Errore, Modal, Pill, Targa, toast, useLoad, MenuAzioni } from '../ui';
import DettaglioVeicolo from './DettaglioVeicolo';

export const urlQr = (token: string) => `${window.location.origin}/t/v/${token}`;

function Scad({ d, bloccante }: { d: string | null; bloccante: boolean }) {
  const { t } = useT();
  const g = giorniA(d);
  if (g == null) return <Pill s="na">{t('Non registrata')}</Pill>;
  const s = g < 0 ? (bloccante ? 'ko' : 'warn') : g <= 30 ? 'warn' : 'ok';
  return <div className="scad"><Pill s={s}>{g < 0 ? t('Scaduta') : g <= 30 ? t('Tra {n} gg', { n: g }) : t('Valida')}</Pill><span className="mono sub">{fmtData(d)}</span></div>;
}

export default function Flotta() {
  const { t, tm } = useT();
  const [mostraDismessi, setMostraDismessi] = useState(false);
  const [modifica, setModifica] = useState<Veicolo | 'nuovo' | null>(null);
  const [qr, setQr] = useState<Veicolo | null>(null);
  const [mov, setMov] = useState<Veicolo | null>(null);
  const [det, setDet] = useState<Veicolo | null>(null);
  const { data, errore, reload } = useLoad(async () => {
    const [v, tc] = await Promise.all([
      supabase.from('v_veicoli').select(SEL_VEICOLI).order('targa'),
      supabase.from('tecnici').select(SEL_TECNICI).eq('attivo', true).order('cognome'),
    ]);
    if (v.error) throw v.error; if (tc.error) throw tc.error;
    return { veicoli: v.data as unknown as Veicolo[], tecnici: tc.data as Tecnico[] };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.veicoli.filter(v => mostraDismessi || !v.dismesso);

  return (
    <>
      <div className="section-title">{t('Veicoli')} <span className="meta">{t('{n} mezzi · avviso a 30 giorni o 1.500 km', { n: lista.length })}</span>
        <span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={mostraDismessi} onChange={e => setMostraDismessi(e.target.checked)} /> {t('Mostra dismessi')}</label>
        <Link className="btn-ghost btn-sm" to="/stampa-qr">{t('Stampa etichette QR')}</Link>
        <button className="btn btn-sm" onClick={() => setModifica('nuovo')}>{t('Nuovo veicolo')}</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Veicolo')}</th><th>{t('Stato')}</th><th>{t('Km')}</th><th>{t('Assicurazione')}</th><th>{t('Revisione')}</th><th>{t('Bollo')}</th><th>{t('Tagliando')}</th><th>{t('Avvisi')}</th><th></th></tr></thead>
        <tbody>{lista.length ? lista.map(v => {
          const [s, l] = STATI_VEICOLO[v.stato] ?? ['na', v.stato];
          const manc = v.km_prossimo_tagliando == null ? null : v.km_prossimo_tagliando - v.km_attuali;
          return (
            <tr key={v.id}>
              <td><Targa t={v.targa} /><div className="sub" style={{ marginTop: 3 }}>{v.marca_modello}</div></td>
              <td><Pill s={s}>{t(l)}</Pill><div className="sub" style={{ marginTop: 3 }}>{v.in_carico_nome ?? t('In sede')}</div></td>
              <td className="mono">{fmtKm(v.km_attuali)}</td>
              <td><Scad d={v.scad_assicurazione} bloccante /></td>
              <td><Scad d={v.scad_revisione} bloccante /></td>
              <td>{v.scad_bollo ? <Scad d={v.scad_bollo} bloccante={false} /> : <Pill s="na">—</Pill>}</td>
              <td>{manc == null ? <Pill s="na">{t('Non impostato')}</Pill> : <Pill s={manc <= 1500 ? 'warn' : 'ok'}>{manc < 0 ? t('Superato di {n} km', { n: fmtKm(-manc) }) : t('Tra {n} km', { n: fmtKm(manc) })}</Pill>}{v.tagliando_previsto && manc != null && manc > 0 && <div className="sub" style={{ marginTop: 3 }}>{t('previsto ~{d}', { d: fmtData(v.tagliando_previsto) })}</div>}</td>
              <td className="wrap-cell">{v.controlli.filter(c => c.l === 'ko').map((c, i) => <div key={i} className="msg ko">{tm(c.m)}</div>)}</td>
              <td className="nowrap actions">
                <button className="btn-ghost btn-sm" onClick={() => setModifica(v)}>{t('Modifica')}</button>
                <MenuAzioni label={t('Altro')}>
                  <button onClick={() => setMov(v)}>{t('Registra movimento')}</button>
                  <button onClick={() => setDet(v)}>{t('Dotazioni e documenti')}</button>
                  <button onClick={() => setQr(v)}>{t('Codice QR')}</button>
                </MenuAzioni>
              </td>
            </tr>
          );
        }) : <tr><td colSpan={9} className="sub">{t('Nessun veicolo. Usa "Nuovo veicolo" per iniziare il censimento.')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t('Assicurazione o revisione scadute, veicolo in officina o segnalazione "veicolo fermo" rendono il mezzo non assegnabile. I km e il veicolo in carico cambiano solo con i movimenti, così il registro resta completo.')}</p>

      {modifica && <FormVeicolo v={modifica === 'nuovo' ? null : modifica} onClose={() => setModifica(null)} onSalvato={() => { setModifica(null); reload(); }} />}
      {det && <DettaglioVeicolo v={det} onClose={() => { setDet(null); reload(); }} />}
      {qr && <ModaleQr v={qr} onClose={() => setQr(null)} onRigenerato={() => { setQr(null); reload(); }} />}
      {mov && <ModaleMovimento v={mov} tecnici={data.tecnici} onClose={() => setMov(null)} onSalvato={() => { setMov(null); reload(); }} />}
    </>
  );
}

function FormVeicolo({ v, onClose, onSalvato }: { v: Veicolo | null; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({
    targa: v?.targa ?? '', marca_modello: v?.marca_modello ?? '', tipo: v?.tipo ?? '', proprieta: v?.proprieta ?? '',
    km_attuali: v ? String(v.km_attuali) : '', km_prossimo_tagliando: v?.km_prossimo_tagliando != null ? String(v.km_prossimo_tagliando) : '',
    scad_assicurazione: v?.scad_assicurazione ?? '', scad_revisione: v?.scad_revisione ?? '', scad_bollo: v?.scad_bollo ?? '',
    in_officina: v?.in_officina ?? false, dismesso: v?.dismesso ?? false, note: v?.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const base = {
      targa: normTarga(f.targa), marca_modello: f.marca_modello.trim(), tipo: f.tipo.trim() || null, proprieta: f.proprieta || null,
      km_prossimo_tagliando: f.km_prossimo_tagliando ? Number(f.km_prossimo_tagliando) : null,
      scad_assicurazione: f.scad_assicurazione || null, scad_revisione: f.scad_revisione || null, scad_bollo: f.scad_bollo || null,
      in_officina: f.in_officina, note: f.note.trim() || null,
    };
    const { error } = v
      ? await supabase.from('veicoli').update({ ...base, dismesso: f.dismesso }).eq('id', v.id)
      : await supabase.from('veicoli').insert({ ...base, km_attuali: Number(f.km_attuali || 0) });
    if (error) { setErr(tm(testoErrore(error))); return; }
    toast(v ? t('Veicolo aggiornato') : t('Veicolo aggiunto')); onSalvato();
  }
  return (
    <Modal titolo={v ? t('Modifica {t}', { t: v.targa }) : t('Nuovo veicolo')} onClose={onClose}>
      <form className="form grid2" onSubmit={salva}>
        <div className="field"><label htmlFor="f-targa">{t('Targa')}</label><input id="f-targa" dir="ltr" required value={f.targa} onChange={set('targa')} placeholder="AB 123 CD" /></div>
        <div className="field"><label htmlFor="f-mm">{t('Marca e modello')}</label><input id="f-mm" required value={f.marca_modello} onChange={set('marca_modello')} placeholder="Fiat Doblò Cargo" /></div>
        <div className="field"><label htmlFor="f-tipo">{t('Tipo')}</label><input id="f-tipo" value={f.tipo} onChange={set('tipo')} /></div>
        <div className="field"><label htmlFor="f-prop">{t('Proprietà')}</label><select id="f-prop" value={f.proprieta} onChange={set('proprieta')}>
          <option value="">—</option><option value="proprieta">{t('Di proprietà')}</option><option value="noleggio">{t('Noleggio lungo termine')}</option><option value="leasing">{t('Leasing')}</option></select></div>
        {!v && <div className="field"><label htmlFor="f-km">{t('Km attuali (dal cruscotto)')}</label><input id="f-km" type="number" min={0} required value={f.km_attuali} onChange={set('km_attuali')} /></div>}
        <div className="field"><label htmlFor="f-kt">{t('Km prossimo tagliando')}</label><input id="f-kt" type="number" min={0} value={f.km_prossimo_tagliando} onChange={set('km_prossimo_tagliando')} /></div>
        <div className="field"><label htmlFor="f-ass">{t('Scadenza assicurazione')}</label><input id="f-ass" type="date" value={f.scad_assicurazione} onChange={set('scad_assicurazione')} /></div>
        <div className="field"><label htmlFor="f-rev">{t('Scadenza revisione')}</label><input id="f-rev" type="date" value={f.scad_revisione} onChange={set('scad_revisione')} /></div>
        <div className="field"><label htmlFor="f-bol">{t('Scadenza bollo')}</label><input id="f-bol" type="date" value={f.scad_bollo} onChange={set('scad_bollo')} /></div>
        <div className="field span2"><label htmlFor="f-note">{t('Note')}</label><input id="f-note" value={f.note} onChange={set('note')} /></div>
        <label className="chk span2"><input type="checkbox" checked={f.in_officina} onChange={set('in_officina')} /> {t('In officina (non assegnabile)')}</label>
        {v && <label className="chk span2"><input type="checkbox" checked={f.dismesso} onChange={set('dismesso')} /> {t('Dismesso (non più in flotta, lo storico resta)')}</label>}
        {v && <p className="hint span2">{t('Per correggere i km usa "Movimento → Rettifica", così la correzione resta nel registro.')}</p>}
        {err && <div className="span2"><Banner s="ko">{err}</Banner></div>}
        <div className="row-flex span2"><button className="btn">{t('Salva')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}

function ModaleQr({ v, onClose, onRigenerato }: { v: Veicolo; onClose: () => void; onRigenerato: () => void }) {
  const { t, tm } = useT();
  const [img, setImg] = useState('');
  const [conferma, setConferma] = useState(false);
  useEffect(() => { QRCode.toDataURL(urlQr(v.qr_token), { width: 360, margin: 1 }).then(setImg); }, [v.qr_token]);
  async function rigenera() {
    try { await rpc('rigenera_qr', { p_veicolo: v.id }); toast(t("Nuovo QR creato: stampa e sostituisci l'etichetta.")); onRigenerato(); }
    catch (e) { toast(tm(testoErrore(e))); }
  }
  return (
    <Modal titolo={t('QR {t}', { t: v.targa })} onClose={onClose}>
      <div className="qr-wrap">
        {img && <img src={img} alt={t('QR del veicolo {t}', { t: v.targa })} className="qr-img" />}
        <div className="sub mono" dir="ltr" style={{ wordBreak: 'break-all' }}>{urlQr(v.qr_token)}</div>
        <p className="hint">{t("Applica l'etichetta sul cruscotto o sul montante della portiera. Il tecnico la scansiona con la fotocamera del telefono.")}</p>
        <div className="row-flex">
          <Link className="btn" to={`/stampa-qr?v=${v.id}`}>{t('Stampa etichetta')}</Link>
          {!conferma ? <button className="btn-ghost" onClick={() => setConferma(true)}>{t('Rigenera QR')}</button>
            : <><span className="msg warn">{t('La vecchia etichetta smetterà di funzionare.')}</span><button className="btn-ghost" onClick={rigenera}>{t('Conferma')}</button></>}
        </div>
      </div>
    </Modal>
  );
}

function ModaleMovimento({ v, tecnici, onClose, onSalvato }: { v: Veicolo; tecnici: Tecnico[]; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [tipo, setTipo] = useState<'presa' | 'riconsegna' | 'rettifica'>(v.tecnico_in_carico ? 'riconsegna' : 'presa');
  const [tec, setTec] = useState(''); const [km, setKm] = useState(''); const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await rpc('movimento_responsabile', { p_veicolo: v.id, p_tipo: tipo, p_km: Number(km), p_tecnico: tipo === 'presa' ? Number(tec) || null : null, p_note: note || null });
      toast(t('Movimento registrato')); onSalvato();
    } catch (x) { setErr(tm(testoErrore(x))); }
  }
  return (
    <Modal titolo={t('Movimento {t}', { t: v.targa })} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <p className="sub">{t('Ultima lettura')}: <span className="mono">{fmtKm(v.km_attuali)} km</span> · {v.in_carico_nome ? t('in carico a {n}', { n: v.in_carico_nome }) : t('in sede')}</p>
        <div className="field"><label htmlFor="m-tipo">{t('Operazione')}</label><select id="m-tipo" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}>
          <option value="presa">{t('Presa in carico per un tecnico')}</option><option value="riconsegna">{t('Riconsegna in sede')}</option><option value="rettifica">{t('Rettifica km (correzione)')}</option></select></div>
        {tipo === 'presa' && <div className="field"><label htmlFor="m-tec">{t('Tecnico')}</label><select id="m-tec" required value={tec} onChange={e => setTec(e.target.value)}>
          <option value="">{t('Seleziona')}</option>{tecnici.map(x => <option key={x.id} value={x.id}>{x.nome} {x.cognome}</option>)}</select></div>}
        <div className="field"><label htmlFor="m-km">{t('Km sul cruscotto')}</label><input id="m-km" type="number" min={0} required value={km} onChange={e => setKm(e.target.value)} /></div>
        <div className="field"><label htmlFor="m-note">{tipo === 'rettifica' ? t('Motivo della rettifica (obbligatorio)') : t('Note')}</label><input id="m-note" required={tipo === 'rettifica'} value={note} onChange={e => setNote(e.target.value)} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn">{t('Registra')}</button><button type="button" className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </form>
    </Modal>
  );
}
