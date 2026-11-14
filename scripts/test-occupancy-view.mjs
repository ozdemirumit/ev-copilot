// BL-P2-09 aşama 2A: js/ui/occupancyView.js yalıtılmış doluluk görüntü bileşeni — çevrimdışı, sentetik veri.
// node scripts/test-occupancy-view.mjs  (ağ yok, anahtar yok, sağlayıcı çağrısı yok; DOM sahte document ile)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildOccupancyView, renderOccupancyView, VIEW_TEMPLATES } = await import(pathToFileURL(join(root, 'js/ui/occupancyView.js')).href);
const { buildAvailability } = await import(pathToFileURL(join(root, 'server/availability.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const NOW = 1_800_000_000_000;
const MIN = 60e3;
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const av = (o) => buildAvailability({ fetchedAt: NOW, now: NOW, ...o });
const slots = (o) => deepFreeze({ total: null, available: null, out: 0, at: null, checked: NOW, src: null, price: null, community: null, availability: null, ...o });
const view = (s, opts = {}) => buildOccupancyView(s, { now: NOW, ...opts });
const LIVE = /canlı/;
const STATUS = /boş|dolu \(|arızalı/;

// ---------- Sahte document (yalnızca bileşenin kullandığı yüzey) ----------
class Node_ { constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this._text = ''; this.translate = true; }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof Node_ ? c.textContent : c.text)).join(''); }
  all() { return this.children.filter((c) => c instanceof Node_).flatMap((c) => [c, ...c.all()]); } }
const doc = { createElement: (t) => new Node_(t) };
const byClass = (n, cls) => n.all().filter((c) => c.className.split(' ').includes(cls));

// ---------- 1) Veri yok → bölüm gizli ----------
{
  for (const [name, s] of [['null', null], ['undefined', undefined], ['boş slots', slots({})], ['dizi', []], ['availability dizi', slots({ availability: [] })]]) {
    const m = view(s);
    ok(`veri yok (${name}) → hidden`, m.hidden === true && m.official === null && m.community.length === 0, JSON.stringify(m));
    ok(`veri yok (${name}) → render null`, renderOccupancyView(m, doc) === null);
  }
  ok('model yok → render null', renderOccupancyView(null, doc) === null);
  ok('document yok → render null', renderOccupancyView(view(slots({ community: { busy: 1 } })), null) === null);
}

// ---------- 2) Taze, sağlayıcı zamanlı: tek canlı durum ----------
{
  const m = view(slots({ availability: av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - 3 * MIN }, { status: 'CHARGING', at: NOW - 5 * MIN }] }) }));
  const o = m.official;
  ok('taze → görünür', m.hidden === false && o && o.state === 'free' && o.confirmed === true, JSON.stringify(m));
  ok('durum metni ayrı', o.statusText === '🟢 1/2 boş', o.statusText);
  ok('tazelik metni ayrı: 3 dk önce · canlı', o.freshnessText === '3 dk önce · canlı', o.freshnessText);
  ok('kaynak metni ayrı', o.sourceText === 'kaynak: HERE' && o.source === 'HERE', o.sourceText);
  ok('durum metninde kaynak/tazelik yok', !/kaynak|önce|canlı/.test(o.statusText));
  const n = renderOccupancyView(m, doc);
  ok('render: kök occ-view', n && n.className === 'occ-view');
  ok('render: tam metin', n.textContent === '🟢 1/2 boş · 3 dk önce · canlı · kaynak: HERE', n.textContent);
  const src = byClass(n, 'occ-source');
  ok('render: kaynak ayrı düğüm, çevrilmez, attrib', src.length === 1 && src[0].translate === false && src[0].className.includes('attrib'));
  ok('render: tazelik ayrı düğüm', byClass(n, 'occ-fresh').length === 1 && byClass(n, 'occ-fresh')[0].textContent === '3 dk önce · canlı');
  ok('render: ton sınıfı', byClass(n, 'occ-ok').length === 1);
}
{
  const m = view(slots({ availability: av({ source: 'tomtom', counts: { AVAILABLE: 1 }, at: NOW - 10e3 }) }));
  ok('0 dk → "şimdi · canlı"', m.official.freshnessText === 'şimdi · canlı', m.official.freshnessText);
}
{
  const m = view(slots({ availability: av({ source: 'tomtom', counts: { CHARGING: 2 }, at: NOW - 2 * MIN }) }));
  ok('busy (UNKNOWN yok) → dolu', m.official.state === 'busy' && m.official.statusText === '🔴 dolu (0/2)');
}

