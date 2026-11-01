// Çeviri anahtar listesini üretir: i18n/keys.json = index.html metinleri + JS dizeleri (scripts/i18n-extract.mjs çıktısı, kimlik/URL/önbellek anahtarları elenerek).
// Kaynak dil Türkçedir; anahtar = Türkçe metin ({0}, {1} = değişen parçalar). Önce: node scripts/i18n-extract.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const dec = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENT[m]);
const LETTER = /\p{L}/u;

// ---- HTML ----
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
const out = new Map(); // key → kaynak
const add = (s, src) => { const t = norm(dec(s)); if (t.length >= 1 && LETTER.test(t) && !out.has(t)) out.set(t, src); };
for (const m of html.matchAll(/\s(?:title|placeholder|aria-label|data-title|alt|label)="([^"]*)"/g)) add(m[1], 'html-attr');
for (const part of html.split(/<[^>]+>/)) add(part, 'html');

// ---- JS ----
const cand = JSON.parse(readFileSync(join(root, 'i18n', 'candidates-js.json'), 'utf8'));
const DENY = [
  /^(mbc|mrt|ort|oac|nom|org|ovp|ocm|nearO|oel|owx|sl|stop|socket|my|rgb|scale|spin|ofm):?[{(]/, /^\{0\}[?/]/, /^[&?]/, /^\[out:/, /^version\.js/, /^output\[/, /^translateY/, /^<svg/, /^scale\(/,
  /^[aıoueiöü]+$/, /^nı$/, /^\{0\}\{1\}/, /^mbc:/, /^socket:/, /^stop:/, /^sl:/, /^HTTP \{0\}$/, /^Photon HTTP/, /^Nominatim HTTP/, /^Overpass HTTP/, /^OpenChargeMap HTTP/, /^Open-Meteo HTTP/, /^Mapbox HTTP/,
];
for (const { key, where } of cand) {
  if (DENY.some((re) => re.test(key))) continue;
  if (/^[\p{L}\d{}_]*[:|>]\{/u.test(key) && !/\s/.test(key)) continue; // önbellek anahtarları
  add(key, where[0]);
}

const skip = (s) => s.startsWith('api.') || s.startsWith('http') || ['ABRP', 'API Key', 'Token', 'Webhook', 'OCR', 'GPS', 'kWh', 'kW', 'km', 'Togg', 'Mapbox'].includes(s);
const keys = [...out.keys()].filter((k) => !skip(k)).sort((a, b) => a.localeCompare(b, 'tr'));
const outName = process.argv[2] || 'keys.now.json'; // keys.json dondurulmuştur (çeviri ajanları okur); yeni çıkarım keys.now.json'a yazılır
writeFileSync(join(root, 'i18n', outName), JSON.stringify(keys, null, 1));
writeFileSync(join(root, 'i18n', 'keys-source.now.json'), JSON.stringify(Object.fromEntries(keys.map((k) => [k, out.get(k)])), null, 1));
console.log(`${keys.length} anahtar (HTML: ${[...out.values()].filter((v) => v.startsWith('html')).length}, JS: ${[...out.values()].filter((v) => !v.startsWith('html')).length})`);
