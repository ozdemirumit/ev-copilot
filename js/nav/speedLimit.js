// Yol hız limiti: Google Roads API (speedLimits). Bu servis "Asset Tracking" lisansı gerektirir; anahtarın lisanslı değilse
// istek reddedilir (faturalanmaz), uygulama nedenini yazıp 10 dk bekler ve kullanıcının eşiğine döner.
// MALİYET: Speed Limits ≈ 0,02 $ / dönen öğe. Bu yüzden tek noktayla (1 öğe) ve seyrek sorulur: en az 20 sn ve en az 1 km arayla.
// Aylık sorgu sayısı sayılıp ekranda tahmini tutarla gösterilir.
import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { gfetch } from '../google/api.js';
import { haversineKm } from '../utils/geo.js';
import { cached, TTL } from '../utils/cache.js';

const $ = (id) => document.getElementById(id);
const EVERY_MS = 20000; // iki sorgu arası en az süre
const MOVE_KM = 1.0; // ve en az bu kadar yol (aynı yolda gereksiz sorgu yok)
const VALID_KM = 1.5; // limit, sorgu noktasından bu kadar uzağa kadar geçerli sayılır
const VALID_MS = 5 * 60e3; // ve en çok bu süre
const BACKOFF_MS = 10 * 60e3;
const USD_PER_ELEMENT = 0.02;

let busy = false;
let blockedUntil = 0;
let lastQ = { lat: null, lon: null, at: 0 };

const month = () => new Date().toISOString().slice(0, 7);
const usage = () => { const u = load('roadsUsage', null); return u?.m === month() ? u : { m: month(), n: 0 }; };
const setLimit = (limit, err = null) => patch('nav', { limit, limitErr: err });

async function query(e) {
  busy = true;
  lastQ = { lat: e.lat, lon: e.lon, at: Date.now() };
  try {
    // Aynı yol kesiti (≈ 110 m hücre) ve gidiş yönü (8 dilim) için sonuç saklanır: aynı yolu tekrar sürerken Google'a (ve faturaya) gidilmez
    const key = `sl:${e.lat.toFixed(3)},${e.lon.toFixed(3)},${Math.round((e.heading ?? 0) / 45) % 8}`;
    const res = await cached(key, TTL.long, async () => {
      const j = await gfetch(`https://roads.googleapis.com/v1/speedLimits?path=${e.lat.toFixed(6)},${e.lon.toFixed(6)}&units=KPH`, { keyInQuery: true });
      const list = j.speedLimits || [];
      const u = usage();
      u.n += list.length || 1; // yalnızca gerçek Google çağrısı sayılır; dönen öğe sayısı kadar faturalanır
      save('roadsUsage', u);
      const hit = list.at(-1);
      return { kph: hit?.speedLimit ? Math.round(hit.units === 'MPH' ? hit.speedLimit * 1.609344 : hit.speedLimit) : null };
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
    const u = usage();
    const cost = u.n ? ` · bu ay ${u.n} öğe ≈ ${(u.n * USD_PER_ELEMENT).toFixed(2)} $` : '';
    st.textContent = !nav.limitOn ? ''
      : nav.limitErr ? `Yol hız limiti alınamadı (${nav.limitErr}); senin eşiğin kullanılır.`
        : (lim ? `Bu yolun hız limiti: ${lim} km/s` : 'Yol hız limiti sürerken okunur') + cost;
  }
}

export function initSpeedLimit() {
  const sw = $('limit-on');
  sw.checked = getState('nav').limitOn;
  sw.addEventListener('change', () => {
    patch('nav', { limitOn: sw.checked, limit: null, limitErr: null });
    save('limitOn', sw.checked);
    blockedUntil = 0;
  });
  subscribe('nav', paint);
  setInterval(() => { check(); paint(); }, 3000);
  paint();
}
