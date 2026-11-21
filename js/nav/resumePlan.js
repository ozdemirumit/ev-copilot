// "Yarım kalan navigasyonu sürdür" (v0.99.121; SAF: DOM/ağ/depolama/zaman okumaz, zaman ve sürüm parametreyle gelir).
// Neden: telefon sürüş ortasında uygulamayı kapatabilir (bellek baskısı, güncelleme) ya da bağlantısız bölgede yeniden açılabilir; rota yalnız
// bellekte olduğundan kaybolurdu ve yeniden planlama için internet gerekirdi. Aktif plan bu cihazda saklanır ve kullanıcı dokunuşuyla, AĞSIZ sürdürülür.
// Kurallar (fail-closed): yalnız hazır (status 'ready') ve hedefi olan plan kaydedilir; çok büyük plan kaydedilmez; 12 saatten eski, gelecekten,
// farklı uygulama sürümünde üretilmiş (plan şekli değişmiş olabilir) ya da bozuk kayıt reddedilir. Kendiliğinden başlatma yok (UI'da dokunuş şart).
export const SCHEMA = 1;
export const MAX_AGE_MS = 12 * 3600e3;
export const MAX_BYTES = 1_500_000; // tarayıcı depo kotasını (~5 MB) ve diğer kayıtları korur
export const CLOCK_SKEW_MS = 5 * 60e3; // kayıt zamanı bundan fazla gelecekteyse saat kayması sayılır (reddedilir)

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Aktif plandan kaydedilecek küçük anlık görüntü; kaydedilemezse null.
 * plan: state.plan, route: state.route (start/end/via). İstasyon listesi yalnız duraklardakilere indirilir; ranking/stationInfo atılır;
 * rota koordinatları 5 ondalığa (≈1 m) yuvarlanır. Girdiler değiştirilmez.
 */
export function buildSnapshot({ plan, route, version, now } = {}) {
  if (!isObj(plan) || plan.status !== 'ready' || !isObj(plan.route) || !Array.isArray(plan.route.coords) || plan.route.coords.length < 2) return null;
  if (!isObj(plan.profile) || !Array.isArray(plan.steps) || !plan.steps.length) return null;
  if (!isObj(route) || !isObj(route.end) || !Number.isFinite(route.end.lat) || !Number.isFinite(route.end.lon)) return null;
  const { stations: _s, stationInfo: _i, ranking: _r, ...rest } = plan;
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  const seen = new Set();
  const stopStations = [];
  for (const s of stops) { const st = s?.station; if (st && st.id != null && !seen.has(st.id)) { seen.add(st.id); stopStations.push(st); } }
  let body;
  try {
    body = clone({ ...rest, stations: stopStations, stationInfo: null, route: { ...plan.route, coords: plan.route.coords.map((c) => [r5(c[0]), r5(c[1])]) } });
  } catch { return null; }
  const snap = {
    v: SCHEMA, appVersion: String(version ?? ''), savedAt: now,
    label: typeof route.end.label === 'string' ? route.end.label.slice(0, 80) : '',
    route: clone({ start: route.start ?? null, end: route.end, via: route.via ?? null }),
    plan: body,
  };
  return JSON.stringify(snap).length > MAX_BYTES ? null : snap;
}

/** Kayıt geçerli mi? { ok: true } ya da { ok: false, reason: 'format' | 'version' | 'age' }. */
export function checkSnapshot(snap, { version, now } = {}) {
  if (!isObj(snap) || snap.v !== SCHEMA || !Number.isFinite(snap.savedAt) || !isObj(snap.route) || !isObj(snap.route.end) || !isObj(snap.plan)
    || !isObj(snap.plan.route) || !Array.isArray(snap.plan.route.coords) || snap.plan.route.coords.length < 2 || !isObj(snap.plan.profile)
    || !Array.isArray(snap.plan.steps) || !snap.plan.steps.length) return { ok: false, reason: 'format' };
  if (snap.appVersion !== String(version ?? '')) return { ok: false, reason: 'version' };
  const age = now - snap.savedAt;
  if (age > MAX_AGE_MS || age < -CLOCK_SKEW_MS) return { ok: false, reason: 'age' };
  return { ok: true };
}

/** Kaydedilme üzerinden geçen dakika (tam sayı); kayıt geçersizse null. */
export function ageMinutes(snap, now) {
  return isObj(snap) && Number.isFinite(snap.savedAt) ? Math.max(0, Math.round((now - snap.savedAt) / 60e3)) : null;
}

/** Durum dilimlerine yazılacak parçalar (kayıttan bağımsız kopya): { route: {start,end,via}, plan }. */
export function restoreParts(snap) {
  const plan = clone(snap.plan);
  plan.status = 'ready';
  plan.text = 'Kayıtlı rota yüklendi (bağlantı gerekmez)';
  return { route: clone(snap.route), plan };
}
