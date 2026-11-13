// RM-02 takip: Görünüm (Açık/Koyu/Otomatik) etiketleri 11 dilde çevrilir; Türkçe kaynak metin index.html'de aynen kalır.
// Her dil için i18n çekirdeği ayrı örnekle (sorgu dizesiyle yeni modül) yüklenir ve gerçek tr() yolu denetlenir.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.error('HATA:', m); } };

// index.html'deki Görünüm kartından kaynak metinleri çıkar (kod değişirse anahtarlar da güncellenmeli)
const html = readFileSync(join(root, 'index.html'), 'utf8');
const card = /<div class="card stack" id="theme-card">([\s\S]*?)<div class="card stack" id="account-card">/.exec(html)?.[1] || '';
ok(card, 'theme-card bulunamadı');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const texts = [...card.replace(/<select[^>]*>|<\/select>/g, '<x>').matchAll(/>([^<]+)</g)].map((m) => norm(m[1])).filter((s) => /\p{L}/u.test(s));
const aria = [...card.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
const SRC = {
  label: '🌓 Görünüm', aria: 'Görünüm', light: 'Açık', dark: 'Koyu', auto: 'Otomatik (sistem ayarı)',
  hint: 'Otomatik, telefonun açık/koyu ayarını izler. Harita karoları bu sürümde değişmez.',
};
// Türkçe/varsayılan davranış korunur: kaynak metinler index.html'de değişmeden durur
for (const s of [SRC.label, SRC.light, SRC.dark, SRC.auto, SRC.hint]) ok(texts.includes(s), `index.html Türkçe metni yok/değişmiş: ${s}`);
ok(aria.includes(SRC.aria), 'aria-label "Görünüm" yok');
ok(/<option value="light">Açık<\/option>/.test(card) && /<option value="dark">Koyu<\/option>/.test(card) && /<option value="auto">/.test(card), 'seçenek değerleri değişmiş');
for (const s of [...texts, ...aria]) ok(Object.values(SRC).includes(s), `kartta beklenmeyen metin: ${s}`);

const keys = JSON.parse(readFileSync(join(root, 'i18n', 'keys.extra.json'), 'utf8'));
for (const s of Object.values(SRC)) ok(keys.filter((k) => k === s).length === 1, `keys.extra.json anahtarı tek değil: ${s}`);

const { LANGS } = await import(pathToFileURL(join(root, 'js/i18n/index.js')).href);
const codes = LANGS.map((l) => l.code).filter((c) => c !== 'tr');
ok(codes.length === 11, `11 dil beklenirdi: ${codes.length}`);
ok(LANGS.some((l) => l.code === 'tr'), 'Türkçe dil listeden çıkmış');

for (const code of codes) {
  const url = pathToFileURL(join(root, 'js/i18n/index.js')).href + '?lang=' + code;
  const i18n = await import(url);
  const base = (await import(pathToFileURL(join(root, `js/i18n/lang/${code}.js`)).href)).default;
  const extra = (await import(pathToFileURL(join(root, `js/i18n/lang/${code}.extra.js`)).href)).default;
  i18n.__test.compile({ ...base, ...extra });
  const out = {};
  for (const [k, s] of Object.entries(SRC)) {
    out[k] = i18n.tr(s);
    ok(out[k] && out[k] !== s, `${code}: çevrilmedi: ${s}`);
    ok(!/[ğışĞİŞ]/.test(out[k]), `${code}: Türkçe harf kaldı: ${out[k]}`);
  }
  ok(out.label.startsWith('🌓 '), `${code}: simge korunmadı: ${out.label}`);
  ok(out.label === '🌓 ' + out.aria, `${code}: etiket ile aria-label tutarsız`);
  ok(new Set([out.light, out.dark, out.auto]).size === 3, `${code}: seçenekler ayırt edilemez`);
  ok(i18n.tr('  ' + SRC.light + '\n ') === '  ' + out.light + '\n ', `${code}: boşluklu metin düğümü çevrilmedi`);
  // Mevcut benzer anahtar bozulmadı
  ok(i18n.tr('Otomatik (1 → 50 km)') === extra['Otomatik (1 → 50 km)'], `${code}: "Otomatik (1 → 50 km)" değişti`);
}

console.log(`test-theme-i18n: ${checks - fails}/${checks} denetim geçti (${codes.length} dil)`);
process.exit(fails ? 1 : 0);
