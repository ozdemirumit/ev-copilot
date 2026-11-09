// ABRP (A Better Routeplanner, canlı telemetri köprüsü) durum rozeti: üst şeritte kısa ve doğru metin, yeniden açılışta "pasif" yalanı yok, sağ yığındaki düğme var olan sayfayı açar.
// Kullanım: node scripts/test-abrp-status.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Tarayıcı taklidi (modüller yüklenmeden önce). Kayıt: telemetri açık, anahtarlar girilmiş (uygulama yeniden açılmış gibi)
const stored = new Map([['evcp.abrp', JSON.stringify({ token: 'x', apikey: 'y', webhook: '', enabled: true })]]);
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const els = new Map();
const makeEl = () => ({ value: '', checked: false, className: '', textContent: '', title: '', type: 'text', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, setAttribute() {}, addEventListener() {} });
globalThis.document = {
  documentElement: { lang: 'tr' },
  body: { classList: { contains: () => true } },
  getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...makeEl(), getContext: () => ({}) }),
};

const { getState, patch } = await import('../js/state.js');
const { abrpBadge } = await import('../js/ui/statusBadges.js');
const { initAbrpPanel } = await import('../js/ui/abrpPanel.js');

// Durumdan kısa rozete: tek tek telemetri metinleri (js/abrp/telemetry.js) şeridi taşırmaz
const cases = [
  [{ status: 'idle', text: 'Pasif' }, 'ABRP: pasif', ''],
  [{ status: 'idle', text: 'Premium gerekli' }, 'ABRP: pasif', ''],
  [{ status: 'wait', text: 'Beklemede' }, 'ABRP: bekliyor', 'wait'],
  [{ status: 'wait', text: 'Veri bekleniyor (pil/konum)' }, 'ABRP: bekliyor', 'wait'],
  [{ status: 'wait', text: 'Pil okuması eski — OCR / kamera kontrol et' }, 'ABRP: bekliyor', 'wait'],
  [{ status: 'wait', text: 'Gönderildi (yanıt okunamıyor)', http: 'opaque' }, 'ABRP: gönderildi', 'wait'],
  [{ status: 'ok', text: '200 OK', http: 200 }, 'ABRP: bağlı', 'ok'],
  [{ status: 'err', text: 'Hata 401 Invalid token', http: 401 }, 'ABRP: hata', 'err'],
  [{ status: 'err', text: 'Token / API Key eksik' }, 'ABRP: hata', 'err'],
];
for (const [a, text, cls] of cases) {
  const [t, c] = abrpBadge(a);
  ok(`${a.status} / ${a.text} → ${text}`, t === text && c === cls, `${t} [${c}]`);
}

// Gerçek panel: açılışta kayıtlı gönderim açıksa rozet "pasif" demez (ilk paket 60 sn sonra gider)
initAbrpPanel();
const top = els.get('bd-abrp');
ok('kayıtlı gönderim açıkken açılışta pasif görünmez', getState('abrp').enabled && top.textContent === 'ABRP: bekliyor' && top.className.trim() === 'badge wait', `${top.textContent} [${top.className}]`);
ok('anahtar konumu korunur', els.get('abrp-enabled').checked === true);
ok('anahtarlar alanlara geri yüklenir', els.get('abrp-token').value === 'x' && els.get('abrp-apikey').value === 'y');

// Canlı güncelleme; ayrıntı rozetin başlığında ve ABRP sayfasında kalır
patch('abrp', { status: 'ok', text: '200 OK', http: 200, lastSentAt: Date.now() });
ok('başarılı gönderimde bağlı', top.textContent === 'ABRP: bağlı' && top.className.trim() === 'badge ok', top.textContent);
ok('ham ayrıntı başlıkta', top.title === '200 OK', top.title);
ok('ABRP sayfası tam metni göstermeye devam eder', els.get('abrp-badge').textContent === '200 OK', els.get('abrp-badge').textContent);
ok('HTTP alanı dolu', els.get('abrp-http').textContent === '200');
patch('abrp', { status: 'err', text: 'Hata 401 Invalid token', http: 401 });
ok('hata kısa rozet, tam metin başlıkta', top.textContent === 'ABRP: hata' && top.title === 'Hata 401 Invalid token', top.textContent);
patch('abrp', { enabled: false, status: 'idle', text: 'Pasif', http: null, webhook: null });
ok('kapatılınca pasif', top.textContent === 'ABRP: pasif' && top.className.trim() === 'badge', top.textContent);

// Yapı: şerit ve sağ yığın var olan kimlikleri kullanır; ABPR/ANPR diye yeni bir şey yok
const html = read('index.html');
const row = html.slice(html.indexOf('id="statusrow"'), html.indexOf('id="banners"'));
ok('rozet üst durum şeridinde, tek', row.includes('id="bd-abrp"') && html.split('id="bd-abrp"').length === 2);
const stack = html.slice(html.indexOf('id="fabs-more"'), html.indexOf('id="fab-stopnav"'));
const btn = stack.match(/<button[^>]*data-tab="abrp"[^>]*>/)?.[0] || '';
ok('sağ yığın düğmesi var olan ABRP sayfasını açar, Premium kısıtlı', btn.includes('data-premium-only') && btn.includes('aria-label="ABRP"') && html.includes('id="tab-abrp"'), btn);
ok('alan kimlikleri ve depolama anahtarı değişmedi', ['abrp-enabled', 'abrp-token', 'abrp-apikey', 'abrp-webhook'].every((id) => html.split(`id="${id}"`).length === 2) && /load\('abrp'/.test(read('js/ui/abrpPanel.js')) && /save\('abrp'/.test(read('js/ui/abrpPanel.js')));
ok('yanlış ad yok', !/abpr|anpr/i.test(html + read('js/ui/abrpPanel.js') + read('js/ui/statusBadges.js')));

// Çeviri: yeni rozet metinleri her dilde
const keys = ['ABRP: bağlı', 'ABRP: gönderildi', 'ABRP: bekliyor', 'ABRP: hata'];
for (const l of ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'bg']) {
  const dict = (await import(`../js/i18n/lang/${l}.extra.js`)).default;
  const miss = keys.filter((k) => !dict[k]);
  ok(`${l}: ABRP rozet çevirileri`, !miss.length, miss.join(' | '));
}
const list = JSON.parse(read('i18n/keys.extra.json'));
ok('anahtar listesinde', keys.every((k) => list.filter((x) => x === k).length === 1));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
