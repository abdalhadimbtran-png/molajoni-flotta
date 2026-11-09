import { useEffect, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { toast } from '../ui';

/** Interruttore «Riepilogo via email alle 18:00» (lun–ven), coda email esistente. L'unica scrittura della direzione: la propria preferenza, via RPC. */
export default function Digest() {
  const [s, setS] = useState<{ attivo: boolean; email: string | null; ultimo: string | null } | null | 'non_attivo'>(null);
  useEffect(() => {
    supabase.rpc('direzione_digest_stato').then(({ data, error }) => setS(error ? 'non_attivo' : (data as { attivo: boolean; email: string | null; ultimo: string | null })));
  }, []);
  if (s === null) return null;
  if (s === 'non_attivo') return <span className="dz-digest off" title="La funzione del database (direzione_digest) non è ancora stata attivata.">Email delle 18:00: in attesa di attivazione</span>;
  async function cambia() {
    if (s === null || s === 'non_attivo') return;
    const n = !s.attivo;
    const { error } = await supabase.rpc('direzione_digest_imposta', { p_attivo: n });
    if (error) { toast(testoErrore(error)); return; }
    setS({ ...s, attivo: n }); toast(n ? `Riepilogo alle 18:00 a ${s.email ?? 'te'}` : 'Riepilogo disattivato');
  }
  return (
    <label className="dz-digest" title="Lun–ven alle 18:00. Finché Resend è in modalità di prova, l'email arriva solo all'indirizzo del titolare dell'account Resend.">
      <input type="checkbox" role="switch" checked={s.attivo} onChange={cambia} /> Riepilogo via email alle 18:00
    </label>
  );
}
