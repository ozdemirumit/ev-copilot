// Tesla Supercharger istasyonları (supercharge.info topluluk verisi, anahtarsız). Yalnızca Togg'un kullanabildiği kayıtlar süzülür:
// durum AÇIK, "diğer markalara açık" (otherEVs) ve CCS2 soketli (Avrupa/Türkiye V4 ve açılmış V3 yerleri). Veri günde bir kez çekilir ve diske yazılır;
// kaynak sunucuya istemciler değil yalnızca bu sunucu gider. Dönüş biçimi (kısa): [[id, ad, lat, lon, kW, soket sayısı], …].
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'https://supercharge.info/service/supercharge/allSites';
const TTL_MS = 24 * 3600e3;
const RETRY_MS = 30 * 60e3;
const EUROPE = 101; // supercharge.info regionId (Türkiye dahil)

/** Ham kaydı süz → kısa kayıt ya da null. */
export function compactSite(s) {
  const lat = Number(s?.gps?.latitude);
  const lon = Number(s?.gps?.longitude);
  if (s?.status !== 'OPEN' || !s.otherEVs || !(s.plugs?.ccs2 > 0)) return null;
  if (s.address?.regionId !== EUROPE || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = String(s.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Tesla Supercharger';
  return [Number(s.id), name, Number(lat.toFixed(5)), Number(lon.toFixed(5)), Number(s.powerKilowatt) || 250, Number(s.plugs.ccs2) || Number(s.stallCount) || 0];
}

export function createTesla(dir, fetchFn = fetch) {
  const file = join(dir, 'tesla.json');
  let list = null; // { at, sites }
  let busy = null;
  try { if (existsSync(file)) list = JSON.parse(readFileSync(file, 'utf8')); } catch { list = null; }
  let failedAt = 0;

  async function refresh() {
    const r = await fetchFn(SOURCE, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('supercharge.info HTTP ' + r.status);
    const raw = await r.json();
    if (!Array.isArray(raw)) throw new Error('beklenmeyen yanıt');
    const sites = raw.map(compactSite).filter(Boolean);
    if (sites.length < 50) throw new Error('çok az kayıt: ' + sites.length); // bozuk yanıt eski listeyi ezmesin
    list = { at: Date.now(), sites };
    try { writeFileSync(file, JSON.stringify(list)); } catch { /* disk yazılamadı: bellekte kalır */ }
  }

  /** Güncel liste { at, sites }; süresi dolmuşsa yenilenir, yenilenemezse eskisi (varsa) döner. */
  async function get() {
    const stale = !list || Date.now() - list.at > TTL_MS;
    if (stale && Date.now() - failedAt > RETRY_MS) {
      busy ||= refresh().catch((err) => { failedAt = Date.now(); console.error('Tesla listesi alınamadı:', err.message); }).finally(() => { busy = null; });
      if (!list) await busy; // hiç veri yoksa bekle; varsa eskisini hemen ver
    }
    return list;
  }

  return { get };
}
