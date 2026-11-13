// Şarj durağına YOL AĞIYLA erişim (saf; ağ/DOM yok, yol ağı sorgusu dışarıdan verilir).
// Sorun: istasyonlar rotaya DÜZ ÇİZGİ uzaklığıyla izdüşürülür (chargerSource.finalize). Bölünmüş otoyolda (ör. O-7 Kuzey Marmara) karşı yönün
// dinlenme tesisi rota çizgisine 60-110 m uzaktadır; planlayıcı onu "yol üstü, sapma ≈ 0" sayıyordu. Oysa oraya ancak sonraki kavşakta
// dönüp gelerek ulaşılır (Çatalca Opet/Trugo: yol ağıyla ≈ 36 km sapma). Bu modül:
//  - rota çizgisinde durağın önünden (A) ve arkasından (B) gidiş yönünde birer nokta seçer,
//  - yol ağı sorgusunun (A → istasyon → B) uzunluğundan rota boyunca A → B uzunluğunu çıkarıp GERÇEK sapmayı bulur,
//  - sapma düz çizgi uzaklığıyla orantısızsa (bariyer/karşı şerit) durağı erişilemez sayar, değilse sapmayı planın maliyetine koyar.
// Düz çizgi yakınlığı hiçbir zaman erişim kanıtı sayılmaz: doğrulanmamış durak "doğrulanmadı" olarak kalır.
import { angleDiff, bearing } from '../utils/geo.js';

/** Durağın önünde/arkasında yol ağı sorgusunun bağlanacağı rota noktalarının uzaklığı (km). Tesis giriş/çıkış kolları bu aralıkta kalır. */
export const ACCESS_LEG_KM = 3;
/** Sapma (gidiş + dönüş, km) şu iki değerin büyüğünü aşarsa durak erişilemez sayılır: sabit alt sınır ve düz çizgi sapmasının katı. */
export const REJECT_MIN_KM = 6;
export const REJECT_GEO_FACTOR = 4;
/** Doğrulama gidiş yönüne bağlıdır: rota yönü bundan fazla değişirse (ör. ters yönde yeni rota) sonuç geçersiz. */
export const SAME_DIR_DEG = 60;
/** Yol ağı sorgusu başarısızsa bu süreden önce yeniden denenmez (ms). */
export const RETRY_MS = 120000;

const kmPer = (lat) => ({ kx: 111.32 * Math.cos((lat * Math.PI) / 180), ky: 110.57 });

/** Tam çözünürlüklü çizgi ([[lon, lat], …]) için birikimli km dizisi. */
export function lineKm(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const { kx, ky } = kmPer((y0 + y1) / 2);
    cum.push(cum[i - 1] + Math.hypot((x1 - x0) * kx, (y1 - y0) * ky));
  }
  return cum;
}

/**
 * Noktayı çizgiye izdüşür: { km, offKm, side, heading }. side: gidiş yönüne göre 'right' | 'left' (Türkiye sağdan trafik: sağ = aynı yön
 * şeridi tarafı). hintKm verilirse yalnızca [hint - win, hint + win] aralığına bakılır (rota aynı yerden iki kez geçebilir).
 */
export function locateOnLine(coords, cum, p, hintKm = null, win = 5) {
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) return null;
  const { kx, ky } = kmPer(p.lat);
  let best = null;
  for (let i = 0; i + 1 < coords.length; i++) {
    if (hintKm != null && (cum[i + 1] < hintKm - win || cum[i] > hintKm + win)) continue;
    const ax = (coords[i][0] - p.lon) * kx;
    const ay = (coords[i][1] - p.lat) * ky;
    const dx = (coords[i + 1][0] - coords[i][0]) * kx;
    const dy = (coords[i + 1][1] - coords[i][1]) * ky;
    const len2 = dx * dx + dy * dy;
    if (!len2) continue;
    const t = Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const px = ax + dx * t; // izdüşüm noktasından istasyona vektörün tersi: (-px, -py)
    const py = ay + dy * t;
    const d = Math.hypot(px, py);
    if (!best || d < best.offKm) {
      const cross = dx * -py - dy * -px; // > 0: istasyon gidiş yönünün solunda
      best = { km: cum[i] + Math.sqrt(len2) * t, offKm: d, side: cross > 0 ? 'left' : 'right', heading: bearing({ lat: coords[i][1], lon: coords[i][0] }, { lat: coords[i + 1][1], lon: coords[i + 1][0] }) };
    }
  }
  if (!best && hintKm != null) return locateOnLine(coords, cum, p, null);
  return best;
}

/** Çizgide km'deki nokta ve gidiş yönü: { lat, lon, heading, km }. */
export function pointAtKm(coords, cum, km) {
  const total = cum[cum.length - 1];
  const k = Math.min(total, Math.max(0, km));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < k) i++;
  const a = coords[i - 1];
  const b = coords[i];
  const f = cum[i] > cum[i - 1] ? (k - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
  return {
    lat: a[1] + (b[1] - a[1]) * f, lon: a[0] + (b[0] - a[0]) * f, km: k,
    heading: Math.round(bearing({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] })),
  };
}

/**
 * Yol ağı sorgusunun girdisi: { a, b, alongKm, at } ya da null (çizgi/koordinat geçersiz). a ve b rota çizgisinin ÜZERİNDE ve gidiş
 * yönü (heading) taşır: sorgu onları rotanın kendi şeridine bağlar, karşı şeride oturtmaz. at: istasyonun çizgideki izdüşümü (km, side, heading).
 */
