import { useEffect, useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { nomeCanale } from '../lib/centralino/tipi';
import { Banner, Modal, toast } from '../ui';
import { PAROLA_ELIMINA, MOTIVO_PREDEFINITO, aBlocchi, confermaElimina, motivoElimina, rigaAnteprima, rpcMancante, type InfoDaEliminare } from './eliminaInfo';

const ROSSO = 'var(--ko, #c0392b)';

/** null = in verifica, false = migrazione 0103 non applicata. Chiamata a vuoto: non cancella nulla. */
export function useEliminaInfoAttiva(abilitato: boolean) {
  const [attiva, setAttiva] = useState<boolean | null>(null);
  useEffect(() => {
    if (!abilitato) return;
    void supabase.rpc('admin_elimina_chiamate_info', { p_ids: [], p_motivo: null }).then(r => setAttiva(!rpcMancante(r.error)));
  }, [abilitato]);
  return attiva;
}

export function ModaleEliminaInfo({ righe, onClose, onFatto }: { righe: InfoDaEliminare[]; onClose: () => void; onFatto: () => void }) {
  const [motivo, setMotivo] = useState(MOTIVO_PREDEFINITO);
  const [testo, setTesto] = useState('');
  const [lavoro, setLavoro] = useState(false);
  const [err, setErr] = useState('');
  async function esegui() {
    setLavoro(true); setErr('');
    try {
      let n = 0;
      for (const b of aBlocchi(righe.map(r => r.id))) {
        const r = await rpc<{ eliminate: number }>('admin_elimina_chiamate_info', { p_ids: b, p_motivo: motivoElimina(motivo) });
        n += r?.eliminate ?? 0;
      }
      toast(n === 1 ? '1 contatto eliminato' : `${n} contatti eliminati`);
      onFatto();
    } catch (e) { setErr(testoErrore(e)); setLavoro(false); }
  }
  return (
    <Modal titolo={righe.length === 1 ? 'Elimina contatto' : `Elimina ${righe.length} contatti`} onClose={() => !lavoro && onClose()} bloccaFuori={lavoro}>
      <p><b>{righe.length}</b> {righe.length === 1 ? 'contatto informativo' : 'contatti informativi'}:</p>
      <ul className="sub">{righe.slice(0, 5).map(r => <li key={r.id}>{rigaAnteprima(r, nomeCanale)}</li>)}{righe.length > 5 && <li>… (+{righe.length - 5})</li>}</ul>
      <p className="sub">Eliminazione definitiva. Resta nel registro.</p>
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

export const ROSSO_ELIMINA = ROSSO;