// ---------- 3) Yaşlanan: gösterilir ama canlı DEĞİL ----------
{
  const m = view(slots({ availability: av({ source: 'tomtom', counts: { AVAILABLE: 2, CHARGING: 2 }, at: NOW - 40 * MIN }) }));
  ok('aging → confirmed değil', m.official.state === 'free' && m.official.confirmed === false);
  ok('aging tazelik: 40 dk önce, canlı yok', m.official.freshnessText === '40 dk önce' && !LIVE.test(renderOccupancyView(m, doc).textContent));
}

// ---------- 4) UNKNOWN / stale / fetched / gelecek → fail-closed ----------
const failClosed = (name, m, freshExpect) => {
  const o = m.official;
  ok(`${name}: unknown, confirmed değil`, o && o.state === 'unknown' && o.confirmed === false && o.tone === 'muted', JSON.stringify(m));
  ok(`${name}: durum sözcüğü yok`, o.statusText === 'doluluk bilgisi yok' && !STATUS.test(o.statusText), o.statusText);
  ok(`${name}: tazelik ${JSON.stringify(freshExpect)}`, o.freshnessText === freshExpect, o.freshnessText);
  const t = renderOccupancyView(m, doc).textContent;
  ok(`${name}: render 'canlı' ve durum içermez`, !LIVE.test(t) && !STATUS.test(t), t);
};
failClosed('hepsi UNKNOWN', view(slots({ availability: av({ source: 'here', evses: [{ status: 'UNKNOWN', at: NOW - MIN }] }) })), null);
failClosed('şarjda + UNKNOWN', view(slots({ availability: av({ source: 'here', evses: [{ status: 'CHARGING', at: NOW - MIN }, { status: 'UNKNOWN', at: NOW - MIN }] }) })), null);
failClosed('stale 3 sa', view(slots({ availability: av({ source: 'tomtom', counts: { AVAILABLE: 4 }, at: NOW - 3 * 3600e3 }) })), 'eski bilgi');
failClosed('NDW fetched zamanı', view(slots({ availability: av({ source: 'ndw', counts: { AVAILABLE: 2 } }) })), null);
failClosed('gelecekte 10 dk', view(slots({ availability: av({ source: 'here', counts: { AVAILABLE: 1 }, at: NOW + 10 * MIN }) })), null);
{
  const m = view(slots({ availability: av({ source: 'ndw', counts: { AVAILABLE: 2 } }) }));
  ok('NDW fetched: kaynak yine gösterilir', m.official.sourceText === 'kaynak: NDW');
  ok('NDW kuralı occupancyLabel ile aynı (unverified)', m.official.freshness === 'unverified' && m.official.reason === 'unverified-time');
}
{
  const m = view(slots({ availability: av({ source: 'here', counts: { AVAILABLE: 1 }, at: NOW - MIN }) }), { now: NaN });
  ok('now geçersiz → unverified, canlı yok', m.official.state === 'unknown' && m.official.confirmed === false);
}

