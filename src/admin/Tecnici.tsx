import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase, rpc, testoErrore } from '../lib/supabase';
import { fmtData, giorniA, oggiISO, prossimoLavorativo } from '../lib/format';
import { useT } from '../lib/i18n';
import { SEL_TECNICI, type Tecnico } from '../lib/tipi';
import { Banner, Caricamento, Errore, Modal, Pill, toast, useLoad } from '../ui';

/** Riga di «Assenze in corso e future»: mai il tipo di assenza, mai il motivo. */
interface RigaAssenza { chiave: string; tecnico_id: number; dal: string; al: string; rientro: string | null; fascia: string | null; possibile: boolean }
interface RigaRichiesta { richiesta_id: number; dipendente_id: number; dal: string; al: string; tipo_riga: 'assenza' | 'possibile' | 'nota'; etichetta: string; ora_inizio: string | null; ora_fine: string | null }

const hhmm = (o: string | null) => (o ? o.slice(0, 5) : '');

/**
 * Tecnici e conducenti. Dal 20/10/2026 i dati dei dipendenti (anche dei tecnici) li crea e modifica
 * solo l'ufficio personale o l'amministratore: il responsabile flotta li vede in sola lettura e
 * gestisce solo PIN e scheda dell'app. Le assenze arrivano dall'ufficio personale (sola lettura).
 */
