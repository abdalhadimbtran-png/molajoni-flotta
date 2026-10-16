import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { Caricamento, Errore, Targa, useLoad } from '../ui';
import { urlQr } from './Flotta';

interface V { id: number; targa: string; marca_modello: string; qr_token: string }

/** Le etichette restano in italiano e arabo insieme: vanno sui veicoli e le leggono tutti. */
export default function StampaQr() {
  const { t } = useT();
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
      <div className="row-flex no-print" style={{ marginBottom: 18 }}>
        <Link className="btn-ghost btn-sm" to="/flotta">{t('← Flotta')}</Link>
        <button className="btn btn-sm" onClick={() => window.print()}>{t('Stampa')}</button>
        <span className="sub">{t('{n} etichette · formato consigliato: carta adesiva A4, stampa al 100%', { n: data.length })}</span>
      </div>
      <div className="labels">
        {data.map(v => (
          <div key={v.id} className="label">
            {img[v.id] && <img className="qr" src={img[v.id]} alt="" />}
            <div>
              <img className="label-logo" src="/logo-molajoni.png" alt="Molajoni Antincendi" />
              <div><Targa t={v.targa} /></div>
              <div className="label-mm">{v.marca_modello}</div>
              <div className="label-istr">Scansiona: prendi, riconsegna, km, problemi<br /><span lang="ar" dir="rtl">امسح الرمز: استلام، إرجاع، كيلومترات، مشاكل</span></div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