// ---------- 5) Simüle / tanınmayan kaynak / biçimsiz → hiç gösterilmez ----------
{
  const sim = view(slots({ availability: deepFreeze({ ...av({ source: 'here', counts: { AVAILABLE: 3 }, at: NOW - MIN }), simulated: true }) }));
  ok('simüle → hidden, official yok', sim.hidden === true && sim.official === null, JSON.stringify(sim));
  const mock = view(slots({ availability: av({ source: 'mock', counts: { AVAILABLE: 3 }, at: NOW - MIN }) }));
  ok('mock kaynak → hidden', mock.hidden === true && mock.official === null);
  const unk = view(slots({ availability: deepFreeze({ source: 'acme', simulated: false, timestampKind: 'provider', at: NOW - MIN, counts: { AVAILABLE: 1 } }) }));
  ok('tanınmayan kaynak → hidden', unk.hidden === true && unk.official === null);
  const bad = view(slots({ availability: deepFreeze({ source: 'here', counts: { AVAILABLE: 1 } }) })); // simulated alanı yok
  ok('simulated alanı eksik → hidden', bad.hidden === true);
  const sim2 = view(slots({ availability: deepFreeze({ ...av({ source: 'here', counts: { AVAILABLE: 3 }, at: NOW - MIN }), simulated: true }), community: { busy: 2 } }));
  ok('simüle + topluluk → yalnız topluluk', sim2.hidden === false && sim2.official === null && sim2.community.length === 1);
  ok('simüle + topluluk render canlı içermez', !LIVE.test(renderOccupancyView(sim2, doc).textContent));
}

// ---------- 6) Google: atıf kararı bekliyor → resmî doluluk gösterilmez ----------
{
  const g = view(slots({ src: 'google', availability: av({ source: 'google', counts: { AVAILABLE: 3 }, at: NOW - MIN }) }));
  ok('google → blocked, official yok, hidden', g.blocked === 'google-attribution-pending' && g.official === null && g.hidden === true, JSON.stringify(g));
  const g2 = view(slots({ availability: av({ source: ' Google ', counts: { AVAILABLE: 3 }, at: NOW - MIN }) }));
  ok('Google (büyük harf/boşluk) da blocked', g2.blocked === 'google-attribution-pending' && g2.official === null);
}

// ---------- 7) Topluluk bildirimleri: mevcut metinler aynen, canlı/kaynak yok ----------
{
  const m = view(slots({ community: { busy: 2, report: { status: 'full', at: NOW - 5 * MIN } } }));
  ok('topluluk → görünür, official yok', m.hidden === false && m.official === null && m.community.length === 2);
  ok('👥 metni korunur', m.community[0].text === '👥 2 araç şarj ediyor' && m.community[0].ageText === null);
  ok('Dolu bildirildi metni + yaş', m.community[1].text === '🔴 Dolu bildirildi' && m.community[1].ageText === '5 dk önce');
  const n = renderOccupancyView(m, doc);
  ok('topluluk render', n.textContent === '👥 2 araç şarj ediyor🔴 Dolu bildirildi · 5 dk önce', n.textContent);
  ok('topluluk satırında kaynak/canlı yok', byClass(n, 'occ-source').length === 0 && !LIVE.test(n.textContent));
}
{
  const m = view(slots({ community: { report: { status: 'free', at: NOW - 20e3 } } }));
  ok('Boş bildirildi · şimdi', m.community[0].text === '🟢 Boş bildirildi' && m.community[0].ageText === 'şimdi');
  const old = view(slots({ community: { report: { status: 'full', at: NOW - 120 * MIN } } }));
  ok('eski topluluk bildirimi → eski bilgi', old.community[0].ageText === 'eski bilgi');
  const noAt = view(slots({ community: { report: { status: 'full' } } }));
  ok('zamansız bildirim gösterilmez', noAt.hidden === true);
  const weird = view(slots({ community: { busy: -1, report: { status: 'LIVE', at: NOW } } }));
  ok('geçersiz topluluk alanları → hidden', weird.hidden === true);
  const zero = view(slots({ community: { busy: 0 } }));
  ok('busy 0 → hidden', zero.hidden === true);
}
{
  const m = view(slots({ availability: av({ source: 'here', counts: { AVAILABLE: 1 }, at: NOW - 2 * MIN }), community: { busy: 1 } }));
  const n = renderOccupancyView(m, doc);
  ok('resmî + topluluk birlikte', byClass(n, 'occ-official').length === 1 && byClass(n, 'occ-community').length === 1);
}

