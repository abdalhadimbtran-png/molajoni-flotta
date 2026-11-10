import { FormEvent, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { Banner, Caricamento, Errore, Modal, toast, useLoad } from '../ui';
import { NOME_TIPO, type Template } from '../lib/centralino/tipi';
import { SEGNAPOSTO, emailDaModello, segnaposto } from '../lib/centralino/modelli';
import { config as ricaricaConfig } from './comune';
import { useCtx } from './ShellCentralino';

const PROVA = segnaposto({ numero: 'CT-2026-000123', cliente_nome: 'Condominio Via Roma 10', contatto_nome: 'Sig. Rossi', appuntamento_data: '2026-11-10', appuntamento_fascia: 'mattina', commerciale_nome: 'Mario Bianchi', tecnico_nome: 'Luca Verdi' }, 'Jennifer Marchetti\nFront Office · Molajoni Antincendi');
const TIPI = { ...NOME_TIPO, trasferimento: 'Riepilogo telefonata' } as Record<string, string>;

/** Editor dei modelli email (centralino e amministratore). */
export default function Modelli() {
  const ctx = useCtx();
  const { data, errore, reload } = useLoad(async () => {
    const { data, error } = await supabase.from('email_template').select('*').order('ordine').order('nome');
    if (error) throw error; return (data ?? []) as Template[];
  });
  const [mod, setMod] = useState<Template | 'nuovo' | null>(null);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="page-hero"><div><h1>Modelli email</h1><p className="sub">Segnaposto: {SEGNAPOSTO.map(s => `{${s}}`).join(' ')}</p></div>
        {ctx.scrive && <button className="btn" onClick={() => setMod('nuovo')}>Nuovo modello</button>}</div>
      <div className="ct-modelli">
        {data.map(t => (
          <button key={t.id} className={`ct-modello ${t.attivo ? '' : 'spento'}`} onClick={() => setMod(t)}>
            <b>{t.nome}</b><span className="sub">{t.tipo_pratica ? TIPI[t.tipo_pratica] ?? t.tipo_pratica : 'Tutti i tipi'}{t.cc_offerte_grandi ? ' · CC offerte del Tecnico Commerciale' : ''}{t.attivo ? '' : ' · disattivato'}</span>
            <span className="ct-modello-ogg">{t.oggetto}</span>
          </button>))}
      </div>
      {mod && <Editor t={mod === 'nuovo' ? null : mod} scrive={ctx.scrive} onClose={() => setMod(null)} onSalvato={() => { setMod(null); reload(); ricaricaConfig(true); }} />}
    </>
  );
}

