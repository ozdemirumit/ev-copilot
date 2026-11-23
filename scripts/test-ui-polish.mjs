// Arayüz cilası: Rota ve İstasyonlar panellerinde tek çizgi simge dili (emoji yok), 11 dilde dil sızıntısı yok, sprite simgeleri tanımlı.
// Kaynak denetimi + gerçek i18n çekirdeği. Kullanım: node scripts/test-ui-polish.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const html = read('index.html');
const EMOJI = /\p{Extended_Pictographic}/u;
const section = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const route = section('<section class="tab" id="tab-route"', '<section class="tab" id="tab-range"');
const stations = section('<section class="tab" id="tab-stations"', '<section class="tab" id="tab-abrp"');

// ---- A) Emoji yok (gizli eski adım düğmesi btn-nav hariç)
const stripLegacy = (s) => s.replace(/<button[^>]*id="btn-nav"[^>]*>[\s\S]*?<\/button>/, '');
const visible = (s) => stripLegacy(s).replace(/<!--[\s\S]*?-->/g, '').replace(/<symbol[\s\S]*?<\/symbol>/g, '');
ok('A1 Rota panelinde emoji yok', !EMOJI.test(visible(route)));
ok('A2 İstasyonlar panelinde emoji yok', !EMOJI.test(visible(stations)));

