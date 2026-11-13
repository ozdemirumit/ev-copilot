// Rota konumuna bağlı yol önü olayları (saf hesap, tarayıcıya bağımlı değil): trafik sıkışıklığı ve yağış.
// Sorun (v0.99.56 öncesi): uyarı metni veri alındığı anda "~3 km ileride" olarak donduruluyor, 10 dk sonraki yenilemeye kadar
// araç ilerlese de aynı kalıyordu. Şimdi olay, plan rotası üzerindeki km'ye (alongKm) bağlanır; kalan mesafe her GPS ilerlemesinde
// kalan = max(0, olayKm − konumKm) olarak yeniden hesaplanır. Güvenilir rota konumu yoksa geri sayım yapılmaz, "mesafe belirsiz" yazılır.
//
// Konum kaynakları (uydurma koordinat yok):
//  - Trafik: sağlayıcının konumdan varışa trafikli rotasındaki km (jam.from). Yalnızca o rota plan rotasıyla aynı yoldaysa (sameRoad)
//    ve araç rotadaysa plan km'sine çevrilir: alongKm = alınma anındaki rota km'si + jam.from. Aksi hâlde anchored=false.
//  - Yağış: plan rotası üzerindeki örnek noktası (alınma km'si + d). Tahmin alan düzeyinde (ızgara + saatlik): kesin başlangıç
//    noktası çıkarılmaz; mesafe kaba yuvarlanır (≥10 km: 5 km adım) ve noktaya varınca "bu bölgede" denir.

export const TRAFFIC_STALE_MS = 20 * 60e3; // yenileme 10 dk'da bir; iki tur alınamazsa eski sıkışıklık gösterilmez
export const RAIN_STALE_MS = 30 * 60e3;
export const OFF_ROUTE_KM = 1; // ahead.js ile aynı: bu kadar rota dışında konum km'si güvenilmez
export const JITTER_KM = 0.3; // GPS/eşleme geri sıçraması: kalan mesafe bundan az artarsa önceki değer korunur
export const TRAFFIC_PASS_KM = 0.2; // sıkışıklığın sonunu bu kadar geçince olay biter
export const RAIN_PASS_KM = 10; // yağış örnek noktasını bu kadar geçince olay biter (bir sonraki yenileme yeniden bakar)
export const TRAFFIC_SPEAK_KM = [5, 2, 0.5]; // sesli hatırlatma eşikleri (her biri olay başına bir kez)

const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** Trafik olayı. jam: { from, to, jam } (alınma konumundan km). anchored: sağlayıcı rotası plan rotasıyla aynı ve araç rotadaydı. */
export function anchorTraffic({ jam, fetchKm, sameRoad, onRoute, delayMin = 0, planId = null, at = 0 }) {
  const anchored = !!(sameRoad && onRoute && num(fetchKm) && num(jam?.from));
  return {
    kind: 'traffic', planId, at, anchored, delayMin,
    alongKm: anchored ? fetchKm + jam.from : null,
    lenKm: Math.max(0, (jam?.to ?? 0) - (jam?.from ?? 0)),
    heavy: !!jam?.jam,
    fromAtFetch: jam?.from ?? null,
    said: [],
    shownKm: null,
  };
}

/** Yağış olayı: plan rotası üzerindeki örnek noktası (fetchKm + d). */
export function anchorRain({ d, fetchKm, mm, temp, planId = null, at = 0 }) {
  const anchored = num(fetchKm) && num(d);
  return { kind: 'rain', planId, at, anchored, alongKm: anchored ? fetchKm + d : null, mm, temp, shownKm: null };
}

/** Yeni alınan olay öncekiyle aynı yerse (aynı plan, ±1 km) söylenmiş eşikler ve gösterilen mesafe taşınır: aynı sıkışıklık yeniden duyurulmaz. */
export function mergeEvent(prev, next) {
  if (!prev || !next || prev.kind !== next.kind || prev.planId !== next.planId || !prev.anchored || !next.anchored) return next;
  if (Math.abs(prev.alongKm - next.alongKm) > 1) return next;
  return { ...next, said: [...(prev.said || [])], shownKm: prev.shownKm, known: true };
}

export const remainingKm = (ev, curKm) => Math.max(0, ev.alongKm - curKm);

/**
 * Olayın şu anki durumu: { status, remainKm }.
 * status: 'ahead' (geri sayım) | 'inside' (içindesin / bölgede) | 'passed' | 'stale' | 'otherplan' | 'unknown' (rota konumu güvenilmez).
 */
export function eventState(ev, { km, offRouteKm = 0, planId = null, now = 0 }) {
  if (!ev) return { status: 'passed', remainKm: null };
  if (ev.planId !== planId) return { status: 'otherplan', remainKm: null };
  if (now - ev.at > (ev.kind === 'rain' ? RAIN_STALE_MS : TRAFFIC_STALE_MS)) return { status: 'stale', remainKm: null };
  if (!ev.anchored || !num(km) || (offRouteKm ?? 0) >= OFF_ROUTE_KM) return { status: 'unknown', remainKm: null };
  if (ev.kind === 'traffic') {
    if (km > ev.alongKm + ev.lenKm + TRAFFIC_PASS_KM) return { status: 'passed', remainKm: 0 };
    if (km >= ev.alongKm - 0.1) return { status: 'inside', remainKm: 0 };
  } else {
    if (km > ev.alongKm + RAIN_PASS_KM) return { status: 'passed', remainKm: 0 };
    if (km >= ev.alongKm - 1) return { status: 'inside', remainKm: 0 };
  }
  return { status: 'ahead', remainKm: remainingKm(ev, km) };
}

