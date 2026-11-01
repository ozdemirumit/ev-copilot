// Kalıcı geçmiş: yolculuklar (ölçülen tüketim kayıtlarından türetilir) ve şarj oturumları hesapla sunucuya yüklenir. Yalnızca eklenir;
// aynı kimlikle tekrar gönderim kaydı günceller. Cihazda eski kayıtlar silinse de (hist en çok 400 ölçüm) sunucuda kalır.
import { load, save } from '../utils/storage.js';
import { records } from '../physics/history.js';
import { chargeLog } from '../physics/charging.js';
import { getSession, proxyFetch } from '../net/proxy.js';

const TRIP_GAP_MS = 25 * 60e3;
const PUSH_DELAY_MS = 60e3;
let timer = null;

/** Ölçüm kayıtlarından yolculuk listesi (her yolculuk: başlangıç/bitiş zamanı, mesafe, süre, ortalama hız, kWh, kWh/100 km, pil düşüşü, konumlar). */
export function tripsFromRecords(recs = records()) {
  const by = new Map();
  for (const r of recs) {
    const a = by.get(r.trip) || { recs: [] };
    a.recs.push(r);
    by.set(r.trip, a);
  }
  return [...by.values()].map(({ recs: rs }) => {
    const dist = rs.reduce((a, r) => a + r.dist, 0);
    const hours = rs.reduce((a, r) => a + r.dist / Math.max(1, r.v), 0);
    const kwh = rs.reduce((a, r) => a + (r.kwh100 * r.dist) / 100, 0);
    const first = rs[0];
    const last = rs.at(-1);
    const t0 = first.t - Math.round((first.dist / Math.max(1, first.v)) * 3600e3); // ilk pencerenin başı
    return {
      id: 'tr' + t0.toString(36), t: last.t, t0,
      km: +dist.toFixed(1), min: Math.round(hours * 60), avgKmh: Math.round(dist / Math.max(hours, 1e-6)),
      kwh: +kwh.toFixed(1), kwh100: +((kwh / dist) * 100).toFixed(1), drop: rs.reduce((a, r) => a + r.drop, 0), n: rs.length,
      temp: Math.round(rs.reduce((a, r) => a + r.temp * r.dist, 0) / dist),
      from: first.lat != null ? { lat: first.lat, lon: first.lon } : null, to: last.lat != null ? { lat: last.lat, lon: last.lon } : null,
      dest: last.dest || null,
    };
  });
}

async function post(kind, items) {
  for (let i = 0; i < items.length; i += 200) {
    const r = await proxyFetch(`/v1/history/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 200) }), signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }
}

/** Sunucuya henüz yüklenmemiş yolculuk ve şarj kayıtlarını gönder. */
export async function uploadHistory() {
  if (!getSession()) return;
  const up = load('histUp', { trips: 0, charges: 0 });
  const trips = tripsFromRecords().filter((t) => t.t > up.trips - TRIP_GAP_MS); // son yolculuk büyümüş olabilir: payla tekrar gönder
  const charges = chargeLog().filter((c) => c.t > up.charges);
  if (trips.length) { await post('trips', trips); up.trips = Math.max(up.trips, ...trips.map((t) => t.t)); }
  if (charges.length) { await post('charges', charges); up.charges = Math.max(up.charges, ...charges.map((c) => c.t)); }
  save('histUp', up, { silent: true });
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => uploadHistory().catch(() => {}), PUSH_DELAY_MS);
}

export function initHistorySync() {
  document.addEventListener('charges-changed', schedule);
  document.addEventListener('account-changed', () => { if (getSession()) schedule(); });
  // yeni tüketim ölçümü geldikçe (hist durumu değişir)
  import('../state.js').then(({ subscribe }) => subscribe('hist', schedule));
  if (getSession()) schedule();
}
