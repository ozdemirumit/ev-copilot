// Ekran açık tutma ve durum şeridi testi: uygulama ön plandayken (navigasyon olsun olmasın) kilit varsayılan olarak alınır, arka planda
// bırakılır, sistemin bıraktığı kilit dokunuşla zorlanmaz; desteklenmeyen/reddeden cihazda yalnızca navigasyon başlarken en çok bir uyarı
// çıkar; Android APK yerel bayrağı (EvrfKeepAwake) varsa web API'si kullanılmaz; eski karartma kalıntısı yok; trafik rozeti veri uydurmaz.
// Kullanım: node scripts/test-wake-status.mjs
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

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
let toasts = 0;
Object.defineProperty(toastEl, 'textContent', { get() { return this._t ?? ''; }, set(v) { if (v) toasts++; this._t = v; } });
// Her modül örneği init anındaki belgeyi tutar; senaryo bitince o belge "gizli" yapılarak örnek emekliye ayrılır
// (state aboneliği kaldırılamadığı için eski örnekler sonraki senaryolarda kilit istemez, uyarı çıkarmaz)
let docHandlers = {};
const newDoc = () => {
  docHandlers = {};
  const handlers = docHandlers;
  globalThis.document = {
    visibilityState: 'visible',
    getElementById: () => toastEl,
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
  };
};
newDoc();
const fire = async (ev) => { (docHandlers[ev] || []).forEach((fn) => fn()); await tick(); };
const setVisible = async (v) => { document.visibilityState = v ? 'visible' : 'hidden'; await fire('visibilitychange'); };
class FakeLock {
  listeners = [];
  released = false;
  addEventListener(_, fn) { this.listeners.push(fn); }
  async release() { if (this.released) return; this.released = true; this.listeners.forEach((fn) => fn()); }
}
let requests = 0;
let deny = 0; // sıradaki kaç istek reddedilsin
let lastLock = null;
const wakeLock = {
  request: async () => {
    requests++;
    if (deny > 0) { deny--; throw new Error('izin yok'); }
    return (lastLock = new FakeLock());
  },
};
const setNavigator = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

const { getState, patch } = await import('../js/state.js');
const held = () => getState('system').wakeLock === true;
// Önceki örneklerin state aboneliği kaldırılamaz; her senaryo kendi uyarılarını sayar ve navigasyonu kapatarak bitirir
const reset = async () => { patch('nav', { active: false }); await tick(); document.visibilityState = 'hidden'; newDoc(); toasts = 0; };

// 1) Desteklenmeyen tarayıcı: gezinirken uyarı yok; navigasyon başlayınca tek uyarı, hata fırlamaz
setNavigator({});
const unsupported = await import('../js/sensors/wakeLock.js?unsupported');
unsupported.initWakeLock();
await tick();
ok('desteklenmiyorsa gezinirken uyarı yok', toasts === 0);
ok('desteklenmiyorsa açık görünmez', !held());
patch('nav', { active: true });
await tick();
ok('desteklenmiyorsa navigasyon başlarken tek uyarı', toasts === 1 && toastEl.textContent === 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor', toastEl.textContent);
patch('nav', { voice: true });
await fire('pointerdown');
ok('aynı navigasyonda uyarı tekrarlanmaz', toasts === 1);
await reset();

// 2) Destekleyen tarayıcı: açılışta, navigasyon olmadan kilit alınır
setNavigator({ wakeLock });
const { initWakeLock } = await import('../js/sensors/wakeLock.js');
initWakeLock();
await tick();
ok('açılışta navigasyon olmadan kilit alınır', requests === 1 && held(), `istek ${requests}`);
const first = lastLock;
patch('nav', { active: true });
await tick();
ok('navigasyon başlayınca yeni kilit istenmez (zaten açık)', requests === 1 && held());
patch('nav', { step: 1 }); patch('nav', { step: 2 });
await tick();
ok('nav güncellemeleri yeni kilit istemez', requests === 1);
patch('nav', { active: false });
await tick();
ok('navigasyon bitince kilit bırakılmaz (ön planda açık kalır)', !first.released && held());
ok('başarılıysa uyarı yok', toasts === 0);

// 3) Arka plan: kilit bırakılır; dönüşte yeniden alınır
await setVisible(false);
ok('arka plana geçince kilit bırakılır', first.released && !held());
await fire('pointerdown');
ok('arka plandayken istenmez', requests === 1);
await setVisible(true);
ok('ön plana dönünce yeniden alınır', requests === 2 && held());

// 4) Sistem kilidi bırakırsa (güç tasarrufu) dokunuşla zorlanmaz; ön plana dönüşte bir kez denenir
await lastLock.release();
await tick();
ok('sistem bırakınca açık görünmez', !held());
await fire('pointerdown');
ok('sistem bıraktıktan sonra dokunuş yeniden istemez', requests === 2, `istek ${requests}`);
await setVisible(false);
await setVisible(true);
ok('ön plana dönüşte yeniden denenir', requests === 3 && held());

// 5) İstek beklerken arka plana geçilirse geç gelen kilit bırakılır
await setVisible(false);
let resolveReq;
const realRequest = wakeLock.request;
wakeLock.request = () => { requests++; return new Promise((r) => { resolveReq = r; }); };
document.visibilityState = 'visible';
await fire('visibilitychange');
document.visibilityState = 'hidden';
const late = new FakeLock();
resolveReq(late);
await tick();
ok('geç gelen kilit arka planda bırakılır', late.released && !held());
wakeLock.request = realRequest;
await setVisible(true);
ok('dönüşte normal alınır', held());
await reset();

// 6) Reddeden tarayıcı (ör. dokunuş isteyen iOS Safari): açılışta sessiz, ilk dokunuşta alınır; navigasyonda tek uyarı
deny = 1;
const r0 = requests;
const denied = await import('../js/sensors/wakeLock.js?denied');
denied.initWakeLock();
await tick();
ok('açılışta reddedilirse gezinirken uyarı yok', toasts === 0 && requests === r0 + 1);
await fire('pointerdown');
ok('ilk dokunuşta yeniden denenir ve alınır', requests === r0 + 2 && held());
await reset();

deny = 99;
const r1 = requests;
const denied2 = await import('../js/sensors/wakeLock.js?denied2');
denied2.initWakeLock();
await tick();
patch('nav', { active: true });
await tick();
ok('reddedilirse navigasyon sürer ve tek kısa uyarı', getState('nav').active === true && toasts === 1 && toastEl.textContent.startsWith('Ekran açık tutulamadı'), toastEl.textContent);
await fire('pointerdown'); await fire('pointerdown');
ok('dokunuşlarda yeniden denenir ama uyarı tekrarlanmaz', requests > r1 + 2 && toasts === 1);
deny = 0;
await fire('pointerdown');
ok('sonraki deneme başarılıysa alınır', held());
await reset();

// 7) Android APK yerel bayrağı: web API'si hiç çağrılmaz, ön planda açık görünür, arka planda değil
const r2 = requests;
globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'EvrfKeepAwake' };
const native = await import('../js/sensors/wakeLock.js?native');
native.initWakeLock();
await tick();
ok('APK yerel bayrağı varsa web kilidi istenmez', requests === r2);
ok('APK yerel bayrağıyla açık görünür', held());
patch('nav', { active: true });
await tick();
ok('APK yerel bayrağıyla navigasyonda uyarı yok', toasts === 0);
await setVisible(false);
ok('APK arka planda açık görünmez', !held());
await setVisible(true);
ok('APK ön plana dönünce açık görünür', held() && requests === r2);
await reset();
// Eski APK (eklenti yok): web API'sine düşer
globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false };
const oldApk = await import('../js/sensors/wakeLock.js?oldapk');
oldApk.initWakeLock();
await tick();
ok('eklentisiz eski APK web kilidini dener', requests === r2 + 1);
delete globalThis.Capacitor;
await reset();

