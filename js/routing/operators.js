import { DEFAULT_OPERATORS, OLD_DEFAULT_PRICES } from '../config.js';
import { load, save, remove } from '../utils/storage.js';

// Keşfedilen markalar: istasyon verisinde (OSM/OCM/HERE/Mapbox) işletmeci olarak görülen ama sabit listede olmayan adlar.
// Listeye 'Diğer'in önüne, 'Diğer'in fiyatıyla eklenir; fiyat/kW tablosundan düzeltilir, istenmeyen silinebilir.
const FOUND_KEY = 'discoveredOps';
const IGNORED_KEY = 'ignoredOps';
const MAX_FOUND = 40;

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const GENERIC = /^(ac|dc|ev|evse|şarj|sarj|şarj istasyonu|sarj istasyonu|şarj noktası|charging|charging station|charging point|charge|charger|electric|elektrik|elektrikli|elektrikli araç şarj|istasyon|station|unknown|bilinmiyor|private|public|özel|n\/a|none|yok|yes|no)$/i;
const LEGAL = /(?<![\p{L}\d])(a\.?\s?ş\.?|ltd\.?|şti\.?|sti\.?|san\.?|tic\.?|inc\.?|gmbh|llc|b\.v\.?|s\.a\.?|ve|ticaret|sanayi|anonim|şirketi)(?![\p{L}\d])/giu;

/** Ham işletmeci adını temiz marka adına çevir; marka gibi görünmüyorsa null. */
export function cleanBrand(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.split(/[;|/]/)[0].replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 28) return null;
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]{3}/.test(s)) return null;
  if (GENERIC.test(s.toLocaleLowerCase('tr')) || /https?:|www\.|@/i.test(s)) return null; // 'tr' küçük harf: İ → i
  if (/tesla/i.test(s)) return null; // Tesla ayrıca ele alınır
  if ((s.match(/\d/g) || []).length > s.length / 2) return null;
  return s;
}

// İşletmecilerin yayımladığı genel kWh tarifeleri (sunucu → VeriApi.Pro, js/routing/tariffs.js): sabit listedeki tahmini fiyatın yerine geçer.
// Kullanıcı DC fiyatını kendisi değiştirmediyse uygulanır (AC fiyatı zaten düzenlenemez). 14 günden eskiyse yok sayılır.
const PUB_KEY = 'tariffsPub';
const PUB_MAX_AGE_MS = 14 * 86400e3;
const fold = (x) => String(x || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '');
let pub = load(PUB_KEY, null); // { at, rows: [{ code, name, ac, dc }] }
const okPrice = (v) => (typeof v === 'number' && v > 0 && v < 100 ? v : null);
/** Operatörlere { price, acPrice } ekle (adı birebir eşleşen; "Ovolt (Sharz.net)" gibi parantezli adlarda parantez dışı). Tablo yoksa ya da eskiyse kaldırır. */
function attachPub(ops) {
  const fresh = pub?.rows?.length && Date.now() - pub.at < PUB_MAX_AGE_MS;
  for (const o of ops) {
    delete o.pub;
    if (!fresh || o.found || o.id === 'other') continue;
    const keys = new Set(o.match.map(fold));
    const row = pub.rows.find((r) => keys.has(fold(String(r.name).split('(')[0])) || keys.has(fold(r.code)));
    const price = okPrice(row?.dc);
    const acPrice = okPrice(row?.ac);
    if (price != null || acPrice != null) o.pub = { price, acPrice, at: pub.at };
  }
  return ops;
}
/** Sunucudan gelen tarife tablosunu kaydet ve uygula. */
export function setPublishedTariffs(rows, at = Date.now()) {
  if (!Array.isArray(rows) || !rows.length) return;
  pub = { at, rows: rows.filter((r) => r && typeof r.name === 'string').map((r) => ({ code: String(r.code || ''), name: r.name, ac: okPrice(r.ac), dc: okPrice(r.dc) })) };
  save(PUB_KEY, pub);
  attachPub(operators);
  changed();
}
export const publishedTariffsAt = () => (pub?.at && Date.now() - pub.at < PUB_MAX_AGE_MS ? pub.at : null);

