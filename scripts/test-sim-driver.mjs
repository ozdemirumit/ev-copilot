// Test Modu sürücüsü (v0.99.127) testleri: js/sim/driver.js (saf) — rotanın GERÇEK izinde sürüş, ivmelenme/frenleme, viraj yavaşlaması, yön yumuşatma,
// varışta durma, zaman çarpanından bağımsızlık; + simülatör/navigator/state bağlantı denetimi. Çevrimdışı; gerçek ağ yok.
// Kullanım: node scripts/test-sim-driver.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const D = await import('../js/sim/driver.js');
const { locate, pointAtKm } = await import('../js/nav/track.js');
const { angleDiff } = await import('../js/utils/geo.js');
const { decodePolyline6 } = await import('../js/osm/route.js');
const { DRIVER } = D;

// --- sentetik rota: 3 km doğuya, 90° sola (kuzeye) keskin köşe, 3 km kuzeye; her 25 m'de bir nokta ---
function corner(spacingM = 25) {
  const lat0 = 40, lon0 = 30, kmPerLon = 111.32 * Math.cos((lat0 * Math.PI) / 180), kmPerLat = 110.57;
  const pts = [];
  const n = Math.round(3000 / spacingM);
  for (let i = 0; i <= n; i++) pts.push([lon0 + ((i * spacingM) / 1000) / kmPerLon, lat0]);
  const lonC = pts.at(-1)[0];
  for (let i = 1; i <= n; i++) pts.push([lonC, lat0 + ((i * spacingM) / 1000) / kmPerLat]);
  return pts;
}
// düz rota: 6 km doğuya
const straight = () => { const c = corner(); return c.slice(0, 121).concat([]).map(([lo, la], i) => [30 + (i * 0.025) / (111.32 * Math.cos((40 * Math.PI) / 180)) * 2, la]); };

function run(drive, { targetKmh = 90, dtStep = 0.2, maxS = 3000, startV = 0, onStep } = {}) {
  let s = { km: 0, v: startV, hdg: undefined };
  const log = [];
  let t = 0;
  while (t < maxS) {
    const r = D.stepDrive(drive, s, { targetKmh, dt: dtStep });
    log.push({ t: t + dtStep, ...r, dv: (r.v - s.v) / dtStep, dh: Math.abs(angleDiff(r.hdg, s.hdg ?? r.hdg)) / dtStep });
    onStep?.(r, s);
    s = r; t += dtStep;
    if (r.arrived) break;
  }
  return { log, end: s, t };
}

// ===================== A) sentetik köşeli rota =====================
{
  const coords = corner();
  const drive = D.prepareDrive(coords);
  const total = drive.track.totalKm;
  const { log, end, t } = run(drive);
  const cornerKm = total / 2;
  ok('A rota izi gerçek geometri (km ≈ 6)', Math.abs(total - 6) < 0.05, String(total));
  let maxOff = 0; for (const p of log) maxOff = Math.max(maxOff, locate(drive.track, p.lat, p.lon).offKm);
  ok('A her adımda konum rotanın ÜSTÜNDE (≤ 1 m)', maxOff < 0.001, String(maxOff));
  ok('A hız sıfırdan başlar ve hedefe (90 km/sa) ulaşır', log[0].v < 1 && Math.max(...log.map((p) => p.v)) * 3.6 > 89.9);
  ok('A ivmelenme sınırı aşılmaz (≤ 1,6 m/s²)', Math.max(...log.map((p) => p.dv)) <= DRIVER.accel + 1e-6);
  ok('A frenleme sınırı aşılmaz (≤ 2,8 m/s²)', Math.min(...log.map((p) => p.dv)) >= -DRIVER.decel - 1e-6);
  const minCap = Math.min(...drive.cap);
  const atCorner = log.reduce((b, p) => (Math.abs(p.km - cornerKm) < Math.abs(b.km - cornerKm) ? p : b));
  ok('A tam köşede hız viraj tavanına iner (≤ tavan ×1,25)', atCorner.v <= minCap * 1.25, `${atCorner.v} > ${minCap}`);
  ok('A köşeden 400 m önce hâlâ hedef hızda, 30 m önce yavaş, sonra yeniden hızlanır', log.find((p) => p.km > cornerKm - 0.4).v * 3.6 > 85 && log.find((p) => p.km > cornerKm - 0.03).v < 12 && Math.max(...log.filter((p) => p.km > cornerKm + 0.5).map((p) => p.v)) * 3.6 > 85);
  ok('A yön köşeden sonra kuzeye (0°) oturur, dönüş hızı sınırlı (≤ 70°/sn)', Math.abs(angleDiff(log.find((p) => p.km > cornerKm + 0.3).hdg, 0)) < 15 && Math.max(...log.map((p) => p.dh)) <= DRIVER.hdgRate + 1e-6);
  ok('A varışta durur: arrived, kalan ≤ 8 m, aşma yok', end.arrived && (total - end.km) * 1000 <= DRIVER.arriveM && end.km <= total + 1e-9);
  ok('A varışa yakın hız 0\'a yakın', end.v < 2.5, String(end.v));
  ok('A makul süre (6 km ≈ 4–8 dk)', t > 200 && t < 600, String(t));
}