// Android kaynak denetimi: ön planda FLAG_KEEP_SCREEN_ON, arka planda kaldırılır; eklenti kayıtlı
const act = readFileSync(new URL('../android/app/src/main/java/com/evroutefinder/app/MainActivity.java', import.meta.url), 'utf8');
const plug = readFileSync(new URL('../android/app/src/main/java/com/evroutefinder/app/KeepAwakePlugin.java', import.meta.url), 'utf8');
ok('Android: onResume bayrağı koyar', /void onResume\(\)\s*\{[^}]*addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/.test(act));
ok('Android: onPause bayrağı kaldırır', /void onPause\(\)\s*\{[^}]*clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/.test(act));
ok('Android: eklenti super.onCreate öncesi kayıtlı', /registerPlugin\(KeepAwakePlugin\.class\);\s*super\.onCreate/.test(act));
ok('Android: eklenti adı web ile aynı', /@CapacitorPlugin\(name = "EvrfKeepAwake"\)/.test(plug) && /'EvrfKeepAwake'/.test(readFileSync(new URL('../js/sensors/wakeLock.js', import.meta.url), 'utf8')));
ok('Android: arka planda uyanık tutan PowerManager kilidi yok', !/PowerManager|newWakeLock/.test(act.replace(/\/\*\*[\s\S]*?\*\//, '') + plug));

// Karartma kalmadı: modül ve harita duraklatma kancası yok
const mapSrc = readFileSync(new URL('../js/ui/mapView.js', import.meta.url), 'utf8');
ok('karartma modülü yok', !existsSync(new URL('../js/ui/dimmer.js', import.meta.url)));
ok('haritada karartma duraklatma kancası yok', !/mapApi\.pause|karartma/.test(mapSrc));

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
const head = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
ok('üst çubukta GPS, veri, güncelleme, yükleme, test durumu', ['bd-gps', 'btn-data', 'btn-update', 'btn-install', 'bd-sim'].every((id) => head.includes('id="' + id + '"')));
ok('Durum ve kontroller penceresi ve menü girişi kalktı', !html.includes('tools-dialog') && !html.includes('btn-tools') && !html.includes('btn-version') && !html.includes('btn-notes'));
const verJs = readFileSync(new URL('../js/ui/versionInfo.js', import.meta.url), 'utf8');
ok('sürüm numarası sürüm notlarını açar', /\$\('st-version'\)\.addEventListener\('click', openNotes\)/.test(verJs));
ok('sürüm numarası version.js kaynağından', /\$\('st-version'\)\.textContent = 'v' \+ APP_VERSION/.test(verJs));
const gpsJs = readFileSync(new URL('../js/ui/gpsControl.js', import.meta.url), 'utf8');
ok('GPS izin varsa kendiliğinden açılır, eski kapalı kaydı engellemez', /startGps\(\)/.test(gpsJs) && !/gpsOn/.test(gpsJs));

// Çeviri: yeni metinler her dilde
const keys = ['Trafik: —', 'Trafik: veri yok', 'Trafik: akıcı', 'Trafik: +{0} dk', 'Ekran açık tutulamıyor: bu tarayıcı desteklemiyor', 'Ekran açık tutulamadı: cihazın ekran zaman aşımını uzatabilirsin'];
for (const l of ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'bg']) {
  const dict = (await import(`../js/i18n/lang/${l}.extra.js`)).default;
  const miss = keys.filter((k) => !dict[k]);
  ok(`${l}: durum şeridi çevirileri`, !miss.length, miss.join(' | '));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
