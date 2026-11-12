// Rota seçenekleri arayüzü (Faz B2): index.html/app.js/sw.js bağlantısı, katlanır bölümün görünürlüğü, satır metinleri,
// "Bunu kullan" düğmesinin mod değiştirmesi (İstasyon çipleriyle aynı akış), boş/tek plan durumları ve regresyon. Ağ çağrısı yok.
// Kullanım: node scripts/test-route-options-ui.mjs
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- Statik bağlantı ----
const html = read('index.html');
const app = read('js/app.js');
const sw = read('sw.js');
const view = read('js/ui/routeOptionsView.js');
ok('index.html: katlanır bölüm başta gizli', /<details class="places-edit hidden" id="route-options">/.test(html));
ok('index.html: gövde kutusu var', /id="ro-body"/.test(html));
ok('index.html: bölüm rota sayfasında plan listesinin altında', html.indexOf('id="plan-list"') < html.indexOf('id="route-options"') && html.indexOf('id="route-options"') < html.indexOf('id="premium-hint"'));
ok('index.html: başlıkta üç mod', /Hızlı \/ Ekonomik \/ Optimum/.test(html));
ok('app.js: içe aktarılır ve başlatılır', /import \{ initRouteOptionsView \} from '\.\/ui\/routeOptionsView\.js'/.test(app) && /^initRouteOptionsView\(\);/m.test(app));
ok('app.js: rota paneli sonrasında başlatılır', app.indexOf('initRoutePanel();') < app.indexOf('initRouteOptionsView();'));
const shell = [...sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = ['))).matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);
ok('sw.js: görünüm ve model önbellekte', shell.includes('./js/ui/routeOptionsView.js') && shell.includes('./js/routing/routeOptions.js'));
const missing = shell.filter((p) => !existsSync(new URL('../' + p.slice(2), import.meta.url)));
ok('sw.js: önbellekteki her dosya gerçekten var', missing.length === 0, missing.join(', '));
ok('sw.js: yinelenen kayıt yok', new Set(shell).size === shell.length, shell.filter((p, i) => shell.indexOf(p) !== i).join(', '));
ok('görünüm navigasyon/kamera/SOC/yakın sıralama modüllerine dokunmaz', !/from '\.\.\/(nav|sensors)\//.test(view) && !/navCamera|socBar|nearSort/.test(view));
ok('denetleyici mod değişiminde yeniden planlar (çiplerle aynı akış)', /if \(p\.mode !== lastMode\) \{ lastMode = p\.mode; refresh\(\); \}/.test(read('js/routing/controller.js')));
ok('İstasyon çipleri aynı akışı kullanır', /save\('planMode', c\.dataset\.sort\);\s*patch\('plan', \{ mode: c\.dataset\.sort \}\)/.test(read('js/ui/stationsView.js')));
{
  const self = {}; new Function('self', read('version.js'))(self);
  ok('version.js 0.99.40 ve günlük en üstte', self.APP_VERSION === '0.99.40' && self.APP_CHANGELOG[0].v === '0.99.40');
  const notes = self.APP_CHANGELOG[0].notes.join(' ');
  ok('günlük Türkçe karakterli (ASCII yazım yok)', /ş/.test(notes) && /ı/.test(notes) && !/\b(secenek|sarj|guzergah|dusuk|degismedi)\b/i.test(notes));
}

// ---- En küçük DOM taklidi ----
function fakeEl(tag) {
  const cls = new Set();
  const e = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, open: false, type: '', textContent: '', listeners: {},
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
    classList: { toggle: (c, on) => { (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c); }, contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    append: (...k) => e.children.push(...k),
    replaceChildren: (...k) => { e.children = [...k]; },
    addEventListener: (t, f) => (e.listeners[t] ||= []).push(f),
    dispatch: (t) => (e.listeners[t] || []).forEach((f) => f({ type: t })),
    click: () => e.dispatch('click'),
  };
  return e;
}
const all = (e) => [e, ...e.children.flatMap(all)];
const text = (e) => all(e).map((x) => x.textContent).filter(Boolean).join('\n');
const buttons = (e) => all(e).filter((x) => x.tagName === 'BUTTON');
function fakeDoc() {
  const ids = { 'route-options': fakeEl('details'), 'ro-body': fakeEl('div') };
  ids['route-options'].className = 'places-edit hidden';
  return { ids, getElementById: (id) => ids[id] || null, createElement: fakeEl };
}

// Denetleyicinin modül düzeyi DOM erişimleri için (test-route-options ile aynı yaklaşım)
const prox = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : prox()), apply: () => prox(), set: () => true });
const saved = {};
globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = String(v); }, removeItem: (k) => { delete saved[k]; } };
globalThis.document ??= prox(); globalThis.window ??= globalThis;
const { getState, patch } = await import('../js/state.js');
const V = await import('../js/ui/routeOptionsView.js');

