// Premium'a özel bölümler: Kamera (pil okuma), Test (Test Modu, sürüş simülasyonu) ve ABRP (canlı telemetri köprüsü). Premium (ya da yönetici) olmayan hesapta ve girişsiz kullanımda
// bu menüler/sayfalar görünmez (CSS: body:not(.is-premium) [data-premium-only]), açık kamera durdurulur, Test Modu kapatılır.
// Plan açılışta yerel kayıttan, sonra sunucudan (plan-changed) gelir; Premium süresi dolunca da kendiliğinden kapanır.
import { getState, patch } from '../state.js';
import { getPlan } from '../net/proxy.js';

export const isPremium = () => !!getPlan()?.premium;

export function initPremiumGate() {
  const apply = () => {
    const on = isPremium();
    document.body.classList.toggle('is-premium', on);
    if (on) return;
    if (getState('sim').enabled) patch('sim', { enabled: false, play: false }); // Test Modu premium dışında çalışmaz
    if (getState('system').camera) document.getElementById('btn-cam')?.click(); // açık kamerayı durdur (pil okuma da durur)
    const view = document.body.dataset.view;
    if (view === 'camera' || view === 'test' || view === 'abrp') document.querySelector('.bottomnav [data-tab="map"], .sheet-x')?.click(); // açık premium sayfa kapanır
  };
  apply();
  for (const ev of ['plan-changed', 'account-changed']) document.addEventListener(ev, apply);
}
