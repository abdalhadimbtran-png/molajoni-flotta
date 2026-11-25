import { useEffect, useRef, useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { Banner, Modal, toast } from '../ui';
import { useConfig } from './comune';
import { Ic, iconaCanale } from './componenti';
import { indiceSuccessivo, staScrivendo, tabRoving, tastiRadio, tastoSalva } from './tastiera';
import { CANALI_REG, TIPI_REG, mancaReg, nuovaReg, oraRoma, payloadReg, tastoReg, vuotoReg, type StatoReg } from '../lib/centralino/registra';
import type { StatoCliente } from '../lib/centralino/tipi';

interface Cliente { codice: string | null; nome: string; fonte: string; sedi?: number; stato_cliente?: StatoCliente | null; contatto?: string | null; telefono?: string | null; comune?: string | null }

const CHIAVE = (uid: string) => `ct-bozza-registra:${uid}`;
function leggi(uid: string): StatoReg | null { try { const t = localStorage.getItem(CHIAVE(uid)); return t ? JSON.parse(t) as StatoReg : null; } catch { return null; } }
function scrivi(uid: string, v: StatoReg | null) { try { if (v) localStorage.setItem(CHIAVE(uid), JSON.stringify(v)); else localStorage.removeItem(CHIAVE(uid)); } catch { /* storage non disponibile */ } }

/** «Registra chiamata»: chiamate di prima, non inserite in diretta. Una finestra, tutto da tastiera. Salva una pratica già chiusa. */
export default function RegistraChiamata({ onClose, onFatto }: { onClose: () => void; onFatto: () => void }) {
  const { config } = useConfig();
  const [s, setS] = useState<StatoReg>(() => vuotoReg(oraRoma(new Date())));
  const [uid, setUid] = useState<string | null>(null);
  const [pronta, setPronta] = useState(false);
  const [ripristinata, setRipristinata] = useState(false);
  const [sugg, setSugg] = useState<Cliente[]>([]);
  const [sel, setSel] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const [n, setN] = useState(0);
  const [conf, setConf] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const cliRef = useRef<HTMLInputElement>(null);
  const referenti = config?.impostazioni.destinatari_trasferimento ?? [];
  const up = (x: Partial<StatoReg>) => setS(v => ({ ...v, ...x }));

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? 'anon'), () => setUid('anon')); }, []);
  useEffect(() => { if (!uid) return; const b = leggi(uid); if (b) { setS(b); setRipristinata(true); } setPronta(true); }, [uid]);
  const piena = !!(s.cosa.trim() || s.nome.trim() || s.telefono.trim() || s.cliente);
  useEffect(() => { if (uid && pronta) scrivi(uid, piena ? s : null); }, [uid, pronta, piena, s]);
  useEffect(() => { const k = window.setTimeout(() => cliRef.current?.focus(), 30); return () => window.clearTimeout(k); }, []);

  // ricerca clienti: stessa del Nuovo contatto
  useEffect(() => {
    if (s.cliente || s.nome.trim().length < 2) { setSugg([]); return; }
    const k = window.setTimeout(() => rpc<Cliente[]>('centralino_clienti', { p_q: s.nome }).then(setSugg, () => setSugg([])), 200);
    return () => window.clearTimeout(k);
  }, [s.nome, s.cliente]);
  function scegli(c: Cliente) { up({ cliente: { codice: c.codice, nome: c.nome }, nome: c.nome, telefono: s.telefono || c.telefono || '' }); setSugg([]); setSel(-1); }

  async function registra(nuova: boolean) {
    setErr(null);
    const m = mancaReg(s);
    if (m.length) { setErr(`Manca: ${m.join(', ')}.`); return; }
    setInvio(true);
    try {
      const r = await rpc<{ numero: string }>('centralino_registra_chiamata', { p: payloadReg(s) });
      toast(`Registrata ${r.numero}`);
      setN(x => x + 1);
      if (nuova) { const v = nuovaReg(s, oraRoma(new Date())); setS(v); if (uid) scrivi(uid, null); setRipristinata(false); setConf(false); window.setTimeout(() => cliRef.current?.focus(), 0); }
      else { if (uid) scrivi(uid, null); onFatto(); }
    } catch (x) { setErr(testoErrore(x)); } finally { setInvio(false); }
  }
  function annulla() {
    if (piena && !conf) { setConf(true); return; }
    if (uid) scrivi(uid, null);
    if (n) onFatto(); else onClose();
  }

  // tastiera: Ctrl+Invio registra, Ctrl+Maiusc+Invio registra e nuova; fuori dai campi 1–4 canale, G/P esito; Esc esce dal campo
  const tasti = useRef<(e: KeyboardEvent) => void>(() => undefined);
  tasti.current = (e: KeyboardEvent) => {
    const form = formRef.current; if (!form) return;
    const card = form.closest('.modal'); const mod = document.querySelectorAll('.modal'); if (mod[mod.length - 1] !== card) return;
    const t = e.target as HTMLElement | null;
    const k = tastoSalva(e);
    if (k) { e.preventDefault(); if (!invio) registra(k === 'seguire'); return; }
    if (e.key === 'Escape') { if (t && t !== document.body && form.contains(t)) { e.preventDefault(); t.blur(); form.focus({ preventScroll: true }); } return; }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || staScrivendo(t)) return;
    if (/^[1-9]$/.test(e.key) && t?.closest('[role=radiogroup]')) return;
    const m = tastoReg(e.key); if (!m) return;
    e.preventDefault();
    if ('canale' in m) up({ canale: m.canale });
    else { up({ esito: m.esito }); if (m.esito === 'passata') window.setTimeout(() => form.querySelector<HTMLSelectElement>('#rg-pass')?.focus(), 0); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => tasti.current(e); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []);

  return (
    <Modal titolo="Registra chiamata" onClose={annulla} bloccaFuori>
      <form className="ct-nuovo ct-registra" ref={formRef} tabIndex={-1} onSubmit={e => { e.preventDefault(); registra(false); }}>
        {ripristinata && <p className="ct-bozza">Bozza ripristinata · <button type="button" className="ct-link" onClick={() => { setS(vuotoReg(oraRoma(new Date()))); setRipristinata(false); }}>Svuota</button></p>}
        <div className="ct-reg-riga">
          <div className="field"><label id="rg-g">Quando</label>
            <div className="ct-reg-quando">
              <div className="segmented" role="radiogroup" aria-labelledby="rg-g" onKeyDown={tastiRadio}>
                {(['oggi', 'ieri'] as const).map((g, i) => <button type="button" key={g} role="radio" aria-checked={s.giorno === g} tabIndex={tabRoving(s.giorno === g, i, true)} className={s.giorno === g ? 'on' : ''} onClick={() => up({ giorno: g })}>{g === 'oggi' ? 'Oggi' : 'Ieri'}</button>)}
              </div>
              <input aria-label="Ora" className="ct-reg-ora" inputMode="numeric" placeholder="HH:MM" value={s.ora} onChange={e => up({ ora: e.target.value })} />
            </div></div>
          <div className="field"><label id="rg-c">Canale</label>
            <div className="ct-canali" role="radiogroup" aria-labelledby="rg-c" onKeyDown={tastiRadio}>
              {CANALI_REG.map((c, i) => <button type="button" key={c.v} role="radio" aria-checked={s.canale === c.v} tabIndex={tabRoving(s.canale === c.v, i, true)} className={s.canale === c.v ? 'on' : ''} onClick={() => up({ canale: c.v })} title={c.l}>
                <Ic n={iconaCanale(c.v)} size={18} /><span className="ct-canale-l">{c.l}</span><span className="k-n" aria-hidden>{i + 1}</span></button>)}
            </div></div>
        </div>

        <div className="ct-griglia">
          <div className="field ct-ac"><label htmlFor="rg-cli">Chi</label>
            <input id="rg-cli" ref={cliRef} autoComplete="off" value={s.nome} placeholder="Cliente, codice o nome"
              role="combobox" aria-expanded={sugg.length > 0} aria-controls="rg-pop" aria-autocomplete="list" aria-activedescendant={sel >= 0 ? `rg-o${sel}` : undefined}
              onChange={e => { up({ nome: e.target.value, cliente: null }); setSel(-1); }}
              onKeyDown={e => {
                if (!sugg.length) return;
                const m = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? indiceSuccessivo(sel, sugg.length, e.key) : null;
                if (m !== null) { e.preventDefault(); setSel(m); return; }
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && sel >= 0) { e.preventDefault(); scegli(sugg[sel]); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSugg([]); setSel(-1); }
              }} />
            {s.cliente && <span className="ct-ac-tag">{s.cliente.codice ? `Cliente ${s.cliente.codice} · attivo` : 'Già contattato'}</span>}
            {sugg.length > 0 && <div className="ct-ac-pop" id="rg-pop" role="listbox">
              {sugg.map((c, i) => <button type="button" key={i} id={`rg-o${i}`} role="option" aria-selected={i === sel} tabIndex={-1} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => scegli(c)}>
                <b>{c.nome}</b><span className="sub">{c.fonte === 'taylor' ? `Cod. ${c.codice}` : [c.contatto, c.telefono, c.comune].filter(Boolean).join(' · ') || 'già contattato'}</span></button>)}
            </div>}
          </div>
          <div className="field"><label htmlFor="rg-tel">Telefono</label><input id="rg-tel" type="tel" value={s.telefono} onChange={e => up({ telefono: e.target.value })} /></div>
        </div>

        <div className="field"><label htmlFor="rg-cosa">Cosa voleva</label>
          <input id="rg-cosa" value={s.cosa} onChange={e => up({ cosa: e.target.value })} placeholder="In breve" /></div>
        <div className="segmented ct-chips" role="radiogroup" aria-label="Tipo" onKeyDown={tastiRadio}>
          {TIPI_REG.map((t, i) => <button type="button" key={t.v} role="radio" aria-checked={s.tipo === t.v} tabIndex={tabRoving(s.tipo === t.v, i, true)} className={s.tipo === t.v ? 'on' : ''} onClick={() => up({ tipo: t.v })}>{t.l}</button>)}
        </div>

        <div className="ct-reg-riga">
          <div className="field"><label id="rg-e">Esito</label>
            <div className="segmented" role="radiogroup" aria-labelledby="rg-e" onKeyDown={tastiRadio}>
              {([['gestita', 'Gestita da me', 'G'], ['passata', 'Passata a…', 'P']] as const).map(([v, l, k], i) => (
                <button type="button" key={v} role="radio" aria-checked={s.esito === v} tabIndex={tabRoving(s.esito === v, i, !!s.esito)} className={s.esito === v ? 'on' : ''} onClick={() => up({ esito: v })}>
                  <span className="k-n" aria-hidden>{k}</span>{l}</button>))}
            </div></div>
          {s.esito === 'passata' && <div className="field"><label htmlFor="rg-pass">A chi</label>
            <select id="rg-pass" value={s.passata} onChange={e => up({ passata: e.target.value })}>
              <option value="">— scegli —</option>
              {referenti.map(d => <option key={d.nome} value={d.nome}>{d.nome}{d.ruolo ? ` · ${d.ruolo}` : ''}</option>)}
            </select></div>}
        </div>

        {err && <Banner s="ko">{err}</Banner>}
        <div className="ct-salva">
          <div className="sub">{n > 0 ? `${n} registrate` : 'Salvata già chiusa · nessuna email'}</div>
          <div className="row-flex">
            {conf && <span className="ct-conf">Scartare i dati? <button type="button" className="ct-link" onClick={annulla}>Scarta</button> · <button type="button" className="ct-link" onClick={() => setConf(false)}>No</button></span>}
            <button type="button" className="btn-ghost" onClick={annulla}>Annulla</button>
            <button type="button" className="btn-ghost" disabled={invio} onClick={() => registra(true)} title="Ctrl+Maiusc+Invio">Registra e nuova</button>
            <button className="btn" disabled={invio} title="Ctrl+Invio">{invio ? 'Salvo…' : 'Registra'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
