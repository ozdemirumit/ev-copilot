// Otomatik ekran açık tutma ve durum şeridi testi: kilit yalnızca navigasyon sürerken istenir, desteklenmeyen/reddeden cihazda navigasyon sürer ve en çok bir uyarı çıkar; trafik rozeti veri uydurmaz.
// Kullanım: node scripts/test-wake-status.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// Tarayıcı taklidi (modüller yüklenmeden önce)
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const makeEl = () => {
  const classes = new Set();
  return {
    title: '', textContent: '', attrs: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
  };
};
const toastEl = makeEl();
// Uyarı sayacı: "desteklenmiyor" örneği de state'e abone kaldığı için (dinleyici kaldırılamaz) sonraki senaryolar yalnızca kendi uyarılarını sayar
let toasts = 0;
let failToasts = 0;
Object.defineProperty(toastEl, 'textContent', { get() { return this._t ?? ''; }, set(v) { if (v) toasts++; if (v?.startsWith?.('Ekran açık tutulamadı')) failToasts++; this._t = v; } });
const docHandlers = {};
globalThis.document = {
  visibilityState: 'visible',
  getElementById: () => toastEl,
  addEventListener: (ev, fn) => { docHandlers[ev] = fn; },
};
class FakeLock {
  listeners = [];
  released = false;
  addEventListener(_, fn) { this.listeners.push(fn); }
  async release() { this.released = true; this.listeners.forEach((fn) => fn()); }
}
let requests = 0;
let denyNext = false;
let lastLock = null;
const wakeLock = {
  request: async () => {
    requests++;
    if (denyNext) { denyNext = false; throw new Error('izin yok'); }
    return (lastLock = new FakeLock());
  },
};
const setNavigator = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

const { getState, patch } = await import('../js/state.js');
const held = () => getState('system').wakeLock === true;