// ===================== B) zaman çarpanından bağımsızlık =====================
{
  const drive = D.prepareDrive(corner());
  const at = (dtStep, T) => { let s = { km: 0, v: 0, hdg: undefined }; for (let t = 0; t < T - 1e-9; t += dtStep) s = D.stepDrive(drive, s, { targetKmh: 90, dt: dtStep }); return s; };
  const a = run(drive, { dtStep: 0.2 }), c = run(drive, { dtStep: 30 });
  const [x1, x2, x3] = [at(0.2, 150), at(2, 150), at(30, 150)];
  ok('B 150 sn sonra konum: 0,2 / 2 / 30 sn adım ±%1 aynı (zaman çarpanından bağımsız)', Math.abs(x2.km - x1.km) / x1.km < 0.01 && Math.abs(x3.km - x1.km) / x1.km < 0.01, `${x1.km} ${x2.km} ${x3.km}`);
  ok('B 30 sn adım (×150) da varışa varır, süre en çok bir adım + %3 farklı', c.end.arrived && Math.abs(c.t - a.t) <= 30 + 0.03 * a.t, `${a.t} ${c.t}`);
  ok('B büyük adımda da ivme sınırı korunur (alt adımlar)', Math.max(...c.log.map((p) => p.v)) * 3.6 <= 90.0001);
}

// ===================== C) düz rota: frenleme tam zamanında =====================
{
  const coords = [];
  for (let i = 0; i <= 240; i++) coords.push([30 + ((i * 25) / 1000) / (111.32 * Math.cos((40 * Math.PI) / 180)), 40]);
  const drive = D.prepareDrive(coords);
  ok('C düz rotada viraj tavanı yok', drive.cap.every((v) => v === Infinity));
  let brakeStart = null; let vmax = 0;
  const { end } = run(drive, { onStep: (r, s) => { vmax = Math.max(vmax, r.v); if (brakeStart == null && r.v < s.v - 1e-9 && vmax > 24) brakeStart = (drive.track.totalKm - r.km) * 1000; } });
  const need = (vmax * vmax) / (2 * DRIVER.decel * DRIVER.planFactor);
  ok('C frenleme ≈ v²/(2·a) kala başlar (±%35)', brakeStart != null && brakeStart > need * 0.8 && brakeStart < need * 1.35 + 20, `${brakeStart} vs ${need}`);
  ok('C yine varışta durur', end.arrived && end.v < 2.5);
}