// ---------- 8) translate: kalıp + parametre çağıranın t() fonksiyonuna gider ----------
{
  const calls = [];
  const tr = (s, ...p) => { calls.push(s); return `<${s}|${p.join(',')}>`; };
  const m = view(slots({ availability: av({ source: 'here', counts: { AVAILABLE: 1 }, at: NOW - 2 * MIN }), community: { busy: 1, report: { status: 'free', at: NOW - MIN } } }), { translate: tr });
  const all = Object.values(VIEW_TEMPLATES);
  ok('translate yalnızca bilinen kalıplarla çağrılır', calls.length > 0 && calls.every((c) => all.includes(c)), JSON.stringify(calls));
  ok('kaynak kalıbı marka parametresiyle', m.official.sourceText === '<· kaynak: {0}{1}|HERE,>', m.official.sourceText);
}

// ---------- 9) Saflık: girdi değişmez, deterministik ----------
{
  const s = slots({ availability: av({ source: 'here', counts: { AVAILABLE: 1 }, at: NOW - 2 * MIN }), community: { busy: 1 } });
  const before = JSON.stringify(s);
  const a = JSON.stringify(view(s)), b = JSON.stringify(view(s));
  ok('deterministik', a === b);
  ok('girdi değişmez', JSON.stringify(s) === before);
  ok('model donmuş', Object.isFrozen(view(s)) && Object.isFrozen(view(s).official) && Object.isFrozen(view(s).community));
}

// ---------- 10) i18n: tüm kalıplar mevcut anahtar ve 11 dilde çevrili ----------
{
  const keys = new Set([...JSON.parse(readFileSync(join(root, 'i18n/keys.json'), 'utf8')), ...JSON.parse(readFileSync(join(root, 'i18n/keys.extra.json'), 'utf8'))]);
  for (const t of Object.values(VIEW_TEMPLATES)) ok(`i18n anahtarı var: ${t}`, keys.has(t));
  const langs = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'bg'];
  for (const l of langs) {
    const d = { ...(await import(pathToFileURL(join(root, `js/i18n/lang/${l}.js`)).href)).default, ...(await import(pathToFileURL(join(root, `js/i18n/lang/${l}.extra.js`)).href)).default };
    const miss = Object.values(VIEW_TEMPLATES).filter((t) => !String(d[t] || '').trim());
    ok(`${l}: tüm kalıplar çevrili`, miss.length === 0, miss.join(' | '));
  }
}

// ---------- 11) Yalıtım: hiçbir uygulama dosyası içe aktarmaz; ağ/saat/depolama yok ----------
{
  const src = readFileSync(join(root, 'js/ui/occupancyView.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');
  ok('yalnız occupancyLabel içe aktarılır', [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).join() === '../routing/occupancyLabel.js');
  ok('ağ/saat/depolama/DOM global yok', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|Date\.now|new Date|localStorage|sessionStorage|\bdocument\.|\bwindow\.|proxyFetch|import\s*\(/.test(code));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const users = [...walk(join(root, 'js')), join(root, 'index.html'), join(root, 'sw.js')]
    .filter((f) => /\.(js|html)$/.test(f) && !f.endsWith('occupancyView.js'))
    .filter((f) => readFileSync(f, 'utf8').includes('occupancyView'));
  ok('hiçbir uygulama dosyası (js/, index.html, sw.js) occupancyView anmıyor', users.length === 0, users.map((f) => relative(root, f)).join(', '));
}

console.log(`test-occupancy-view: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
