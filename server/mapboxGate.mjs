// D2-T1: Mapbox ROTA isteği için Premium yetkisi + aylık rota sınırı kararı. Saf: ağ, dosya, ortam değişkeni, anahtar yok.
// server/proxy.mjs mapbox() bunu yalnızca rota yolunda (/directions/) çağırır; istasyon araması (/search/) eski kurallarla kalır.
// Ret 402 döner; istemci (js/providers/index.js) Mapbox'sız ücretsiz Valhalla (OSM) rotasına düşer.
// Kota DEĞERİ burada yoktur: sınır yapılandırmadan (MAPBOX_ROUTE_MONTHLY_CAP) gelir, değeri kullanıcı kararıdır (D2-T2).

/**
 * Aylık sınır metni → { cap, valid }. Boş/tanımsız: sınır kapalı (cap null). Yalnız rakamlardan oluşan tam sayı: o sınır (0 = hiç Mapbox rotası yok).
 * Başka her değer geçersizdir ve cap 0 olur (fail-closed): yanlış yazılmış bir sınır Mapbox faturasını sınırsız açmaz.
 */
export function parseCap(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return { cap: null, valid: true };
  if (/^\d{1,9}$/.test(s)) return { cap: Number(s), valid: true };
  return { cap: 0, valid: false };
}

/** Açık/kapalı bayrağı: varsayılan açık; yalnız 0 / false / off / no (büyük-küçük harf ve boşluk önemsiz) kapatır. */
export function parseFlag(raw, def = true) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!s) return def;
  return !['0', 'false', 'off', 'no'].includes(s);
}

/**
 * Rota isteği geçsin mi: { allow: true } ya da { allow: false, status: 402, error }.
 * Sıra: önce Premium yetkisi (premium_required), sonra aylık sınır (mapbox_route_cap). Bozuk girdi izin vermez.
 * @param {{ premium: boolean, premiumOnly: boolean, used: number, cap: number|null }} p
 */
export function routeGate({ premium, premiumOnly = true, used, cap } = {}) {
  if (premiumOnly !== false && premium !== true) return { allow: false, status: 402, error: 'premium_required' };
  if (cap != null) {
    const n = Number(used);
    if (!Number.isFinite(n) || !Number.isFinite(cap) || n >= cap) return { allow: false, status: 402, error: 'mapbox_route_cap' };
  }
  return { allow: true };
}
