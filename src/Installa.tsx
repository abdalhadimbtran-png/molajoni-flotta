import { useEffect, useState } from 'react';
import { useT } from './lib/i18n';

/** Evento di installazione di Chrome/Edge/Samsung Internet (Android e computer). */
interface BeforeInstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let evento: BeforeInstallPrompt | null = null;
const ascolta = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); evento = e as BeforeInstallPrompt; ascolta.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { evento = null; ascolta.forEach(f => f()); });
}
export const installata = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const suIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Pulsante "Installa l'app": un tocco su Android, istruzioni brevi su iPhone/iPad. Sparisce se l'app è già installata. */
export function InstallaApp({ variante = 'tec' }: { variante?: 'tec' | 'admin' }) {
  const { t } = useT();
  const [, agg] = useState(0);
  const [guida, setGuida] = useState(false);
  useEffect(() => { const f = () => agg(x => x + 1); ascolta.add(f); return () => { ascolta.delete(f); }; }, []);
  if (installata()) return null;
  const ios = suIOS();
  if (!evento && !ios) return null;
  async function installa() {
    if (evento) { await evento.prompt(); await evento.userChoice; evento = null; agg(x => x + 1); }
    else setGuida(!guida);
  }
  if (variante === 'admin') return (
    <div className="bell-wrap">
      <button className="btn-ghost btn-sm" onClick={installa}>⬇ {t("Installa l'app")}</button>
      {guida && <div className="bell-panel" style={{ padding: 14 }}><GuidaIOS /></div>}
    </div>
  );
  return (
    <section className="tec-card installa">
      <div className="row-flex"><img src="/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
        <div style={{ flex: 1 }}><b>{t("Installa l'app sul telefono")}</b><div className="sub">{t("Un'icona sulla schermata Home, si apre come un'app e riceve le notifiche.")}</div></div></div>
      <button className="btn brand big" onClick={installa}>⬇ {t("Installa l'app")}</button>
      {guida && <GuidaIOS />}
    </section>
  );
}

function GuidaIOS() {
  const { t } = useT();
  return (
    <ol className="guida">
      <li>{t('Apri questa pagina con Safari.')}</li>
      <li>{t('Tocca il pulsante Condividi')} <span className="ico-share" aria-hidden="true">⬆︎</span></li>
      <li>{t('Scegli "Aggiungi alla schermata Home" e poi "Aggiungi".')}</li>
      <li>{t("Apri l'app dalla nuova icona.")}</li>
    </ol>
  );
}
