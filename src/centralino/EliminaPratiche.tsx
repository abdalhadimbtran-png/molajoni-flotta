import { useEffect, useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { NOME_TIPO } from '../lib/centralino/tipi';
import { Banner, Modal, toast } from '../ui';
import { PAROLA_ELIMINA, aBlocchi, anteprimaNumeri, confermaElimina, motivoElimina, rpcMancante, MOTIVO_PREDEFINITO } from './eliminaPratiche';

export interface DaEliminare { id: number; numero: string; cliente_nome: string; tipo: string }
const ROSSO = 'var(--ko, #c0392b)';

/** null = in verifica, false = migrazione 0101 non applicata. Chiamata a vuoto: non cancella nulla. */
export function useEliminaAttiva(admin: boolean | undefined) {
  const [attiva, setAttiva] = useState<boolean | null>(null);
  useEffect(() => {
    if (!admin) return;
    void supabase.rpc('admin_elimina_pratiche', { p_ids: [], p_motivo: null }).then(r => setAttiva(!rpcMancante(r.error)));
  }, [admin]);
  return attiva;
}

/** Pulsante rosso (solo admin) — testo e stato secondo la disponibilità della funzione. */
export function BottoneElimina({ attiva, onClick, testo = 'Elimina richiesta' }: { attiva: boolean | null; onClick: () => void; testo?: string }) {
  if (attiva === false) return <button type="button" className="btn-ghost btn-sm" disabled title="Migrazione 0101 da applicare">Eliminazione non ancora attiva</button>;
  return <button type="button" className="btn-ghost btn-sm" style={{ color: ROSSO, borderColor: ROSSO }} disabled={attiva === null} onClick={onClick}>{testo}</button>;
}

/** Conferma + eliminazione definitiva (DB via RPC, poi file nel bucket «pratiche»). */
export function ModaleElimina({ pratiche, onClose, onFatto }: { pratiche: DaEliminare[]; onClose: () => void; onFatto: () => void }) {
  const [motivo, setMotivo] = useState(MOTIVO_PREDEFINITO);
  const [testo, setTesto] = useState('');
  const [lavoro, setLavoro] = useState(false);
  const [err, setErr] = useState('');
  const una = pratiche.length === 1 ? pratiche[0] : null;
  async function esegui() {
    setLavoro(true); setErr('');
    try {
      let n = 0; const paths: string[] = [];
      for (const b of aBlocchi(pratiche.map(p => p.id))) {
        const r = await rpc<{ eliminate: number; paths: string[] }>('admin_elimina_pratiche', { p_ids: b, p_motivo: motivoElimina(motivo) });
        n += r?.eliminate ?? 0; paths.push(...(r?.paths ?? []));
      }
      for (const b of aBlocchi(paths, 100)) { const { error } = await supabase.storage.from('pratiche').remove(b); if (error) toast(`File non rimossi: ${error.message}`); }
      toast(una ? `${una.numero} eliminata` : `${n} pratiche eliminate`);
      onFatto();
    } catch (e) { setErr(testoErrore(e)); setLavoro(false); }
  }
  return (
    <Modal titolo={una ? 'Elimina richiesta' : `Elimina ${pratiche.length} richieste`} onClose={() => !lavoro && onClose()} bloccaFuori={lavoro}>
      {una
        ? <p><b>{una.numero}</b> · {una.cliente_nome} · {(NOME_TIPO as Record<string, string>)[una.tipo] ?? una.tipo}</p>
        : <p><b>{pratiche.length}</b> richieste: {anteprimaNumeri(pratiche.map(p => p.numero))}</p>}
      <p className="sub">Eliminazione definitiva: storia, allegati, appunti, trasferimenti. Resta nel registro.</p>
      <label>Motivo <input value={motivo} onChange={e => setMotivo(e.target.value)} aria-label="Motivo" /></label>
      <label style={{ display: 'block', marginTop: 8 }}>Scrivi <b>{PAROLA_ELIMINA}</b> <input value={testo} onChange={e => setTesto(e.target.value)} autoFocus aria-label="Conferma" /></label>
      {err && <Banner s="ko">{err}</Banner>}
      <div className="row-flex" style={{ marginTop: 12 }}>
        <button className="btn btn-sm" style={{ background: ROSSO }} disabled={!confermaElimina(testo) || lavoro} onClick={esegui}>{lavoro ? 'Eliminazione…' : 'Elimina'}</button>
        <button className="btn-ghost btn-sm" disabled={lavoro} onClick={onClose}>Annulla</button>
      </div>
    </Modal>
  );
}