/** GPS geri sıçraması süzgeci: kalan mesafe JITTER_KM'den az artarsa önceki gösterilen değer korunur; büyük artış (geri dönüş) kabul edilir. */
export function stabilize(prevKm, remKm, tol = JITTER_KM) {
  if (!num(remKm)) return remKm;
  if (num(prevKm) && remKm > prevKm && remKm - prevKm < tol) return prevKm;
  return remKm;
}

/** Trafik mesafesi: ≥10 km tam sayı, altı bir ondalık. */
export const fmtTrafficKm = (km) => (km >= 10 ? String(Math.round(km)) : km.toFixed(1));
/** Yağış mesafesi (alan düzeyinde tahmin): ≥10 km 5'in katı, altı tam sayı (en az 1). Kesinlik iması yok. */
export const fmtRainKm = (km) => String(km >= 10 ? Math.round(km / 5) * 5 : Math.max(1, Math.round(km)));

const what = (ev) => (ev.heavy ? 'yoğun trafik' : 'yavaş trafik');
const delayTail = (ev) => (ev.delayMin >= 3 ? `, rotada ≈ ${ev.delayMin} dk gecikme` : '');
const delayOnly = (ev) => (ev.delayMin >= 10 ? `🚦 Rotada trafik kaynaklı ≈ ${ev.delayMin} dk gecikme var` : null);

/** Trafik uyarı metni (durum + gösterilecek km). passed/stale/otherplan: sıkışıklık metni kalkar; yalnızca büyük gecikme kalır. */
export function trafficText(ev, st, shownKm) {
  const len = `(${ev.lenKm.toFixed(1)} km)`;
  if (st.status === 'ahead') return `🚦 ~${fmtTrafficKm(shownKm)} km ileride ${what(ev)} ${len}${delayTail(ev)}`;
  if (st.status === 'inside') return `🚦 Şu an ${what(ev)} ${len}${delayTail(ev)}`;
  if (st.status === 'unknown') return `🚦 İleride ${what(ev)} ${len}, mesafe belirsiz${delayTail(ev)}`;
  if (st.status === 'otherplan') return null;
  return delayOnly(ev);
}

/** Yağış uyarı metni. */
export function rainText(ev, st, shownKm) {
  const ice = ev.temp <= 2 ? ', buzlanma riski' : '';
  const tail = `(${ev.mm.toFixed(1)} mm/sa, ${Math.round(ev.temp)}°C${ice})`;
  if (st.status === 'ahead') return `🌧️ İleride yağmur: ~${fmtRainKm(shownKm)} km sonra ${tail}`;
  if (st.status === 'inside') return `🌧️ Bu bölgede yağmur bekleniyor ${tail}`;
  if (st.status === 'unknown') return `🌧️ İleride yağmur bekleniyor, mesafe belirsiz ${tail}`;
  return null;
}

/**
 * Bir sonraki sesli hatırlatma eşiği: kalan mesafe bir eşiğin altına İNDİYSE ve o eşik söylenmediyse en küçük geçilen eşik döner;
 * geçilen tüm eşikler söylenmiş sayılır (art arda birden çok ses olmaz). Alındığı anda zaten eşiğin altındaysa o eşik söylenmiş sayılır
 * (ilk duyuru zaten yapıldı). ev.said yerinde güncellenir. Eşik yoksa null.
 */
export function dueThreshold(ev, remKm, thresholds = TRAFFIC_SPEAK_KM) {
  if (!num(remKm)) return null;
  const crossed = thresholds.filter((th) => remKm <= th && !ev.said.includes(th));
  if (!crossed.length) return null;
  ev.said.push(...crossed);
  return Math.min(...crossed);
}

/** Alınma anında zaten geçilmiş eşikleri söylenmiş say (ilk duyuru bunları kapsar). */
export function primeThresholds(ev, remKm, thresholds = TRAFFIC_SPEAK_KM) {
  if (num(remKm)) for (const th of thresholds) if (remKm <= th && !ev.said.includes(th)) ev.said.push(th);
  return ev;
}

/**
 * Bir olay için tek adım: durum, süzülmüş km, metin. ev.shownKm yerinde güncellenir.
 * Dönen { text, st, shownKm, drop } — drop: olay artık izlenmez (geçildi/eskidi/başka plan).
 */
export function stepEvent(ev, ctx) {
  const st = eventState(ev, ctx);
  const shownKm = st.status === 'ahead' ? stabilize(ev.shownKm, st.remainKm) : null;
  ev.shownKm = shownKm;
  const text = ev.kind === 'rain' ? rainText(ev, st, shownKm) : trafficText(ev, st, shownKm);
  return { text, st, shownKm, drop: ['passed', 'stale', 'otherplan'].includes(st.status) };
}