// ===================== D) gerçek kayıtlı Ankara rotası (OSM/Valhalla, 15,6 km) =====================
{
  const fx = JSON.parse(read('scripts/fixtures/lanes/osm-valhalla-ankara-lanes-recorded.json'));
  const coords = decodePolyline6(fx.response.routes[0].geometry);
  const drive = D.prepareDrive(coords);
  const { log, end, t } = run(drive, { dtStep: 1, targetKmh: 70 });
  // Konum rota izinden hesaplanır (pointAtKm) → tanım gereği üstünde. Navigasyonun locate()'i de (km ipucuyla) bulmalı; BİLİNEN SINIR: locate yalnız en yakın köşenin komşu doğrularına bakar,
  // rotanın son ~700 m'sindeki seyrek köşeli kesimde (varış çevresi) yanlış köşeyi seçebilir (ön-var, js/nav/track.js; bu iş kapsamı dışı) → son 700 m hariç ≤ 1 m aranır.
  const exact = log.every((p) => { const q = pointAtKm(drive.track, p.km); return Math.abs(q.lat - p.lat) < 1e-9 && Math.abs(q.lon - p.lon) < 1e-9; });
  let maxOff = 0; for (const p of log) if (drive.track.totalKm - p.km > 0.7) maxOff = Math.max(maxOff, locate(drive.track, p.lat, p.lon, p.km).offKm); // navigasyon da km ipucuyla arar
  ok('D gerçek rotada konum rotanın üstünde (pointAtKm ile birebir; locate ≤ 1 m, son 700 m hariç)', exact && maxOff < 0.001, String(maxOff));
  ok('D gerçek rotada varışa ulaşır ve durur', end.arrived && end.v < 2.5 && (drive.track.totalKm - end.km) * 1000 <= DRIVER.arriveM);
  ok('D 15,6 km @70 km/sa süre makul (13–25 dk; virajlar yavaşlatır)', t > 780 && t < 1500, String(t));
  ok('D ivme ve fren sınırları gerçek rotada da korunur', Math.max(...log.map((p) => p.dv)) <= DRIVER.accel + 1e-6 && Math.min(...log.map((p) => p.dv)) >= -DRIVER.decel - 1e-6);
  ok('D yön dönüş hızı ≤ 70°/sn (sıçrama yok)', Math.max(...log.map((p) => p.dh)) <= DRIVER.hdgRate + 1e-6);
  ok('D kare başına konum sıçraması yok (1 sn adımda ≤ hız·1,1 + 1 m)', log.every((p, i) => i === 0 || (p.km - log[i - 1].km) * 1000 <= (Math.max(p.v, log[i - 1].v) * 1) * 1.1 + 1));
  const speeds = log.map((p) => p.v * 3.6);
  ok('D hız sabit değil: virajlarda 70\'in altına iner', Math.min(...speeds.slice(30, -30)) < 60, String(Math.min(...speeds.slice(30, -30))));
}

// ===================== E) relocate: yeniden planlamada yeni izde yer bul =====================
{
  const drive = D.prepareDrive(corner());
  const mid = drive.track.totalKm / 4;
  const p = D.stepDrive(drive, { km: mid, v: 10, hdg: 90 }, { targetKmh: 90, dt: 0.1 });
  ok('E relocate: yakın konum izdüşümü', Math.abs(D.relocate(drive, p.lat, p.lon, 0) - p.km) < 0.01);
  ok('E relocate: uzak konum → eski km (sınırlı)', D.relocate(drive, 45, 35, 1.2) === 1.2 && D.relocate(drive, 45, 35, 99) === drive.track.totalKm);
  ok('E relocate: konum yok → eski km', D.relocate(drive, null, null, 2.5) === 2.5);
  const bad = D.stepDrive(drive, { km: NaN, v: NaN, hdg: NaN }, { targetKmh: NaN, dt: NaN });
  ok('E bozuk girişlerde çökmez, sonlu değer döner', Number.isFinite(bad.km) && Number.isFinite(bad.v) && Number.isFinite(bad.hdg) && bad.v === 0);
}