// ---- B) Kullanılan her simge sprite'ta tanımlı
const defined = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1]));
const used = (s) => [...s.matchAll(/href="#i-([\w-]+)"/g)].map((m) => m[1]);
const iconSrc = read('js/ui/icons.js') + read('js/ui/places.js') + read('js/ui/stationsView.js') + read('js/ui/routePanel.js');
const jsUsed = [...iconSrc.matchAll(/(?:iconLabel\((?:\w+|text\('button', 'btn ghost sm', ''\)), '|ic: ')([\w-]+)'/g)].map((m) => m[1]);
ok('B1 HTML simgelerinin hepsi tanımlı', [...used(route), ...used(stations)].every((n) => defined.has(n)));
ok('B2 JS simgelerinin hepsi tanımlı (iconLabel / places ic)', jsUsed.length >= 8 && jsUsed.every((n) => defined.has(n)));
const NEW = ['clock', 'coin', 'scale', 'refresh', 'eraser', 'trash', 'swap', 'plus', 'home', 'briefcase'];
ok('B3 yeni simgeler tanımlı, currentColor çizgi (sprite stili .ic)', NEW.every((n) => defined.has(n)) && /\.ic \{[^}]*stroke: currentColor/.test(read('css/styles.css')));
ok('B4 simgeler dekoratif (aria-hidden) ve etiket metni span içinde', /export function iconLabel/.test(read('js/ui/icons.js')) && /aria-hidden=\\?"true\\?"/.test(read('js/ui/icons.js')) && /createElement\('span'\)/.test(read('js/ui/icons.js')));

// ---- C) Kayıtlı yer çipleri, durak satırları
const places = read('js/ui/places.js');
ok('C1 yer çipleri çizgi simgeyle (home/briefcase/star), emoji yalnız harita iğnesi/Favoriler listesinde', /iconLabel\(el\('button'/.test(places) && /ic: 'home'/.test(places) && /ic: 'briefcase'/.test(places) && /ic: 'star'/.test(places));
const css = read('css/styles.css');
ok('C2 çip satırı başlığın altında tam satır, ad kısalmaz (flex auto)', /\.rp-head \.place-chips \{[^}]*flex: 1 1 100%/.test(css) && /\.rp-head \.chip \{[^}]*flex: 1 1 auto/.test(css));
const sv = read('js/ui/stationsView.js');
ok('C3 satır etiketi/ayrıntı parçaları ayrı çevrilir (t/tr), bileşik Türkçe+İngilizce dizge yok', /t\('Planda #\{0\}', n\)/.test(sv) && /t\('varış %\{0\} → %\{1\}'/.test(sv) && /tr\('AC\/yavaş'\)/.test(sv) && !/Planda #\$\{n\}/.test(sv));
ok('C4 uyarı bandı parçaları tr() ile', /tr\(none \? 'Hiç istasyon alınamadı\.' : 'Liste eksik olabilir\.'\)/.test(sv));

// ---- D) 11 dil: yeni düz anahtarlar var, emoji yok, yer tutucular tutarlı
const LANGS = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'bg'];
const PLAIN = ['Ara', 'Ekle', 'Kaldır', 'Haritada', 'Ev', 'En yakın', 'En ucuz', 'Optimum', 'Navigasyon', 'Sesi dene', 'Temizle', 'Hızlı', 'Ekonomik', 'Değiştir',
  'Rota boyunca hava', 'Yakınımdaki istasyonlar', 'İstasyonları yeniden ara', 'Konumumu başlangıç yap', 'Durakları haritada göster', 'Bulunduğum yeri ekle',
  'Ara durak ekle', "Google Haritalar'da aç (duraklarla)", 'Yakındakileri sırala', 'Şarj markası tercihi', 'Plan modu', 'Bu markayı listeden çıkar',
  '{0} km ileride', 'varış %{0}', 'varış %{0} → %{1}', 'Şarj hedefi %{0}', '(elle seçildi)', "Tahmini toplam menzil (%0'a kadar)"];
const ph = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
const dicts = {};
for (const l of LANGS) dicts[l] = { ...(await import(pathToFileURL(join(root, `js/i18n/lang/${l}.js`)).href)).default, ...(await import(pathToFileURL(join(root, `js/i18n/lang/${l}.extra.js`)).href)).default };
for (const l of LANGS) {
  const miss = PLAIN.filter((k) => !(k in dicts[l]) || !String(dicts[l][k]).trim());
  ok(`D1 ${l}: düz anahtarların hepsi çevrili (eksik: ${miss.join(' | ') || 'yok'})`, miss.length === 0);
  ok(`D2 ${l}: çeviride emoji yok, yer tutucular kaynakla aynı`, PLAIN.every((k) => !EMOJI.test(dicts[l][k] || '') && ph(k) === ph(dicts[l][k] || '')));
}
// Eski emojili anahtarlar kaldırıldı (başka yerde kullanılmayanlar); hâlâ kullanılan emojili anahtarlar duruyor
for (const k of ['🔄 Ara', '📍 Yakınımdaki istasyonlar', '➕ Ekle', '🧹 Temizle']) ok(`D3 eski emojili anahtar kaldırıldı: ${k}`, LANGS.every((l) => !(k in dicts[l])));
for (const k of ['🗑️ Kaldır', '🔁 Değiştir', '⚖️ Optimum']) ok(`D4 başka yerde (kart / rota seçenekleri) kullanılan emojili anahtar duruyor: ${k}`, LANGS.every((l) => k in dicts[l]));

// ---- E) İngilizce (gerçek tr() yolu): Rota/İstasyonlar/üst şerit metinleri çevrilir
globalThis.localStorage = { getItem: () => JSON.stringify('en'), setItem() {} };
const i18n = await import(pathToFileURL(join(root, 'js/i18n/index.js')).href + '?polish');
i18n.__test.compile(dicts.en);
const MUST = ['En yakın', 'En ucuz', 'En hızlı', 'Ev', 'İş', 'Yakındakileri sırala', 'Şarj markası tercihi', 'Plan modu', 'Optimum', 'Navigasyon',
  'Rota seçeneklerini karşılaştır (Hızlı / Ekonomik / Optimum)', 'Tüm hızlı istasyonlar ve yedek AC', 'Bu markayı listeden çıkar',
  'Togg T10X V2 Uzun Menzil (88,5 kWh)', 'Togg T10X V2 Standart Menzil (52,4 kWh)', "Tahmini toplam menzil (%0'a kadar)",
  'Fiyatı bilinmeyen ya da tahmini olanlar etiketlidir ve En ucuz sıralamasında bilinen fiyatlardan sonra gelir; "tahmini" kW istasyon kaydında yazmıyor. Eski doluluk bilgisi boş sayılmaz. Pil ve süre tahmini kuş uçuşu mesafenin ×1,35\'i yol varsayımıyla hesaplanır.'];
for (const s of MUST) { const o = i18n.tr(s); ok(`E1 en: çevrildi ve Türkçe harf kalmadı: ${s.slice(0, 40)}`, o !== s && !/[çğıöşüÇĞİÖŞÜ]/.test(o.replace(/Fiyat/g, ''))); }
ok('E2 en: "Planda #2" parçaları bileşik dizgeyi bozmaz', i18n.t('Planda #{0}', 2) + ' · ' + i18n.tr('tercih dışı') === '#2 in plan · not preferred');
ok('E3 en: varış parçaları', i18n.t('varış %{0} → %{1}', '45', 80) === 'arrival 45% → 80%' && i18n.t('{0} km ileride', '12') === '12 km ahead');
ok('E4 en: paragraf bütün anahtarla eşleşir (kısmi desen bozmaz)', !/^In /.test(i18n.tr(MUST[MUST.length - 1])));

// v0.99.130: Gelişmiş seçenekler sağında +/− düğmesi (diğer kartlardaki .tog görünümü), varsayılan ok işareti gizli
{
  const css = read('css/styles.css');
  ok('F1 Gelişmiş seçenekler özeti: sağda + (kapalı) ve − (açık) düğmesi, 44 px dokunma alanı, varsayılan ok yok', /#route-adv > summary::after \{ content: '\+';[^}]*width: 44px; height: 44px;/.test(css) && /#route-adv\[open\] > summary::after \{ content: '\\2212'; \}/.test(css) && /#route-adv > summary::-webkit-details-marker \{ display: none; \}/.test(css) && /#route-adv > summary \{[^}]*justify-content: space-between;[^}]*list-style: none;/.test(css));
  ok('F2 Gelişmiş seçenekler hâlâ <details> (klavye/ekran okuyucu ile açılır)', /<details class="card stack" id="route-adv">\s*<summary>/.test(html));
}

console.log(`\ntest-ui-polish: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
