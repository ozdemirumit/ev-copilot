// v0.99.98 — Durak başına şarj hedefi: saf yardımcılar (DOM/ağ yok). Sınırlar, durakta eklenen enerji/süre/maliyet ve
// mevcut plan ile önizlenen plan arasındaki fark. Süre, uygulamanın tek şarj eğrisinden (chargeCurve.js; üretici verisi değil, yaklaşık)
// hesaplanır; maliyet yalnızca doğrulanmış tarifede (işletmeci tarifesi 'published' ya da kullanıcının girdiği 'user') verilir, aksi hâlde null.
import { VEHICLE, PLANNER as P } from '../config.js';
import { chargeMinutes } from './chargeCurve.js';

/** Doğrulanmış tarife: işletmecinin yayımladığı güncel tarife ya da kullanıcının kendi girdiği tarife (liste/tahmini fiyat değil). */
export const verifiedTariff = (s) => !!s && !s.foreign && (s.tariffSrc === 'published' || s.tariffSrc === 'user') && Number.isFinite(s.price) && s.price > 0;

/**
 * Hedef kaydırıcısının sınırları. lo: varış pili (pil boşaltılamaz; yukarı yuvarlı), hi: araç sınırı %100.
 * userMax: kullanıcının ayarladığı durak üst sınırı (maxChargeTo); aşılabilir ama arayüz uyarır.
 */
export function targetBounds(stop, { userMax = P.maxChargeTo } = {}) {
  const lo = Math.min(100, Math.max(0, Math.ceil((stop.arriveSoc ?? 0) - 1e-9)));
  return { lo, hi: 100, userMax: Math.min(100, Math.max(lo, userMax)) };
}

export const clampTarget = (v, b) => Math.min(b.hi, Math.max(b.lo, Math.round(Number(v) || 0)));

/** Durakta varış → hedef: eklenen kWh / puan, tahmini şarj dakikası (eğri), maliyet (yalnız doğrulanmış tarifede). */
export function stopCharge(stop, target, { userMax = P.maxChargeTo } = {}) {
  const s = stop.station || {};
  const from = stop.arriveSoc ?? 0;
  const to = Math.max(from, Math.min(100, target));
  const addPct = to - from;
  const kwh = (addPct / 100) * VEHICLE.batteryNetKwh;
  const minutes = addPct > 0 ? chargeMinutes(s.kw, from, to) : 0;
  const cost = verifiedTariff(s) ? (kwh / P.billedEff) * s.price : null;
  return { from, to, addPct, kwh, minutes, cost, curve: 'approx', overUserMax: to > userMax + 1e-9 };
}

/** Kayıtlı hedefleri temizle: yalnız ilerideki duraklar (aheadIds), sayısal, 0–100'e sıkıştırılmış. */
export function sanitizeLeaveSocs(map, aheadIds) {
  const out = {};
  const ok = new Set(aheadIds || []);
  for (const [id, v] of Object.entries(map || {})) {
    if (!ok.has(id) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[id] = Math.min(100, Math.max(0, v));
  }
  return out;
}

/**
 * Mevcut plan (a) ile önizlenen plan (b) farkı. a/b: { stops, totals }.
 * Dönüş: eklenen/çıkan durak adları, ayrılışı/varışı değişen duraklar, sıra değişti mi, toplam süre (dk), varışta pil (puan) ve
 * maliyet farkı (yalnız iki plandaki tüm duraklar doğrulanmış tarifeliyse; aksi hâlde null), same: hiçbir şey değişmedi.
 */
export function planDiff(a, b) {
  const as = a?.stops || [];
  const bs = b?.stops || [];
  const aIds = new Set(as.map((s) => s.station.id));
  const bIds = new Set(bs.map((s) => s.station.id));
  const added = bs.filter((s) => !aIds.has(s.station.id)).map((s) => s.station.name);
  const removed = as.filter((s) => !bIds.has(s.station.id)).map((s) => s.station.name);
  const changed = [];
  for (const s of bs) {
    const o = as.find((x) => x.station.id === s.station.id);
    if (!o) continue;
    if (Math.abs(o.leaveSoc - s.leaveSoc) >= 0.5 || Math.abs(o.arriveSoc - s.arriveSoc) >= 0.5) {
      changed.push({ id: s.station.id, name: s.station.name, arriveFrom: o.arriveSoc, arriveTo: s.arriveSoc, leaveFrom: o.leaveSoc, leaveTo: s.leaveSoc, minFrom: o.minutes, minTo: s.minutes });
    }
  }
  const common = bs.filter((s) => aIds.has(s.station.id)).map((s) => s.station.id);
  const commonA = as.filter((s) => bIds.has(s.station.id)).map((s) => s.station.id);
  const orderChanged = common.join('|') !== commonA.join('|');
  const ta = a?.totals || {};
  const tb = b?.totals || {};
  const totalMinDelta = (tb.totalMin ?? 0) - (ta.totalMin ?? 0);
  const arriveSocDelta = (tb.arriveSoc ?? 0) - (ta.arriveSoc ?? 0);
  const allVerified = [...as, ...bs].every((s) => verifiedTariff(s.station));
  const costDelta = allVerified ? (tb.cost ?? 0) - (ta.cost ?? 0) : null;
  const same = !added.length && !removed.length && !changed.length && !orderChanged && Math.abs(totalMinDelta) < 0.5 && Math.abs(arriveSocDelta) < 0.5;
  return { added, removed, changed, orderChanged, totalMinDelta, arriveSocDelta, costDelta, same };
}