function Editor({ t, scrive, onClose, onSalvato }: { t: Template | null; scrive: boolean; onClose: () => void; onSalvato: () => void }) {
  const [f, setF] = useState({ codice: t?.codice ?? '', nome: t?.nome ?? '', oggetto: t?.oggetto ?? '', corpo_html: t?.corpo_html ?? '<p>{saluto},</p>\n<p></p>\n<p>Grazie per la preferenza e distinti saluti.</p>',
    tipo_pratica: t?.tipo_pratica ?? '', cc_default: (t?.cc_default ?? []).join(', '), cc_offerte_grandi: t?.cc_offerte_grandi ?? false, attivo: t?.attivo ?? true, ordine: t?.ordine ?? 100,
    titolo: t?.titolo ?? '', datiTesto: (t?.dati ?? []).map(([k, v]) => `${k} = ${v}`).join('\n'), firma_tipo: (t?.firma_tipo ?? 'front_office') as 'front_office' | 'tmq' | 'nessuna' });
  const [err, setErr] = useState<string | null>(null);
  const dati = f.datiTesto.split('\n').map(r => r.split(' = ')).filter(x => x.length === 2 && x[0].trim()).map(([k, v]) => [k.trim(), v.trim()] as [string, string]);
  async function salva(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const { datiTesto: _d, ...resto } = f; void _d;
    const riga = { ...resto, dati, titolo: f.titolo || null, tipo_pratica: f.tipo_pratica || null, cc_default: f.cc_default.split(/[,;\s]+/).filter(Boolean), codice: f.codice.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') };
    const r = t ? await supabase.from('email_template').update(riga).eq('id', t.id) : await supabase.from('email_template').insert(riga);
    if (r.error) { setErr(testoErrore(r.error)); return; }
    toast('Modello salvato'); onSalvato();
  }
  return (
    <Modal titolo={t ? t.nome : 'Nuovo modello'} onClose={onClose}>
      <form className="form" onSubmit={salva}>
        <fieldset disabled={!scrive} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <div className="ct-griglia">
            <div className="field"><label htmlFor="m-nome">Nome</label><input id="m-nome" value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} required /></div>
            <div className="field"><label htmlFor="m-cod">Codice</label><input id="m-cod" value={f.codice} onChange={e => setF({ ...f, codice: e.target.value })} required disabled={!!t} /></div>
            <div className="field"><label htmlFor="m-tipo">Per il tipo</label>
              <select id="m-tipo" value={f.tipo_pratica} onChange={e => setF({ ...f, tipo_pratica: e.target.value })}><option value="">Tutti</option>{Object.entries(TIPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div className="ct-griglia">
            <div className="field"><label htmlFor="m-tit">Titolo nell'email</label><input id="m-tit" value={f.titolo} onChange={e => setF({ ...f, titolo: e.target.value })} placeholder="es. Conferma appuntamento" /></div>
            <div className="field"><label htmlFor="m-firma">Firma</label><select id="m-firma" value={f.firma_tipo} onChange={e => setF({ ...f, firma_tipo: e.target.value as typeof f.firma_tipo })}><option value="front_office">Jennifer · Front office</option><option value="tmq">TMQ (tecnico scelto)</option><option value="nessuna">Nessuna</option></select></div>
          </div>
          <div className="field"><label htmlFor="m-dati">Dati in evidenza (una riga per voce: Etichetta = {'{segnaposto}'})</label>
            <textarea id="m-dati" rows={4} className="ct-mono" value={f.datiTesto} onChange={e => setF({ ...f, datiTesto: e.target.value })} /></div>
          <div className="field"><label htmlFor="m-ogg">Oggetto</label><input id="m-ogg" value={f.oggetto} onChange={e => setF({ ...f, oggetto: e.target.value })} required /></div>
          <div className="field"><label htmlFor="m-corpo">Testo (HTML semplice: &lt;p&gt;, &lt;b&gt;, &lt;br&gt;)</label><textarea id="m-corpo" rows={9} value={f.corpo_html} onChange={e => setF({ ...f, corpo_html: e.target.value })} className="ct-mono" /></div>
          <div className="field"><label htmlFor="m-cc">CC fissi</label><input id="m-cc" value={f.cc_default} onChange={e => setF({ ...f, cc_default: e.target.value })} placeholder="email separate da virgola" /></div>
          <label className="check"><input type="checkbox" checked={f.cc_offerte_grandi} onChange={e => setF({ ...f, cc_offerte_grandi: e.target.checked })} /> In copia commerciale + L. Esposito, A. Chiaradonna, A. Querini</label>
          <label className="check"><input type="checkbox" checked={f.attivo} onChange={e => setF({ ...f, attivo: e.target.checked })} /> Attivo</label>
        </fieldset>
        <div className="field"><label>Anteprima con dati di prova</label>
          <iframe title="Anteprima" className="ct-iframe" srcDoc={emailDaModello({ ...f, dati }, { ...PROVA, argomento: 'preventivo estintori', referente: 'Mario Bianchi', entro: 'entro le 15:30', scadenza: 'oggi entro le 15:30' }).html} /></div>
        {err && <Banner s="ko">{err}</Banner>}
        <div className="row-flex">{scrive && <button className="btn">Salva</button>}<button type="button" className="btn-ghost" onClick={onClose}>Chiudi</button></div>
      </form>
    </Modal>
  );
}
