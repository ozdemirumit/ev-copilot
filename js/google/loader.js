// Google Maps JavaScript API yükleyici. Anahtar yalnızca bu cihazın LocalStorage'ında durur (depoya/koda yazılmaz).
import { load } from '../utils/storage.js';

export const googleKey = () => load('gKey', '');

let loading = null;
let authError = null;
/** Google yüklenirken anahtar/yetki hatası bildirdiyse metni (gm_authFailure), yoksa null. */
export const googleAuthError = () => authError;

export function loadGoogle() {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
  loading ??= new Promise((resolve, reject) => {
    const key = googleKey();
    if (!key) { loading = null; return reject(new Error('Google anahtarı girilmemiş: Rota sekmesinden gir')); }
    // Maps JavaScript API anahtar reddedilirse bu global işlevi çağırır
    window.gm_authFailure = () => {
      authError = 'Google anahtarı reddedildi: anahtar yanlış, Maps JavaScript API etkin değil veya bu siteye (HTTP yönlendiren kısıtı) izin verilmemiş';
    };
    window.__gmReady = () => resolve(window.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=tr&region=TR&loading=async&callback=__gmReady`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error('Google Haritalar yüklenemedi (internet?)')); };
    document.head.append(s);
  });
  return loading;
}