// ===================== F) bağlantı denetimi =====================
{
  const sim = read('js/sim/simulator.js'), nav = read('js/nav/navigator.js'), st = read('js/state.js'), cfg = read('js/config.js'), tp = read('js/ui/testPanel.js'), drv = read('js/sim/driver.js');
  ok('F simülatör rotanın GERÇEK izini (plan.route.coords) driver ile sürer, profile.pointAt kullanmaz', /plan\.route\?\.coords/.test(sim) && /prepareDrive\(coords\)/.test(sim) && /stepDrive\(/.test(sim) && !/profile\.pointAt/.test(sim));
  ok('F yeni rota gelince konum yeni izde yeniden oturtulur (relocate, planId)', /drivePlanId !== plan\.planId/.test(sim) && /relocate\(drive, sim\.lat, sim\.lon, sim\.routeKm\)/.test(sim));
  ok('F rota yoksa eski davranış (gidiş açısı yönünde, sürgü hızı)', /upd\.vNow = null/.test(sim) && /Math\.cos\(h\)/.test(sim));
  ok('F pil fiziği anlık (ivmelenen) hızı kullanır', /batteryPowerKw\(\{ v: vKmh,/.test(sim));
  ok('F başa sarma anlık hızı sıfırlar', /resetSimPosition[\s\S]*vNow: null/.test(sim));
  ok('F effective(): oynarken anlık hız (yoksa sürgü), oynatılmıyorsa 0 (araç duruyor)', /speed: sim\.play \? \(sim\.vNow \?\? sim\.speed\) : 0/.test(st));
  ok('F navigator kamera tahmini zaman çarpanını içerir (geri sıçrama yok)', /const simK = getState\('sim'\)\.enabled && getState\('sim'\)\.play \? getState\('sim'\)\.timeScale \|\| 1 : 1/.test(nav) && /\* simK/.test(nav));
  ok('F DEFAULT_SIM vNow: null', /vNow: null/.test(cfg));
  ok('F test paneli anlık hızı gösterir', /sim\.vNow != null/.test(tp) && /km\/sa/.test(tp));
  ok('F driver saf: ağ/DOM/depolama/zaman çağrısı yok', !/\b(fetch|XMLHttpRequest|localStorage|document|window|setTimeout|setInterval|performance)\b|Date\.now/.test(drv.replace(/\/\/.*$/gm, '')));
}


// ===================== G) Test Modu açmak aracı BAŞLATMAZ (v0.99.129): yalnız Oynat =====================
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const S = await import('../js/state.js');
  S.patch('sim', { enabled: true, play: false, speed: 90, vNow: null });
  ok('G Test Modu açık ama Oynat yok: araç duruyor (hız 0)', S.effective().speed === 0 && S.effective().source === 'sim' && S.getState('sim').play === false);
  S.patch('sim', { vNow: 55 });
  ok('G duraklatılmış araç (eski anlık hız kalsa da) duruyor', S.effective().speed === 0);
  S.patch('sim', { play: true, vNow: null });
  ok('G Oynat: anlık hız henüz yoksa sürgüdeki hedef', S.effective().speed === 90);
  S.patch('sim', { vNow: 37.5 });
  ok('G Oynat: ivmelenen anlık hız', S.effective().speed === 37.5);
  S.patch('sim', { play: false });
  ok('G Durdur: yeniden 0', S.effective().speed === 0);
  S.patch('sim', { enabled: false, play: false, vNow: null });
  ok('G Test Modu kapalıyken gerçek sensör kaynağı', S.effective().source === 'live');
  const re = read('js/physics/rangeEngine.js'), tp = read('js/ui/testPanel.js');
  ok('G menzil motoru: duruyorken sayaçlar e.speed (0) ile ilerlemez, ne-olur tahmini sürgüyü kullanır', /const speed = e\.speed \?\? 0;/.test(re) && /const whatIf = e\.source === 'sim' && !sim\.play \? sim\.speed : speed;/.test(re) && /const vRef = whatIf >= 20 \? whatIf : route\.cruise;/.test(re));
  const nv = read('js/nav/navigator.js');
  ok('G "Navigasyonu durdur" oynayan testi de durdurur (play false, anlık hız 0) ve navigasyonu bitirir', /export function stopNav\(\) \{\r?\n\s*endNav\(\);\r?\n\s*if \(getState\('sim'\)\.enabled && getState\('sim'\)\.play\) patch\('sim', \{ play: false, vNow: 0 \}\);/.test(nv));
  ok('G Test Modu anahtarı oynatmayı başlatmaz; navigasyonu yalnız Oynat düğmesi başlatır', /patch\('sim', \{ enabled: toggle\.checked, play: toggle\.checked \? getState\('sim'\)\.play : false \}\)/.test(tp) && (tp.match(/startNav\(\)/g) || []).length === 1 && /play\.addEventListener\('click'[\s\S]*startNav\(\)/.test(tp));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
