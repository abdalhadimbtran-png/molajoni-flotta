import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useT } from '../lib/i18n';

/** Foglio A4 da stampare o mandare su WhatsApp ai tecnici: QR + istruzioni in italiano e arabo. */
export default function Volantino() {
  const { t } = useT();
  const url = `${window.location.origin}/t`;
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { width: 520, margin: 1 }).then(setQr); }, [url]);
  return (
    <>
      <div className="row-flex no-print" style={{ marginBottom: 18 }}>
        <Link className="btn-ghost btn-sm" to="/tecnici">← {t('Tecnici')}</Link>
        <button className="btn btn-sm" onClick={() => window.print()}>{t('Stampa')}</button>
        <span className="sub">{t('Stampalo e consegnalo con codice e PIN, oppure invia il link su WhatsApp:')} <span className="mono" dir="ltr">{url}</span></span>
      </div>
      <div className="volantino">
        <div className="vol-head"><img src="/logo-molajoni.png" alt="Molajoni Antincendi" /><span>FLOTTA</span></div>
        <div className="vol-qr">{qr && <img src={qr} alt="QR" />}<div className="mono" dir="ltr">{url}</div></div>
        <div className="vol-col">
          <div lang="it" dir="ltr">
            <h2>Installa l'app sul telefono</h2>
            <h3>Android</h3>
            <ol><li>Inquadra il QR con la fotocamera.</li><li>Tocca <b>Installa l'app</b> nella pagina.</li><li>Conferma <b>Installa</b>.</li></ol>
            <h3>iPhone / iPad</h3>
            <ol><li>Inquadra il QR e apri con <b>Safari</b>.</li><li>Tocca <b>Condividi</b> ⬆︎</li><li><b>Aggiungi alla schermata Home</b> → <b>Aggiungi</b>.</li></ol>
            <h3>Primo accesso</h3>
            <ol><li>Apri l'app dall'icona <b>Flotta</b>.</li><li>Scrivi <b>codice</b> e <b>PIN</b>.</li><li>Tocca <b>Attiva le notifiche</b>.</li></ol>
          </div>
          <div lang="ar" dir="rtl">
            <h2>ثبّت التطبيق على هاتفك</h2>
            <h3>أندرويد</h3>
            <ol><li>وجّه الكاميرا نحو الرمز.</li><li>اضغط <b>تثبيت التطبيق</b> في الصفحة.</li><li>أكّد <b>تثبيت</b>.</li></ol>
            <h3>آيفون / آيباد</h3>
            <ol><li>امسح الرمز وافتح الرابط بـ <b>Safari</b>.</li><li>اضغط زر <b>المشاركة</b> ⬆︎</li><li><b>إضافة إلى الشاشة الرئيسية</b> ← <b>إضافة</b>.</li></ol>
            <h3>أول دخول</h3>
            <ol><li>افتح التطبيق من أيقونة <b>Flotta</b>.</li><li>اكتب <b>الرمز</b> و<b>PIN</b>.</li><li>اضغط <b>فعّل الإشعارات</b>.</li></ol>
          </div>
        </div>
        <div className="vol-pin"><span>Codice / الرمز: ________________</span><span>PIN: ______________</span></div>
        <p className="vol-foot">Il PIN è personale: non darlo a nessuno. · رمز PIN شخصي: لا تعطه لأحد.</p>
      </div>
    </>
  );
}
