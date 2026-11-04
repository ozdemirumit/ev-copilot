// İstasyon bilgisi (istemci): topluluk puanı (1-5), çevredeki olanaklar ve fotoğraflar. Konum sunucuda ~100 m hücreye çevrilir.
// Fotoğraf yüklemeden önce cihazda JPEG'e küçültülür (canvas yeniden kodlar: konum/EXIF bilgisi atılır, boyut ≈ 100-250 KB).
import { getSession, proxyFetch } from '../net/proxy.js';

export const FACILITIES = [
  { id: 'mall', icon: '🛍️', name: 'AVM' },
  { id: 'wc', icon: '🚻', name: 'Tuvalet' },
  { id: 'restaurant', icon: '🍽️', name: 'Restoran' },
  { id: 'cafe', icon: '☕', name: 'Kafe' },
  { id: 'market', icon: '🛒', name: 'Market' },
  { id: 'mosque', icon: '🕌', name: 'Mescit' },
];

const MAX_EDGE = 1280;
const MAX_BYTES = 420_000; // sunucu sınırı 450 KB

async function post(path, body) {
  const r = await proxyFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return r.ok;
}

/** { rating: { avg, n, mine }, facilities: { id: { yes, no, mine } }, photos: [{ id, mine, at }] } ya da null. */
export async function fetchInfo(st) {
  if (!getSession()) return null;
  try {
    const r = await proxyFetch('/v1/station/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: st.lat, lon: st.lon }), signal: AbortSignal.timeout(12000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** stars: 1-5, 0 = puanı geri al. */
export const ratePoint = (st, stars) => post('/v1/station/rate', { lat: st.lat, lon: st.lon, stars }).catch(() => false);

/** has: true (var) | false (yok) | null (işareti geri al). */
export const markFacility = (st, fac, has) => post('/v1/station/facility', { lat: st.lat, lon: st.lon, fac, has }).catch(() => false);

/** Fotoğraf dosyasını (kameradan ya da galeriden) en uzun kenarı 1280 px olan JPEG'e küçült. */
export async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  let edge = MAX_EDGE;
  let q = 0.78;
  for (let i = 0; i < 4; i++) {
    const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
    if (blob && blob.size <= MAX_BYTES) { bmp.close?.(); return blob; }
    edge = Math.round(edge * 0.8);
    q = Math.max(0.5, q - 0.08);
  }
  bmp.close?.();
  return null;
}

/** Dönüş: { ok, error }. */
export async function uploadPhoto(st, blob) {
  try {
    const r = await proxyFetch(`/v1/station/photo?lat=${st.lat.toFixed(6)}&lon=${st.lon.toFixed(6)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: j.error || '' };
  } catch { return { ok: false, error: '' }; }
}

/** Fotoğrafı kimlikli istekle indirip gösterilebilir adres (blob:) döndür; hata → null. */
export async function photoUrl(id) {
  try {
    const r = await proxyFetch('/v1/station/photo/' + id, { signal: AbortSignal.timeout(20000) });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  } catch { return null; }
}

/** Başkasının fotoğrafını bildir: sunucu fotoğrafı hemen herkesten gizler, yönetici inceler. */
export async function reportPhoto(id) {
  try { return (await proxyFetch(`/v1/station/photo/${id}/report`, { method: 'POST', signal: AbortSignal.timeout(12000) })).ok; } catch { return false; }
}

export async function deletePhoto(id) {
  try { return (await proxyFetch('/v1/station/photo/' + id, { method: 'DELETE', signal: AbortSignal.timeout(12000) })).ok; } catch { return false; }
}
