// Şarj istasyonu ortak işlevleri: kullanıcının kendi istasyonları, operatör düzeltmesi/fiyat, yinelenen ayıklama, rotaya izdüşüm.
// Veri OpenStreetMap/OpenChargeMap'ten osm/chargers.js ile gelir. Fiyat kaynaklarda yoktur: operatör tablosundan (kullanıcının
// düzenlediği değerler) atanır. Kullanıcının elle eklediği istasyonlar ("Kendi istasyonlarım") da aday olur.
import { PLANNER } from '../config.js';
import { operatorById } from './operators.js';
import { haversineKm } from '../utils/geo.js';
import { load, save } from '../utils/storage.js';

// ---------- Kullanıcının kendi istasyonları ----------
const CUSTOM_KEY = 'customStations';
export const getCustomStations = () => load(CUSTOM_KEY, []);
export function addCustomStation({ name, lat, lon, opId, kw }) {
  const list = getCustomStations();
  list.push({ id: `my${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name || 'Benim istasyonum', lat, lon, opId, kw: kw || null });
  save(CUSTOM_KEY, list);
}
export function removeCustomStation(id) {
  save(CUSTOM_KEY, getCustomStations().filter((c) => c.id !== id));
}
export const customRaw = () => getCustomStations().map((c) => ({
  id: c.id, name: c.name, lat: c.lat, lon: c.lon, opId: c.opId, srcKw: c.kw, uncertain: !c.kw, slow: false, src: 'Benim',
}));

// Kullanıcının istasyon başına operatör düzeltmeleri { istasyonId: operatörId } (adlardan operatör tahmini yanlış olabilir).
const OVERRIDE_KEY = 'stationOps';
const overrides = () => load(OVERRIDE_KEY, {});

export function setStationOperator(stationId, opId) {
  const o = overrides();
  if (opId) o[stationId] = opId; else delete o[stationId];
  save(OVERRIDE_KEY, o);
}

/** Operatörü (varsa kullanıcı düzeltmesiyle) uygulayıp fiyat/kW'yi ata. */
export function priced(s) {
  const ov = overrides()[s.id];
  const op = operatorById(ov || s.opId);
  return { ...s, opId: ov || s.opId, opRaw: s.opRaw ?? s.opId, corrected: !!ov, opName: op.name, price: op.price, kw: ov ? op.kw : (s.srcKw ?? op.kw) };
}

/**
 * Yinelenenleri ele: ~80 m içinde AYNI operatörün ikinci kaydı atılır. Farklı operatörler aynı noktada olabilir
 * (ör. Astor + Trugo yan yana): ikisi de aday kalır. Operatörü bilinmeyen ("Diğer") kayıt, aynı noktadaki bilinen
 * operatör kaydının kopyası sayılır.
 */
export function dedupe(raw) {
  const out = [];
  for (const s of raw) {
    const near = out.filter((o) => haversineKm(o, s) < 0.08);
    if (near.some((o) => o.opId === s.opId)) continue;
    if (s.opId === 'other' && near.length) continue;
    for (const o of near) if (o.opId === 'other') out.splice(out.indexOf(o), 1);
    out.push(s);
  }
  return out;
}

export function finalize(raw, profile) {
  const list = [];
  for (const s of dedupe(raw)) {
    const { km, offKm } = profile.project(s.lat, s.lon);
    if (offKm > PLANNER.corridorM / 1000 + 0.5) continue;
    list.push(priced({ ...s, km, offKm }));
  }
  list.sort((a, b) => a.km - b.km);
  if (list.length <= PLANNER.maxStations) return list;
  // Çok istasyonlu rotada en güçlüleri global seçmek seyrek bölgeleri (az ama gerekli istasyon) silerdi:
  // her 15 km'lik dilimde en güçlü 2 istasyon korunur, sonra kalan kota güce göre doldurulur.
  const keep = new Set();
  const bins = new Map();
  [...list].sort((a, b) => b.kw - a.kw).forEach((s) => {
    const b = Math.floor(s.km / 15);
    const n = bins.get(b) || 0;
    if (n < 2) { bins.set(b, n + 1); keep.add(s); }
  });
  const rest = list.filter((s) => !keep.has(s)).sort((a, b) => b.kw - a.kw);
  const out = [...keep];
  for (const s of rest) if (out.length < PLANNER.maxStations) out.push(s);
  return out.sort((a, b) => a.km - b.km);
}

/** Arama özeti: kaynak kaç kayıt döndürdü, neden elendi, 100 km başına kaç aday kaldı (eksik bölgeleri göstermek için). */
export function summarize(stations, profile, ctx) {
  const bins = [];
  for (let b = 0; b * 100 < profile.totalKm; b++) bins.push(0);
  stations.forEach((s) => { bins[Math.min(bins.length - 1, Math.floor(s.km / 100))]++; });
  return {
    raw: ctx?.raw ?? 0, kept: stations.length, drop: ctx?.drop ?? {}, calls: ctx?.calls ?? 0,
    textCalls: ctx?.textCalls ?? 0, textFound: ctx?.textFound ?? 0, bins,
  };
}

/** Rota değişti (yeniden rota): mevcut istasyonları yeni rotaya izdüşür, koridor dışını ele. Ağ çağrısı yok. */
export function reproject(stations, profile) {
  const out = [];
  for (const s of stations) {
    const { km, offKm } = profile.project(s.lat, s.lon);
    if (offKm <= PLANNER.corridorM / 1000 + 0.5) out.push({ ...s, km, offKm });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** Operatör tablosu değişince fiyat/kW'yi yeniden uygula (ağ çağrısı yok). */
export function reprice(stations) {
  return stations.map((s) => priced({ ...s, opId: s.opRaw ?? s.opId }));
}
