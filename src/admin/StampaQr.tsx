import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { Caricamento, Errore, useLoad } from '../ui';
import { urlQr } from './Flotta';

interface V { id: number; targa: string; marca_modello: string; qr_token: string }

export default function StampaQr() {
  const [sp] = useSearchParams();
  const solo = sp.get('v');
  const { data, errore } = useLoad(async () => {
    let q = supabase.from('veicoli').select('id,targa,marca_modello,qr_token').eq('dismesso', false).order('targa');
    if (solo) q = q.eq('id', Number(solo));
    const { data, error } = await q;
    if (error) throw error;
    return data as V[];
  }, [solo]);
  const [img, setImg] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!data) return;
    Promise.all(data.map(async v => [v.id, await QRCode.toDataURL(urlQr(v.qr_token), { width: 400, margin: 1, errorCorrectionLevel: 'M' })] as const))
      .then(r => setImg(Object.fromEntries(r)));
  }, [data]);
  if (errore) return <Errore testo={errore} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="row-flex no-print" style={{ marginBottom: 16 }}>
        <Link className="btn-ghost btn-sm" to="/flotta">← Flotta</Link>
        <button className="btn btn-sm" onClick={() => window.print()}>Stampa</button>
        <span className="sub">{data.length} etichette · formato consigliato: carta adesiva A4, stampa al 100%</span>
      </div>
      <div className="labels">
        {data.map(v => (
          <div key={v.id} className="label">
            {img[v.id] && <img src={img[v.id]} alt="" />}
            <div className="label-txt">
              <div className="label-brand">MOLAJONI · FLOTTA</div>
              <div className="label-targa">{v.targa}</div>
              <div className="label-mm">{v.marca_modello}</div>
              <div className="label-istr">Scansiona per: presa in carico, riconsegna, km, segnalare un problema</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