const foundOp = (name, other) => ({ id: 'f-' + slug(name), name, price: other.price, acPrice: other.acPrice, kw: other.kw, match: [name.toLowerCase()], found: true });

let found = []; // [{ name }]
const listeners = new Set();
export const onOperatorsChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* arayüz hatası sınıflandırmayı bozmasın */ } });

// Kayıtlı tabloyu varsayılanlarla ve keşfedilenlerle birleştir: sonradan eklenen operatörler eski kayıtta eksik kalmasın. 'Diğer' hep sonda.
function build(saved) {
  const base = structuredClone(DEFAULT_OPERATORS);
  const other = base.pop();
  // Sonradan sabit listeye giren marka, keşfedilenler arasında kalmış olabilir: sabit liste önce eşleşir, tekrar satır olmasın
  const dup = (name) => base.some((b) => b.match.some((m) => name.toLowerCase().includes(m)));
  const all = [...base, ...found.filter((f) => !dup(f.name)).map((f) => foundOp(f.name, other)), other];
  if (!Array.isArray(saved)) return all;
  return all.map((d) => {
    const s = saved.find((x) => x.id === d.id);
    if (!s) return d;
    const untouched = !d.found && (OLD_DEFAULT_PRICES[d.id] || []).includes(s.price); // eski varsayılan fiyat: kullanıcı değiştirmediyse yeni liste tarifesine geç
    return { ...d, price: untouched ? d.price : s.price, kw: s.kw };
  });
}

const savedFound = load(FOUND_KEY, null);
found = Array.isArray(savedFound) ? savedFound.filter((f) => f && cleanBrand(f.name) === f.name).slice(0, MAX_FOUND) : [];
let operators = attachPub(build(load('operators', null)));

export const getOperators = () => operators;
export const operatorById = (id) => operators.find((o) => o.id === id) || operators.at(-1);

export function persistOperators() {
  save('operators', operators.map(({ id, price, kw }) => ({ id, price, kw })));
}

export function resetOperators() {
  operators = attachPub(build(null));
  remove('operators');
}

/** Keşfedilen bir markayı listeden çıkar ve bir daha ekleme. */
export function removeDiscovered(id) {
  const op = operators.find((o) => o.id === id && o.found);
  if (!op) return;
  found = found.filter((f) => 'f-' + slug(f.name) !== id);
  save(FOUND_KEY, found);
  save(IGNORED_KEY, [...new Set([...load(IGNORED_KEY, []), id])]);
  operators = operators.filter((o) => o.id !== id);
  persistOperators();
  changed();
}

function discover(raw) {
  const name = cleanBrand(raw);
  if (!name) return null;
  const id = 'f-' + slug(name);
  if (!slug(name) || found.length >= MAX_FOUND || load(IGNORED_KEY, []).includes(id)) return null;
  if (operators.some((o) => o.id === id)) return id;
  const op = foundOp(name, operators.at(-1));
  found.push({ name });
  save(FOUND_KEY, found);
  operators.splice(operators.length - 1, 0, op); // 'Diğer' sonda kalır
  persistOperators();
  changed();
  return id;
}

/**
 * İstasyon etiketlerinden (ilk: istasyon adı; sonrakiler: operator/brand/network) operatör kimliği bul.
 * Sabit listede yoksa ve işletmeci/marka alanı marka gibiyse listeye eklenir (keşfedilen marka); yoksa 'other'.
 */
export function classify(...names) {
  const text = names.filter(Boolean).join(' ').toLowerCase();
  const hit = operators.find((o) => o.match.some((m) => text.includes(m)));
  if (hit) return hit.id;
  for (const n of names.slice(1)) {
    const id = discover(n);
    if (id) return id;
  }
  return 'other';
}