export function accessProbe(coords, station, { legKm = ACCESS_LEG_KM, cum = null } = {}) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const c = cum || lineKm(coords);
  const at = locateOnLine(coords, c, station, Number.isFinite(station?.km) ? station.km : null, 8);
  if (!at) return null;
  const a = pointAtKm(coords, c, at.km - legKm);
  const b = pointAtKm(coords, c, at.km + legKm);
  const alongKm = b.km - a.km;
  if (!(alongKm > 0.2)) return null;
  return { a, b, alongKm, at };
}

/**
 * Yol ağı sonucu → karar. routedKm: A → istasyon → B yol ağı uzunluğu; geoOffKm: düz çizgi uzaklığı.
 * Dönüş: { ok, detourKm } — ok=false: sapma düz çizgi uzaklığıyla orantısız (karşı yön/bariyer: sonraki kavşakta dönmek gerekir).
 */
export function judgeAccess({ routedKm, alongKm, geoOffKm = 0 }) {
  const detourKm = Math.max(0, routedKm - alongKm);
  const limit = Math.max(REJECT_MIN_KM, REJECT_GEO_FACTOR * 2 * Math.max(0, geoOffKm));
  return { ok: detourKm <= limit, detourKm };
}

/**
 * Doğrulama kayıtları (istasyon kimliği → kayıt listesi). Kayıt: { heading, verified, ok, detourKm, at, reason }.
 * Bellekte tutulur; yeni yolculukta temizlenir.
 */
export function createAccessBook() {
  const map = new Map();
  const find = (id, heading) => (map.get(id) || []).find((r) => Math.abs(angleDiff(r.heading, heading)) <= SAME_DIR_DEG) || null;
  return {
    get: find,
    put(id, rec) {
      const list = (map.get(id) || []).filter((r) => Math.abs(angleDiff(r.heading, rec.heading)) > SAME_DIR_DEG);
      list.push(rec);
      map.set(id, list);
    },
    /** Sorgu gerekli mi: kayıt yok ya da başarısız sorgu RETRY_MS'den eski. */
    needs(id, heading, now = Date.now()) {
      const r = find(id, heading);
      return !r || (!r.verified && now - r.at >= RETRY_MS);
    },
    clear: () => map.clear(),
    size: () => map.size,
  };
}

/**
 * Planlamaya giren istasyon listesine yol ağı sonuçlarını uygula (saf). headingAt(s): rotanın istasyondaki gidiş yönü.
 * - Doğrulanmış ve erişilebilir: offKm = max(düz çizgi, sapma / 2) (planlayıcı sapmayı gidiş + dönüş için 2 ile çarpar); access alanı eklenir.
 * - Doğrulanmış ve erişilemez: kimliği `blocked` listesine girer (keep içindekiler hariç: kullanıcının elle seçtiği durak; maliyetle kalır).
 * - Doğrulanmamış: aynen kalır (access.verified=false yalnızca sorgu başarısızsa).
 * Dönüş: { stations, blocked }.
 */
export function applyAccess(stations, book, headingAt, keep = new Set()) {
  const blocked = [];
  const out = (stations || []).map((s) => {
    const h = headingAt(s);
    const r = Number.isFinite(h) ? book.get(s.id, h) : null;
    if (!r) return s;
    if (!r.verified) return { ...s, access: { verified: false, reason: r.reason || null } };
    if (!r.ok && !keep.has(s.id)) blocked.push(s.id);
    return { ...s, geoOffKm: s.geoOffKm ?? s.offKm, offKm: Math.max(s.geoOffKm ?? s.offKm ?? 0, r.detourKm / 2), access: { verified: true, ok: r.ok, detourKm: r.detourKm } };
  });
  return { stations: out, blocked };
}

/**
 * İleri durakları yol ağıyla doğrula ve kayda yaz. probe({ a, station, b }) → yol ağı uzunluğu (km) ya da hata fırlatır.
 * Dönüş: { checked, rejected: [istasyon], failed: [istasyon] }. Sorgular paralel; biri başarısız olsa da öbürleri kaydedilir.
 */
export async function verifyStops({ coords, stops, fromKm = 0, book, probe, now = () => Date.now() }) {
  const cum = lineKm(coords || []);
  const jobs = [];
  for (const st of stops || []) {
    const s = st?.station;
    if (!s || !(st.km > fromKm + 0.5)) continue;
    const pr = accessProbe(coords, { ...s, km: st.km }, { cum });
    if (!pr || !book.needs(s.id, pr.at.heading, now())) continue;
    jobs.push({ s, pr });
  }
  const rejected = [];
  const failed = [];
  await Promise.all(jobs.map(async ({ s, pr }) => {
    let routedKm;
    try {
      routedKm = await probe({ a: pr.a, station: { lat: s.lat, lon: s.lon }, b: pr.b });
      if (!Number.isFinite(routedKm)) throw new Error('yol ağı yanıtı boş');
    } catch (err) {
      book.put(s.id, { heading: pr.at.heading, verified: false, ok: null, detourKm: null, at: now(), reason: err?.message || String(err) });
      failed.push(s);
      return;
    }
    const v = judgeAccess({ routedKm, alongKm: pr.alongKm, geoOffKm: pr.at.offKm });
    book.put(s.id, { heading: pr.at.heading, verified: true, ok: v.ok, detourKm: v.detourKm, side: pr.at.side, at: now() });
    if (!v.ok) rejected.push(s);
  }));
  return { checked: jobs.length, rejected, failed };
}
