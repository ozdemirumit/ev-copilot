// Rota planlama: başlangıç varsayılan olarak "Konumum" (araç konumu) gelir, varış boş kalır. Konum değiştikçe (100 m) başlangıç
// güncellenir; kullanıcı başka bir başlangıç seçince (arama, haritadan, çip) otomatik güncelleme durur. Temizle yine Konumum'a döner.
// Metin kutusuna dokununca içi silinir; bir şey seçilmeden bırakılırsa eski metin geri gelir.
import { getState, subscribe, effective } from '../state.js';
import { haversineKm } from '../utils/geo.js';
import { mapApi } from './mapView.js';

const $ = (id) => document.getElementById(id);

export function initDefaultStart() {
  const startIn = $('route-start');
  const endIn = $('route-end');
  let last = null;

  const isAuto = () => {
    const s = getState('route').start;
    return !s || s.auto === true;
  };
  // Plan kurulmuş/kuruluyorsa, navigasyon açıksa ya da Test Modu (sürüş simülasyonu) çalışıyorsa A rota başlangıcında sabit kalır:
  // araç ilerledikçe A'yı taşımak rota durumunu (route) sürekli tetikler ve çizilen rotayla uyuşmaz.
  const frozen = () => !!getState('route').start
    && (getState('sim').enabled || getState('nav').active || ['ready', 'loading'].includes(getState('plan').status));
  let simWas = getState('sim').enabled;
  const apply = () => {
    if (!isAuto()) return;
    const simNow = getState('sim').enabled;
    const simSwitched = simNow !== simWas; // Test Modu açılıp kapandı: A bir kez yeni konuma alınır (plan yoksa)
    simWas = simNow;
    if (frozen() && !(simSwitched && getState('plan').status !== 'ready' && getState('plan').status !== 'loading')) return;
    const e = effective();
    if (e.lat == null || e.lon == null) return;
    if (!simSwitched && last && haversineKm(last, e) < 0.1 && getState('route').start) return;
    last = { lat: e.lat, lon: e.lon };
    mapApi.setPoint('start', { lat: e.lat, lon: e.lon, label: 'Konumum', auto: true }, { fit: false });
  };
  subscribe(['live', 'sim'], apply);
  $('btn-clear-route').addEventListener('click', () => setTimeout(() => { last = null; apply(); }, 0));
  setTimeout(apply, 0);

  // Dokununca sil; seçim yapılmadan bırakılırsa eski metin geri gelsin
  for (const inp of [startIn, endIn]) {
    inp.addEventListener('focus', () => { inp.dataset.prev = inp.value; inp.value = ''; });
    inp.addEventListener('blur', () => setTimeout(() => { if (inp.value === '' && inp.dataset.prev) inp.value = inp.dataset.prev; }, 250));
  }
  if (!getState('route').start) startIn.placeholder = 'Konumum (konum bulununca)';
}
