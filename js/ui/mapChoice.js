// Daha Fazla > Harita sağlayıcısı kartı (yalnızca Premium, hesaplı): kullanıcı OpenFreeMap / Mapbox / TomTom / Google arasından KENDİ haritasını seçer.
// Seçenekler GET /v1/providers kataloğundan gelir (salt okunur; yalnızca sunucuda anahtarı tanımlı olanlar seçilebilir), seçim POST /v1/map/choice ile
// sunucuya yazılır. Anahtar bu modüle hiç gelmez: harita açılırken js/net/mapConfig.js /v1/map/config'ten alır. Açık harita bu sayfada değişmez;
// yenilemede ya da bir sonraki açılışta yeni sağlayıcı gelir (navigasyon sürerken yenileme düğmesi kapalıdır).
import { getSession, proxyFetch } from '../net/proxy.js';
import { freeOnlyMode, providerRequestsPaused } from '../net/providerGate.js';
import { rememberProvider } from '../net/mapConfig.js';
import { getState } from '../state.js';
import { isPremium } from './premiumGate.js';
import { toast } from './toast.js';
import { tr } from '../i18n/index.js';

/** Sağlayıcıya göre rota/trafik notu (sunucu kataloğundaki routeNote çevrilemez; bunlar i18n anahtarıdır). */
export const NOTES = Object.freeze({
  osm: 'Rota Valhalla (OSM); canlı trafik yok.',
  mapbox: 'Canlı trafikli rota Mapbox ile; harita seçiminden bağımsızdır.',
  tomtom: 'Rota ve trafik TomTom ile; yalnızca TomTom haritası açıkken.',
  google: "Google rotası henüz bağlı değil: rota Google'dan gelmez.",
});

/** Katalog yanıtından seçilebilir sağlayıcılar (bilinmeyen/seçilemez olanlar atılır). Bozuk yanıt → []. */
export function choiceOptions(j) {
  const list = Array.isArray(j?.providers) ? j.providers : [];
  return list.filter((p) => p && p.selectable === true && typeof p.id === 'string' && Object.hasOwn(NOTES, p.id))
    .map((p) => ({ id: p.id, label: typeof p.label === 'string' && p.label ? p.label : p.id }));
}

const $ = (id) => document.getElementById(id);

export function initMapChoice() {
  const card = $('mapchoice-card');
  if (!card) return;
  const sel = $('mc-select'), note = $('mc-note'), out = $('mc-out'), apply = $('mc-apply');
  let opts = [];

  const paintNote = () => { note.textContent = tr(NOTES[sel.value] || ''); };
  function render(current) {
    sel.replaceChildren(...opts.map((o) => new Option(o.label, o.id)));
    sel.value = opts.some((o) => o.id === current) ? current : 'osm';
    paintNote();
  }
  async function load() {
    if (!isPremium() || !getSession() || freeOnlyMode() || providerRequestsPaused()) return; // sağlayıcı istekleri kapalıyken sunucuya sorulmaz
    try {
      const r = await proxyFetch('/v1/providers', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      opts = choiceOptions(j);
      render(j?.selected?.map);
    } catch { /* ağ yok: kart son hâlinde kalır */ }
  }

  sel.addEventListener('change', async () => {
    const want = sel.value;
    sel.disabled = true;
    try {
      const r = await proxyFetch('/v1/map/choice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: want }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        toast(r.status === 402 ? 'Premium gerekli' : 'Harita sağlayıcısı değiştirilemedi');
        await load(); // seçimi sunucudaki gerçek değere geri çek
        return;
      }
      rememberProvider(j.effective); // yalnızca ADI saklanır; sonraki açılış hemen yeni sağlayıcıyla başlar
      const navOn = !!getState('nav')?.active;
      out.textContent = tr(navOn ? 'Kaydedildi. Navigasyon bitince yenileyince gelir.' : 'Kaydedildi. Yeni harita yenilenince ya da bir sonraki açılışta gelir.');
      apply.classList.remove('hidden');
      apply.disabled = navOn;
      paintNote();
    } catch { toast('Harita sağlayıcısı değiştirilemedi'); await load(); } finally { sel.disabled = false; }
  });
  apply.addEventListener('click', () => location.reload());

  for (const ev of ['plan-changed', 'account-changed']) document.addEventListener(ev, load);
  load();
}
