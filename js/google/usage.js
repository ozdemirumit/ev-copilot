// Google Maps Platform çağrı sayacı (SKU bazında, bu cihazda, takvim ayı) ve tahmini maliyet.
// Yalnızca bu cihazdan çıkan ve Google'ın kabul ettiği (başarılı) istekler sayılır; önbellekten gelenler Google'a gitmediği için sayılmaz.
// Fiyat ve ücretsiz kota: Google Maps Platform fiyat listesi (1000 çağrı başına USD). Rakamlar TAHMİNDİR:
// gerçek fatura için Cloud Console > Faturalandırma > Raporlar (SKU'ya göre grupla). 100 bin üstü kademeli indirimler yok sayılır.
import { load, save } from '../utils/storage.js';
import { toast } from '../ui/toast.js';

export const SKUS = {
  maps: { label: 'Harita yükleme', price: 7, free: 10000 },
  routes: { label: 'Rota (trafikli, Pro)', price: 10, free: 5000 },
  nearby: { label: 'İstasyon arama (Nearby, Enterprise)', price: 35, free: 1000 },
  text: { label: 'İstasyon metin araması (Enterprise)', price: 35, free: 1000 },
  details: { label: 'İstasyon doluluğu (Place Details, Enterprise)', price: 20, free: 1000 },
  placeLoc: { label: 'Yer konumu (Place Details, Essentials)', price: 5, free: 10000 },
  autocomplete: { label: 'Arama önerisi (Autocomplete, üst sınır)', price: 2.83, free: 10000 },
  geocode: { label: 'Adres adı (Geocoding)', price: 5, free: 10000 },
};

const month = () => new Date().toISOString().slice(0, 7);
const listeners = new Set();
let notifyTimer = null;

function fresh() { return { m: month(), n: {}, w: {} }; }
function read() {
  const u = load('gUsage', null);
  return u?.m === month() && u.n ? u : fresh();
}
let data = read();

/** Hangi SKU? Roads sayılmaz (dönen öğe sayısını çağıran bilir); bilinmeyen adres null. */
export function skuOf(url, mask = '') {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname === 'routes.googleapis.com') return 'routes';
  if (u.hostname === 'places.googleapis.com') {
    if (u.pathname.endsWith(':searchNearby')) return 'nearby';
    if (u.pathname.endsWith(':searchText')) return 'text';
    if (u.pathname.endsWith(':autocomplete')) return 'autocomplete';
    return /evChargeOptions/.test(mask) ? 'details' : 'placeLoc';
  }
  return null;
}

/** Sonraki ödeme: ücretsiz kotayı aşan çağrılar × birim fiyat. */
export const costOf = (sku, n) => Math.max(0, n - SKUS[sku].free) * SKUS[sku].price / 1000;

function warn(sku, n) {
  const { label, free } = SKUS[sku];
  const w = (data.w[sku] ||= {});
  if (n > free && !w.over) {
    w.over = true;
    toast(`${label}: aylık ücretsiz kota (${free}) aşıldı, bundan sonrası ücretli`);
  } else if (n >= free * 0.8 && !w.near && n <= free) {
    w.near = true;
    toast(`${label}: aylık ücretsiz kotanın %80'i doldu`);
  }
}

/** n adet çağrıyı kaydet. */
export function record(sku, n = 1) {
  if (!SKUS[sku] || !(n > 0)) return;
  if (data.m !== month()) data = fresh();
  data.n[sku] = (data.n[sku] || 0) + n;
  warn(sku, data.n[sku]);
  save('gUsage', data);
  notifyTimer ||= setTimeout(() => { notifyTimer = null; listeners.forEach((fn) => fn()); }, 400);
}

/** { month, rows: [{ sku, label, n, free, price, cost }], total, since } — çağrısı olanlar, maliyete göre azalan. */
export function usageSummary() {
  if (data.m !== month()) data = fresh();
  const rows = Object.keys(SKUS)
    .map((sku) => ({ sku, ...SKUS[sku], n: data.n[sku] || 0 }))
    .filter((r) => r.n > 0)
    .map((r) => ({ ...r, cost: costOf(r.sku, r.n) }))
    .sort((a, b) => b.cost - a.cost || b.n / b.free - a.n / a.free);
  return { month: data.m, rows, total: rows.reduce((a, r) => a + r.cost, 0) };
}

export function resetUsage() {
  data = fresh();
  save('gUsage', data);
  listeners.forEach((fn) => fn());
}

export const subscribeGoogleUsage = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