const st = (id, o = {}) => ({ id, name: id, kw: 180, uncertain: false, slow: false, tariff: 'list', price: 10, ...o });
const stop = (station, o = {}) => ({ station, km: 100, arriveSoc: 20, leaveSoc: 70, minutes: 25, cost: 300, ...o });
const plan = (stops, o = {}) => ({ feasible: true, stops, totals: { totalMin: 300, chargeMin: 40, driveMin: 260, arriveSoc: 25, ...o } });
const A = st('A'), B = st('B', { price: 8 }), C = st('C', { kw: 60 });
const profile = { totalKm: 600 };

// ---- Plan yokken gizli; dışarıdan plan hesaplanmaz ----
{
  patch('plan', { status: 'none', profile: null, stops: [], totals: null, mode: 'opt' });
  const doc = fakeDoc(); let calls = 0;
  const ctl = V.initRouteOptionsView({ doc, getPlans: () => { calls++; return {}; } });
  ok('plan yokken bölüm gizli', doc.ids['route-options'].classList.contains('hidden'));
  patch('plan', { status: 'ready', profile, stops: [stop(A)], totals: plan([stop(A)]).totals, route: { coords: [] } });
  ok('plan hazırken bölüm görünür', !doc.ids['route-options'].classList.contains('hidden'));
  ok('kapalıyken hesaplanmaz', calls === 0 && doc.ids['ro-body'].children.length === 0);
  patch('plan', { status: 'infeasible', totals: null });
  ok('plan kurulamayınca yine gizli', doc.ids['route-options'].classList.contains('hidden'));
  ok('init bir denetim nesnesi döner', typeof ctl?.paint === 'function');
  ok('kutu yoksa sessizce çıkar', V.initRouteOptionsView({ doc: { getElementById: () => null } }) === null);
}

// ---- Üç farklı plan: satırlar, rozetler, ölçütler, "Bunu kullan" ----
{
  const cur = plan([stop(A, { cost: 380, leaveSoc: 75 })], { totalMin: 290, arriveSoc: 18 });
  patch('plan', { status: 'ready', profile, mode: 'opt', stops: cur.stops, totals: cur.totals, route: { coords: [] }, fromKm: 20, fromSoc: 70, maxFirstStopKm: 100 });
  const doc = fakeDoc(); const asked = [];
  V.initRouteOptionsView({ doc, getPlans: (modes) => { asked.push(modes); return {
    fast: plan([stop(A, { cost: 400 })], { totalMin: 280, arriveSoc: 15 }),
    cheap: plan([stop(B, { cost: 250 }), stop(C, { cost: 100, arriveSoc: 30 })], { totalMin: 330, arriveSoc: 22 }),
  }; } });
  const box = doc.ids['route-options'], body = doc.ids['ro-body'];
  box.open = true; box.dispatch('toggle');
  ok('açılınca yalnız diğer modlar hesaplanır', asked.length === 1 && JSON.stringify(asked[0]) === '["fast","cheap"]');
  const rows = body.children.filter((r) => r.className.includes('ro-row'));
  ok('üç satır', rows.length === 3 && rows.map((r) => r.dataset.mode).join() === 'fast,cheap,opt');
  const t = text(body);
  ok('tek güzergâh notu yazılı', /alternatif güzergâh yok/.test(t));
  ok('seçili satır mevcut planın kendisi (4 sa 50 dk, 380 TL)', /seçili/.test(text(rows[2])) && /4 sa 50 dk/.test(text(rows[2])) && /380 TL \(tarife\)/.test(text(rows[2])), text(rows[2]));
  ok('rozetler: hızlı / ucuz+risk', /En hızlı/.test(text(rows[0])) && /En ucuz/.test(text(rows[1])) && /En düşük risk/.test(text(rows[1])));
  ok('risk ölçütleri açıkça yazılı', /En düşük risk: Ölçütler: 1\) Yolculuk boyunca en düşük tahmini pil/.test(t) && /Belirsiz durak sayısı/.test(t) && /Şarj durağı sayısı/.test(t));
  ok('fiyat açıklaması yazılı', t.includes(V.PRICE_NOTE));
  const btns = buttons(body);
  ok('seçili satırda düğme yok, diğerlerinde "Bunu kullan"', btns.length === 2 && btns.every((b) => b.textContent === 'Bunu kullan' && b.type === 'button') && !buttons(rows[2]).length);
  ok('mevcut plan durumu değişmedi', getState('plan').mode === 'opt' && getState('plan').stops === cur.stops);
  buttons(rows[1])[0].click();
  ok('"Bunu kullan" modu değiştirir ve kaydeder', getState('plan').mode === 'cheap' && JSON.parse(saved['evcp.planMode']) === 'cheap', saved['evcp.planMode']);
  ok('mod değişince satırlar yeniden kurulur (seçili artık Ekonomik)', /seçili/.test(text(doc.ids['ro-body'].children.find((r) => r.dataset?.mode === 'cheap'))));
  const n = asked.length; box.dispatch('toggle');
  ok('aynı planda tekrar hesaplanmaz', asked.length === n);
  V.useMode('bogus'); ok('bilinmeyen mod yok sayılır', getState('plan').mode === 'cheap');
}

