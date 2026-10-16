/** Notifiche push sul telefono/computer. La chiave pubblica non è un segreto. */
export const VAPID_PUBLIC = 'BCrtmF4VHH41c120FFxuUvwdgHwr6YTfg_6pPiZAtx0g5Uv37XVoSdC9Yus5k9Tt6xL90kgluceVFSDrT0p0HFY';
export const URL_FUNZIONI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flotta`;

export type StatoPush = 'attive' | 'da_attivare' | 'negate' | 'serve_home' | 'non_supportate';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function registraSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export async function statoPush(): Promise<StatoPush> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS() && !standalone() ? 'serve_home' : 'non_supportate';
  if (Notification.permission === 'denied') return 'negate';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'attive' : 'da_attivare';
}

function chiave(b64: string) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/** Chiede il permesso, crea l'iscrizione e la passa a `salva` (che la registra nel database). */
export async function attivaPush(salva: (endpoint: string, p256dh: string, auth: string) => Promise<void>): Promise<StatoPush> {
  const s = await statoPush();
  if (s === 'serve_home' || s === 'non_supportate' || s === 'negate') return s;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'negate' : 'da_attivare';
  const reg = (await registraSW()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave(VAPID_PUBLIC) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await salva(j.endpoint, j.keys.p256dh, j.keys.auth);
  return 'attive';
}

/** Riduce la foto (lato lungo 1600 px, JPEG) prima dell'invio: meno dati, caricamento più veloce. */
export async function comprimiFoto(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, ko) => c.toBlob(b => (b ? ok(b) : ko(new Error('foto'))), 'image/jpeg', 0.82));
  } catch { return f; }
}
