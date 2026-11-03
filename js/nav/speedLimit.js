// Yol hız limiti OpenStreetMap maxspeed etiketinden (Valhalla, ücretsiz): etiketi olmayan yolda bilinmez ve kullanıcının eşiği kullanılır.
// Herkese açık sunucuya yük bindirmemek için tek noktayla ve seyrek sorulur: en az 20 sn ve en az 1 km arayla; sonuç önbelleğe alınır.
// Premium navigasyonda önce rota boyunca alınmış kesimlere bakılır (nav/limitSpans.js: HERE, sonra Mapbox), ağ isteği olmadan;
// kesimler o noktayı bilmiyorsa bugünkü OSM sorgusu aynen çalışır, o da bilmiyorsa limit yok (tahmin yapılmaz).
import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { fetchSpeedLimit } from '../providers/index.js';
import { haversineKm } from '../utils/geo.js';
import { toast } from '../ui/toast.js';
import { cached, TTL } from '../utils/cache.js';
import { limitSpans } from './limitSpans.js';
import { premiumAccess, proxyHas } from '../net/proxy.js';

const $ = (id) => document.getElementById(id);
const EVERY_MS = 20000; // iki sorgu arası en az süre
const MOVE_KM = 1.0; // ve en az bu kadar yol (aynı yolda gereksiz sorgu yok)
const VALID_KM = 1.5; // limit, sorgu noktasından bu kadar uzağa kadar geçerli sayılır
const VALID_MS = 5 * 60e3; // ve en çok bu süre
const BACKOFF_MS = 10 * 60e3;
const SPAN_KM = 0.3; // kesim kaynaklı (HERE/Mapbox) limit, okunduğu noktadan bu kadar uzağa kadar geçerli (her 3 sn yenilenir)
const SPAN_SRC = new Set(['here', 'mapbox']);
const SRC_NAME = { here: 'HERE', mapbox: 'Mapbox', osm: 'OpenStreetMap' };

let busy = false;
let blockedUntil = 0;
let lastQ = { lat: null, lon: null, at: 0 };

const setLimit = (limit, err = null) => patch('nav', { limit, limitErr: err });

async function query(e) {
  busy = true;
  lastQ = { lat: e.lat, lon: e.lon, at: Date.now() };
  try {
    // Aynı yol kesiti (≈ 110 m hücre) ve gidiş yönü (8 dilim) için sonuç saklanır: aynı yolu tekrar sürerken sunucuya gidilmez
    const key = `sl:${e.lat.toFixed(3)},${e.lon.toFixed(3)},${Math.round((e.heading ?? 0) / 45) % 8}`;
    const res = await cached(key, TTL.long, async () => {
      return { kph: await fetchSpeedLimit(e.lat, e.lon, e.heading) }; // yalnızca gerçek kaynak çağrısı yapılır; sonuç önbelleğe yazılır
    });
    setLimit(res.kph ? { kph: res.kph, src: 'osm', at: Date.now(), lat: e.lat, lon: e.lon } : null); // null: bu yol için veri yok
  } catch (err) {
    setLimit(null, err.message);
    if (err.fatal || err.status === 403 || err.status === 400) blockedUntil = Date.now() + BACKOFF_MS; // lisans/anahtar sorunu: tekrar tekrar sorma
  } finally {
    busy = false;
  }
}

function check() {
  const nav = getState('nav');
  limitSpans.ensure({ active: nav.active, limitOn: nav.limitOn, route: getState('plan').route }); // Premium: navigasyon başlayınca/rota değişince bir kez
  const e = effective();
  const sim = getState('sim');
  const driving = (e.speed ?? 0) > 5 && (sim.enabled ? sim.play : getState('live').gps !== 'off');
  if (!nav.limitOn || !driving || e.lat == null) return;
  const hit = nav.active ? limitSpans.limitAt(e.lat, e.lon, e.heading) : null;
  if (hit) {
    const l = nav.limit;
    if (!l || l.kph !== hit.kph || l.src !== hit.src || Date.now() - l.at > 60e3 || haversineKm(l, e) > 0.1) setLimit({ kph: hit.kph, src: hit.src, at: Date.now(), lat: e.lat, lon: e.lon });
    return;
  }
  if (nav.limit && SPAN_SRC.has(nav.limit.src)) setLimit(null); // kesim kaynağı burayı bilmiyor: önceki kesimin limiti taşınmaz
  if (nav.active && limitSpans.loading()) return; // HERE kesimleri yolda (≈ 1 sn): gereksiz OSM sorgusu yapma
  if (busy || Date.now() < blockedUntil || Date.now() - lastQ.at < EVERY_MS) return;
  if (lastQ.lat != null && haversineKm(lastQ, e) < MOVE_KM) return;
  return query(e);
}