// ---- Tek farklı plan (tüm modlar aynı) ve kurulamayan mod ----
{
  const cur = plan([stop(A)]);
  patch('plan', { status: 'ready', profile, mode: 'opt', stops: cur.stops, totals: cur.totals, route: { coords: [] }, fromKm: 0 });
  const doc = fakeDoc();
  V.initRouteOptionsView({ doc, getPlans: () => ({ fast: plan([stop(A)]), cheap: { feasible: false, reason: 'Menzil yetmiyor' } }) });
  doc.ids['route-options'].open = true; doc.ids['route-options'].dispatch('toggle');
  const t = text(doc.ids['ro-body']);
  ok('aynı plan: rozet yok, açıklama var', !/En hızlı(?!:)|En ucuz(?!:)/.test(t.replace(/En (hızlı|ucuz|düşük risk): .*/g, '')) && /karşılaştırılacak farklı seçenek yok/.test(t), t);
  ok('aynı plan satırında düğme yerine "Seçili planla aynı"', /Seçili planla aynı/.test(t) && buttons(doc.ids['ro-body']).length === 0);
  ok('kurulamayan mod nedeniyle yazılır, düğmesiz', /Plan kurulamadı: Menzil yetmiyor/.test(t));
}

// ---- Fiyat bilinmiyor/tahmini: En ucuz iddia edilmez ----
{
  const F = st('F', { foreign: true, price: 0, tariff: null }), E = st('E', { tariff: 'estimate', price: 1 });
  const cur = plan([stop(F, { cost: 0 })], { totalMin: 320 });
  patch('plan', { status: 'ready', profile, mode: 'opt', stops: cur.stops, totals: cur.totals, route: { coords: [] }, fromKm: 0 });
  const doc = fakeDoc();
  V.initRouteOptionsView({ doc, getPlans: () => ({ fast: plan([stop(A, { cost: 400 })], { totalMin: 280 }), cheap: plan([stop(E, { cost: 50 })], { totalMin: 330 }) }) });
  doc.ids['route-options'].open = true; doc.ids['route-options'].dispatch('toggle');
  const t = text(doc.ids['ro-body']);
  ok('bilinmeyen fiyat açıkça yazılır', /Fiyat bilinmiyor/.test(t));
  ok('tahmini fiyat ~ ve "tahmini" ile', /~50 TL \(1 durak tahmini fiyat\)/.test(t));
  ok('En ucuz rozeti verilmez, nedeni yazılır', !doc.ids['ro-body'].children.some((r) => /En ucuz/.test(r.children?.[1]?.textContent || '')) && /En ucuz: En ucuz söylenemez/.test(t));
}

// ---- Denetleyici hatası arayüzü kırmaz ----
{
  const cur = plan([stop(A)]);
  patch('plan', { status: 'ready', profile, mode: 'fast', stops: cur.stops, totals: cur.totals, route: null, fromKm: 0 });
  const doc = fakeDoc();
  V.initRouteOptionsView({ doc, getPlans: () => { throw new Error('x'); } });
  doc.ids['route-options'].open = true; doc.ids['route-options'].dispatch('toggle');
  const rows = doc.ids['ro-body'].children.filter((r) => r.className.includes('ro-row'));
  ok('hata olursa yalnız mevcut plan gösterilir', rows.length === 1 && rows[0].dataset.mode === 'fast' && /Uygun plan yok|farklı seçenek yok/.test(text(doc.ids['ro-body'])));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
