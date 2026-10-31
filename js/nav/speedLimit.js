// Yol hız limiti OpenStreetMap maxspeed etiketinden (Valhalla, ücretsiz): etiketi olmayan yolda bilinmez ve kullanıcının eşiği kullanılır.
// Herkese açık sunucuya yük bindirmemek için tek noktayla ve seyrek sorulur: en az 20 sn ve en az 1 km arayla; sonuç önbelleğe alınır.
import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { fetchSpeedLimit } from '../providers/index.js';
import { haversineKm } from '../utils/geo.js';
import { toast } from '../ui/toast.js';
import { cached, TTL } from '../utils/cache.js';

const $ = (id) => document.getElementById(id);
const EVERY_MS = 20000; // iki sorgu arası en az süre
const MOVE_KM = 1.0; // ve en az bu kadar yol (aynı yolda gereksiz sorgu yok)
const VALID_KM = 1.5; // limit, sorgu noktasından bu kadar uzağa kadar geçerli sayılır
const VALID_MS = 5 * 60e3; // ve en çok bu süre
const BACKOFF_MS = 10 * 60e3;

let busy = false;
let blockedUntil = 0;
let lastQ = { lat: null, lon: null, at: 0 };

const setLimit = (limit, err = null) => patch('nav', { limit, limitErr: err });

async function query(e) {
  busy = true;
  lastQ = { lat: e.lat, lon: e.lon, at: Date.now() };
  try {
    // Aynı yol kesiti (≈ 110 m hücre) ve gidiş yönü (8 dilim) için sonuç saklanır: aynı yolu tekrar sürerken Google'a (ve faturaya) gidilmez
    const key = `sl:${e.lat.toFixed(3)},${e.lon.toFixed(3)},${Math.round((e.heading ?? 0) / 45) % 8}`;
    const res = await cached(key, TTL.long, async () => {
      return { kph: await fetchSpeedLimit(e.lat, e.lon, e.heading) }; // yalnızca gerçek kaynak çağrısı yapılır; sonuç önbelleğe yazılır
    });
    setLimit(res.kph ? { kph: res.kph, at: Date.now(), lat: e.lat, lon: e.lon } : null); // null: bu yol için veri yok
  } catch (err) {
    setLimit(null, err.message);
    if (err.fatal || err.status === 403 || err.status === 400) blockedUntil = Date.now() + BACKOFF_MS; // lisans/anahtar sorunu: tekrar tekrar sorma
  } finally {
    busy = false;
  }
}

function check() {
  const nav = getState('nav');
  const e = effective();
  const sim = getState('sim');
  const driving = (e.speed ?? 0) > 5 && (sim.enabled ? sim.play : getState('live').gps !== 'off');
  if (!nav.limitOn || !driving || e.lat == null) return;
  if (busy || Date.now() < blockedUntil || Date.now() - lastQ.at < EVERY_MS) return;
  if (lastQ.lat != null && haversineKm(lastQ, e) < MOVE_KM) return;
  query(e);
}

/** Güncel yol limiti (km/h): sorgu noktasına yakın ve yeniyse; değilse null. */
export function currentLimit() {
  const l = getState('nav').limit;
  const e = effective();
  if (!l || e.lat == null || Date.now() - l.at > VALID_MS || haversineKm(l, e) > VALID_KM) return null;
  return l.kph;
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
    st.textContent = !nav.limitOn ? 'Kapalı: yol hız limiti sorgulanmaz. Hız uyarısı senin belirlediğin eşikle çalışır.'
      : nav.limitErr ? `Yol hız limiti alınamadı (${nav.limitErr}); senin eşiğin kullanılır.`
        : (lim ? `Bu yolun hız limiti: ${lim} km/s` : 'Yol hız limiti sürerken okunur (OpenStreetMap; etiketi olmayan yolda bilinmez)');
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
    toast(on ? 'Yol hız limiti kontrolü açık (OpenStreetMap, ücretsiz)' : 'Yol hız limiti kontrolü kapalı');
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