/** Güncel yol limiti ve kaynağı { kph, src: 'here' | 'mapbox' | 'osm' }: okunduğu noktaya yakın ve yeniyse; değilse null. */
export function limitInfo() {
  const l = getState('nav').limit;
  const e = effective();
  if (!l || e.lat == null || Date.now() - l.at > VALID_MS || haversineKm(l, e) > (SPAN_SRC.has(l.src) ? SPAN_KM : VALID_KM)) return null;
  return { kph: l.kph, src: l.src || 'osm' };
}

/** Güncel yol limiti (km/h) ya da null. */
export const currentLimit = () => limitInfo()?.kph ?? null;

/** Durum satırı metni (Türkçe kaynak; ekrandaki çeviri sözlükten). */
function statusText({ noLimit = false } = {}) {
  const nav = getState('nav');
  const info = noLimit ? null : limitInfo();
  const st = limitSpans.status();
  if (!nav.limitOn) return 'Kapalı: yol hız limiti sorgulanmaz. Hız uyarısı senin belirlediğin eşikle çalışır.';
  if (info) return `Bu yolun hız limiti: ${info.kph} km/s · Kaynak: ${SRC_NAME[info.src] || SRC_NAME.osm}`;
  if (nav.active && st.active && st.failed) return 'HERE hız limiti alınamadı; OpenStreetMap kullanılıyor (etiketi olmayan yolda bilinmez)';
  if (nav.limitErr) return `Yol hız limiti alınamadı (${nav.limitErr}); senin eşiğin kullanılır.`;
  if (premiumAccess() && proxyHas('here')) return 'Yol hız limiti sürerken okunur (Premium: HERE; yoksa Mapbox, o da yoksa OpenStreetMap)';
  return 'Yol hız limiti sürerken okunur (OpenStreetMap; etiketi olmayan yolda bilinmez)';
}

function paint() {
  const nav = getState('nav');
  const lim = currentLimit();
  for (const id of ['hud-limit', 'nh-limit']) {
    const el = $(id);
    if (!el) continue;
    el.textContent = lim ?? '';
    el.classList.toggle('hidden', lim == null);
  }
  const st = $('limit-status');
  if (st) {
    const txt = statusText();
    if (st.dataset.src !== txt) { st.dataset.src = txt; st.textContent = txt; } // her 3 sn aynı metni yazıp çeviriyi yeniden tetikleme
  }
}

export function initSpeedLimit() {
  const sw = $('limit-on');
  const btn = $('nh-limitbtn');
  const paintOn = () => {
    const on = getState('nav').limitOn;
    sw.checked = on;
    btn.classList.toggle('on', on);
  };
  /** Açma/kapama: her iki denetim (Navigasyon kartı anahtarı ve harita üstü düğme) bunu kullanır. */
  const setOn = (on) => {
    patch('nav', { limitOn: on, limit: null, limitErr: null });
    save('limitOn', on);
    blockedUntil = 0;
    toast(!on ? 'Yol hız limiti kontrolü kapalı' : premiumAccess() && proxyHas('here') ? 'Yol hız limiti kontrolü açık (Premium: HERE, yedek OpenStreetMap)' : 'Yol hız limiti kontrolü açık (OpenStreetMap, ücretsiz)');
    paintOn();
    paint();
  };
  sw.addEventListener('change', () => setOn(sw.checked));
  btn.addEventListener('click', () => setOn(!getState('nav').limitOn));
  subscribe('nav', paint);
  setInterval(() => { check(); paint(); }, 3000);
  paintOn();
  paint();
}

/** Yalnızca denemeler için (scripts/test-map-provider.mjs Bölüm 9). */
export const __test = {
  check,
  statusText,
  idle: () => limitSpans.idle(),
  reset({ spans = false } = {}) {
    busy = false;
    blockedUntil = 0;
    lastQ = { lat: null, lon: null, at: 0 };
    if (spans) limitSpans.clear({ unblock: true });
  },
};