export default function Tecnici() {
  const { t, tm } = useT();
  const [modifica, setModifica] = useState<Tecnico | 'nuovo' | null>(null);
  const [pin, setPin] = useState<Tecnico | null>(null);
  const [scheda, setScheda] = useState<Tecnico | null>(null);
  const base = useLocation().pathname.startsWith('/admin') ? '/admin' : '';
  const [mostraInattivi, setMostraInattivi] = useState(false);
  const { data, errore, reload } = useLoad(async () => {
    const oggi = oggiISO();
    const [tc, a, rq, hr] = await Promise.all([
      supabase.from('tecnici').select(SEL_TECNICI).order('cognome'),
      supabase.from('assenze').select('id,tecnico_id,dal,al').gte('al', oggi).order('dal'),
      supabase.from('assenze_da_richieste').select('richiesta_id,dipendente_id,dal,al,tipo_riga,etichetta,ora_inizio,ora_fine')
        .eq('attiva', true).in('tipo_riga', ['possibile', 'nota']).gte('al', oggi).order('dal'),
      supabase.rpc('is_hr'),
    ]);
    if (tc.error) throw tc.error; if (a.error) throw a.error;
    const righe: RigaAssenza[] = [
      ...((a.data ?? []) as { id: number; tecnico_id: number; dal: string; al: string }[])
        .map(x => ({ chiave: `a${x.id}`, tecnico_id: x.tecnico_id, dal: x.dal, al: x.al, rientro: null, fascia: null, possibile: false })),
      ...((rq.data ?? []) as RigaRichiesta[]).map(x => ({
        chiave: `r${x.richiesta_id}`, tecnico_id: x.dipendente_id, dal: x.dal, al: x.al, rientro: null, possibile: x.tipo_riga === 'possibile',
        fascia: x.ora_inizio ? `${hhmm(x.ora_inizio)}–${hhmm(x.ora_fine)}` : x.tipo_riga === 'nota' ? (/mattin/i.test(x.etichetta) ? 'Mattina' : /pomerig/i.test(x.etichetta) ? 'Pomeriggio' : 'Mezza giornata') : null,
      })),
    ].sort((x, y) => x.dal.localeCompare(y.dal));
    // rientro = primo giorno lavorativo dopo l'ultimo giorno di assenza (festività comprese: lo calcola il server)
    const rientri: Record<string, string> = {};
    await Promise.all([...new Set(righe.filter(r => !r.fascia).map(r => r.al))].map(async al => {
      try { rientri[al] = await rpc<string>('prossimo_lavorativo', { p_da: al }); } catch { rientri[al] = prossimoLavorativo(al); }
    }));
    righe.forEach(r => { if (!r.fascia) r.rientro = rientri[r.al] ?? null; });
    return { tecnici: tc.data as Tecnico[], assenze: righe, modifica: !hr.error && hr.data === true };
  });
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.tecnici.filter(x => mostraInattivi || x.attivo);
  const nome = (id: number) => { const x = data.tecnici.find(y => y.id === id); return x ? `${x.nome} ${x.cognome}` : '—'; };
  const puoModificare = data.modifica;

  async function sblocca(x: Tecnico) {
    const { error } = await supabase.from('tecnici').update({ tentativi_falliti: 0, bloccato_fino: null }).eq('id', x.id);
    if (error) toast(tm(testoErrore(error))); else { toast(t('Accesso sbloccato')); reload(); }
  }

  return (
    <>
      <div className="section-title">{t('Tecnici e conducenti')} <span className="meta">{lista.length}</span><span className="spacer" />
        <label className="sub chk"><input type="checkbox" checked={mostraInattivi} onChange={e => setMostraInattivi(e.target.checked)} /> {t('Mostra non attivi')}</label>
        <Link className="btn-ghost btn-sm" to={`${base}/installa-tecnici`}>{t('Scheda app vuota')}</Link>
        {puoModificare && <button className="btn btn-sm" onClick={() => setModifica('nuovo')}>{t('Nuovo tecnico')}</button>}</div>
      {!puoModificare && <p className="hint sola-lettura">{t("I nuovi tecnici e le modifiche ai dati (patente, contatti, ruolo) li inserisce l'ufficio personale. Qui gestisci il PIN e la scheda dell'app.")}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Tecnico')}</th><th>{t('Codice app')}</th><th>{t('Ruolo')}</th><th>{t('Patente')}</th><th>{t('Accesso app')}</th><th></th></tr></thead>
        <tbody>{lista.length ? lista.map(x => {
          const g = giorniA(x.patente_scadenza);
          const bloccato = x.bloccato_fino && new Date(x.bloccato_fino) > new Date();
          return (
            <tr key={x.id} className={x.attivo ? '' : 'muted'}>
              <td><div style={{ fontWeight: 600 }}>{x.nome} {x.cognome}</div><div className="sub">{[x.telefono, x.email].filter(Boolean).join(' · ')}{!x.attivo ? ` · ${t('non attivo')}` : ''}</div></td>
              <td className="mono">{x.codice}</td>
              <td>{x.ruolo ?? '—'}</td>
              <td>{x.patente_categoria ?? '—'} <div className="scad" style={{ marginTop: 3 }}>{g == null ? <Pill s="warn">{t('Scadenza non registrata')}</Pill>
                : <><Pill s={g < 0 ? 'ko' : g <= 30 ? 'warn' : 'ok'}>{g < 0 ? t('Scaduta') : g <= 30 ? t('Tra {n} gg', { n: g }) : t('Valida')}</Pill><span className="mono sub">{fmtData(x.patente_scadenza)}</span></>}</div></td>
              <td>{bloccato ? <Pill s="ko">{t('Bloccato')}</Pill> : x.ha_pin ? <Pill s="ok">{t('PIN attivo')}</Pill> : <Pill s="warn">{t('PIN da impostare')}</Pill>}</td>
              <td className="nowrap actions">
                {puoModificare && <button className="btn-ghost btn-sm" onClick={() => setModifica(x)}>{t('Modifica')}</button>}
                {x.attivo && <button className="btn btn-sm" onClick={() => setScheda(x)}>{t('Scheda app + PIN')}</button>}
                <button className="btn-ghost btn-sm" onClick={() => setPin(x)}>{x.ha_pin ? t('Nuovo PIN') : t('Imposta PIN')}</button>
                {bloccato && puoModificare && <button className="btn-ghost btn-sm" onClick={() => sblocca(x)}>{t('Sblocca')}</button>}
                {g != null && g <= 30 && <Link className="btn-ghost btn-sm" to={`/avvisi?t=${x.id}&modello=patente&d=${fmtData(x.patente_scadenza)}`}>{t('Avvisa')}</Link>}
              </td>
            </tr>
          );
        }) : <tr><td colSpan={6} className="sub">{puoModificare ? t('Nessun tecnico. Usa "Nuovo tecnico".') : t("Nessun tecnico. I tecnici li inserisce l'ufficio personale.")}</td></tr>}</tbody>
      </table></div>

      <div className="section-title">{t('Assenze in corso e future')} <span className="meta">{t('i tecnici assenti non ricevono veicoli nel piano')}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Tecnico')}</th><th>{t('Primo giorno')}</th><th>{t('Rientro')}</th><th>{t('Assenza')}</th></tr></thead>
        <tbody>{data.assenze.length ? data.assenze.map(a => (
          <tr key={a.chiave}><td>{nome(a.tecnico_id)}</td><td className="mono">{fmtData(a.dal)}</td><td className="mono">{a.rientro ? fmtData(a.rientro) : '—'}</td>
            <td><span className="row-flex" style={{ gap: 6 }}>{a.fascia ? t(a.fascia) : t('Assente')}{a.possibile && <Pill s="warn">{t('Possibile')}</Pill>}</span></td></tr>
        )) : <tr><td colSpan={4} className="sub">{t('Nessuna assenza in corso o futura')}</td></tr>}</tbody>
      </table></div>
      <p className="hint">{t("Le assenze le gestisce l'ufficio personale. Per una correzione contatta l'ufficio personale.")} {t('«Possibile» = richiesta in attesa di risposta: non blocca il piano.')}</p>

      {modifica && puoModificare && <FormTecnico x={modifica === 'nuovo' ? null : modifica} onClose={() => setModifica(null)} onSalvato={() => { setModifica(null); reload(); }} />}
      {scheda && <ModaleScheda x={scheda} base={base} onClose={() => setScheda(null)} />}
      {pin && <ModalePin x={pin} onClose={() => setPin(null)} onSalvato={() => { setPin(null); reload(); }} />}
    </>
  );
}

function FormTecnico({ x, onClose, onSalvato }: { x: Tecnico | null; onClose: () => void; onSalvato: () => void }) {
  const { t, tm } = useT();
  const [f, setF] = useState({
    codice: x?.codice ?? '', nome: x?.nome ?? '', cognome: x?.cognome ?? '', ruolo: x?.ruolo ?? '', telefono: x?.telefono ?? '', email: x?.email ?? '',
    patente_categoria: x?.patente_categoria ?? 'B', patente_scadenza: x?.patente_scadenza ?? '', attivo: x?.attivo ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const rec = { codice: f.codice.toUpperCase().replace(/[^A-Z0-9]/g, ''), nome: f.nome.trim(), cognome: f.cognome.trim(), ruolo: f.ruolo.trim() || null,
      telefono: f.telefono.trim() || null, email: f.email.trim().toLowerCase() || null, patente_categoria: f.patente_categoria.trim() || null, patente_scadenza: f.patente_scadenza || null, attivo: f.attivo };
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
        <div className="field"><label htmlFor="t-mail">{t('Email (per inviare la scheda app)')}</label><input id="t-mail" type="email" dir="ltr" value={f.email} onChange={set('email')} /></div>
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

/** Genera un PIN nuovo (mai salvato in chiaro) e apre la scheda di installazione già compilata. */
function ModaleScheda({ x, base, onClose }: { x: Tecnico; base: string; onClose: () => void }) {
  const { t, tm } = useT();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  async function genera() {
    setErr(null); setInvio(true);
    try {
      const pin = await rpc<string>('genera_pin', { p_tecnico: x.id });
      nav(`${base}/installa-tecnici`, { state: { tecnico: { nome: x.nome, cognome: x.cognome, codice: x.codice, email: x.email }, pin } });
    } catch (e) { setErr(tm(testoErrore(e))); setInvio(false); }
  }
  return (
    <Modal titolo={t('Scheda app per {n}', { n: `${x.nome} ${x.cognome}` })} onClose={onClose}>
      <div className="form">
        <p>{t('Il sistema crea un PIN nuovo e prepara la scheda con codice e PIN, da stampare o inviare per email.')}</p>
        {x.ha_pin && <Banner s="warn">{t('Il PIN attuale smetterà di funzionare e il tecnico dovrà accedere di nuovo su tutti i telefoni.')}</Banner>}
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex"><button className="btn" onClick={genera} disabled={invio}>{invio ? t('Attendere…') : t('Genera PIN e apri la scheda')}</button>
          <button className="btn-ghost" onClick={onClose}>{t('Annulla')}</button></div>
      </div>
    </Modal>
  );
}