// Desteklenmeyen tarayıcı: navigasyon başlar, bir uyarı çıkar, hata fırlamaz
setNavigator({});
const unsupported = await import('../js/sensors/wakeLock.js?unsupported');
unsupported.initWakeLock();
toasts = 0;
patch('nav', { active: true });
await tick();
ok('desteklenmiyorsa uyarı çıkar', toasts === 1 && toastEl.textContent === 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor', toastEl.textContent);
ok('desteklenmiyorsa açık görünmez', !held());
patch('nav', { voice: true });
ok('aynı navigasyonda uyarı tekrarlanmaz', toasts === 1);
patch('nav', { active: false });
await tick();

// Destekleyen tarayıcı
setNavigator({ wakeLock });
const { initWakeLock } = await import('../js/sensors/wakeLock.js');
initWakeLock();
await tick();
ok('navigasyon yokken kilit istenmez', requests === 0 && !held());

failToasts = 0;
patch('nav', { active: true });
await tick();
ok('navigasyon başlayınca kilit otomatik alınır', requests === 1 && held(), `istek ${requests}`);
ok('başarılıysa uyarı yok', failToasts === 0);
patch('nav', { step: 1 }); patch('nav', { step: 2 });
await tick();
ok('nav güncellemeleri yeni kilit istemez', requests === 1);

await lastLock.release();
ok('sistem bırakınca açık görünmez', !held());
await docHandlers.visibilitychange();
await tick();
ok('sayfa görünür olunca yeniden alınır', requests === 2 && held());

const lock2 = lastLock;
patch('nav', { active: false });
await tick();
ok('navigasyon bitince kilit bırakılır', lock2.released && !held());
docHandlers.visibilitychange();
await tick();
ok('navigasyon yokken görünür olunca alınmaz', requests === 2);

// Reddedilen istek: navigasyon sürer, tek uyarı
denyNext = true;
failToasts = 0;
patch('nav', { active: true });
await tick(); await tick();
ok('reddedilirse açık görünmez, navigasyon sürer', !held() && getState('nav').active === true);
ok('reddedilirse tek kısa uyarı', failToasts === 1 && toastEl.textContent.startsWith('Ekran açık tutulamadı'), toastEl.textContent);
denyNext = true;
docHandlers.visibilitychange();
await tick(); await tick();
ok('yeniden denemede uyarı tekrarlanmaz', failToasts === 1);
await docHandlers.visibilitychange();
await tick(); await tick();
ok('sonraki deneme başarılıysa alınır', held());
patch('nav', { active: false });
await tick();

// Bekleyen istek sırasında navigasyon biterse kilit tutulmaz
let resolveReq;
wakeLock.request = () => new Promise((r) => { resolveReq = r; });
patch('nav', { active: true });
patch('nav', { active: false });
const late = new FakeLock();
resolveReq(late);
await tick(); await tick();
ok('geç gelen kilit bırakılır', late.released && !held());

// Trafik rozeti
const { trafficBadge } = await import('../js/ui/statusBadges.js');
ok('rota yoksa trafik söylenmez', trafficBadge(null)[0] === 'Trafik: —');
ok('canlı kaynak yoksa veri yok denir', trafficBadge({ live: false, ratio: 1, driveMin: 60, freeMin: 60 })[0] === 'Trafik: veri yok');
ok('canlı ve yavaşlama yoksa akıcı', trafficBadge({ live: true, ratio: 1.01, driveMin: 60.6, freeMin: 60 })[0] === 'Trafik: akıcı');
const late2 = trafficBadge({ live: true, ratio: 1.2, driveMin: 72, freeMin: 60 });
ok('canlı gecikme dakika olarak', late2[0] === 'Trafik: +12 dk' && late2[1] === 'wait');

// Yapı: tek şerit, durumlar + BETA + sürüm; GPS ve ekran düğmesi üstte yok
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const row = html.slice(html.indexOf('id="statusrow"'), html.indexOf('id="banners"'));
const ids = [...row.matchAll(/id="(bd-[a-z]+|st-version)"/g)].map((m) => m[1]);
ok('şeritte sırayla OCR, ABRP, trafik, hava, sürüm', ids.join() === 'bd-ocr,bd-abrp,bd-traffic,bd-weather,st-version', ids.join());
ok('şeritte BETA yazıyor', />BETA</.test(row));
ok('şerit üst çubuğun hemen altında', html.indexOf('</header>') < html.indexOf('id="statusrow"') && html.indexOf('id="statusrow"') < html.indexOf('id="banners"'));
ok('rozet kimlikleri tek', ['bd-gps', 'bd-ocr', 'bd-abrp', 'bd-traffic', 'bd-weather'].every((id) => html.split(`id="${id}"`).length === 2));
ok('ekran açık tut ve GPS düğmeleri kalktı', !html.includes('btn-wake') && !html.includes('btn-gps'));
ok('şerit tek satır: kaydırmaz, kırılmaz', /\.statusrow \{ display: flex;/.test(css) && !/\.statusrow \{[^}]*flex-wrap: wrap/.test(css) && /\.statusrow \.badge \{ flex: 0 1 auto; min-width: 0;/.test(css));
const dlg = html.slice(html.indexOf('<dialog id="tools-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="tools-dialog"')));
ok('pencerede GPS durumu, yükleme, güncelleme, veri, sürüm, notlar, test duruyor', ['bd-gps', 'btn-install', 'btn-update', 'btn-data', 'btn-version', 'btn-notes', 'bd-sim'].every((id) => dlg.includes(`id="${id}"`)));
const more = html.slice(html.indexOf('id="tab-more"'), html.indexOf('id="lang-card"'));
ok('pencere Daha fazla menüsünden açılır', /class="menu-item"[^>]*id="btn-tools"[^>]*aria-controls="tools-dialog"/.test(more));
const shell = readFileSync(new URL('../js/ui/shell.js', import.meta.url), 'utf8');
ok('pencere sürüm numarasından da açılır', /\['btn-tools', 'st-version'\][^\n]*showModal/.test(shell));
const verJs = readFileSync(new URL('../js/ui/versionInfo.js', import.meta.url), 'utf8');
ok('sürüm numarası version.js kaynağından', /\$\('st-version'\)\.textContent = 'v' \+ APP_VERSION/.test(verJs));
const gpsJs = readFileSync(new URL('../js/ui/gpsControl.js', import.meta.url), 'utf8');
ok('GPS izin varsa kendiliğinden açılır, eski kapalı kaydı engellemez', /startGps\(\)/.test(gpsJs) && !/gpsOn/.test(gpsJs));

// Çeviri: yeni metinler her dilde
const keys = ['Trafik: —', 'Trafik: veri yok', 'Trafik: akıcı', 'Trafik: +{0} dk', 'Yükleme, güncelleme, veri kullanımı, sürüm', 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor', 'Ekran açık tutulamadı: cihazın ekran zaman aşımını uzatabilirsin'];
for (const l of ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'bg']) {
  const dict = (await import(`../js/i18n/lang/${l}.extra.js`)).default;
  const miss = keys.filter((k) => !dict[k]);
  ok(`${l}: durum şeridi çevirileri`, !miss.length, miss.join(' | '));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
