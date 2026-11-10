// Durak değiştirme: planlayıcıda zorunlu/dışlanan istasyonlar (mustIds/excludeIds) ve 5 km içindeki aday listesi (swapCandidates);
// arayüz bağlantıları (kaynak denetimi). Kullanım: node scripts/test-stop-swap.mjs
import { readFileSync } from 'node:fs';
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const { planRoute, swapCandidates } = await import('../js/routing/planner.js');
const { haversineKm } = await import('../js/utils/geo.js');
const { PLANNER, VEHICLE } = await import('../js/config.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const BAT = VEHICLE.batteryNetKwh;
const KWH_PER_KM = 0.25; // 25 kWh/100 km
const profile = {
  totalKm: 500,
  energyBetween: (a, b, k = 1) => Math.max(0, b - a) * KWH_PER_KM * k,
  timeBetween: (a, b) => Math.max(0, b - a) / 100,
};
// km boyunca doğuya giden düz bir rota: 1 km ≈ 0,0105° boylam (≈ 40°N'de 0,85 km'ye yakın); konum yalnızca mesafe testleri için
const st = (id, km, extra = {}) => ({ id, name: id, km, lat: 40 + km * 1e-4, lon: 30, kw: 180, price: 14, opId: 'astor', opName: 'Astor', slow: false, uncertain: false, offKm: 0.2, ...extra });
const stations = [st('a150', 150), st('b152', 152, { price: 12 }), st('c154', 154, { opId: 'zes', opName: 'ZES' }), st('d300', 300), st('e302', 302), st('f420', 420), st('g60', 60, { kw: 60 })];
const base = { profile, stations, startKm: 0, startSoc: 95, minArrival: 15, mode: 'opt', k: 1 };

const plan0 = planRoute(base);
ok('temel plan kurulur ve duraklı', plan0.feasible && plan0.stops.length >= 1, plan0.reason);
const ids0 = plan0.stops.map((s) => s.station.id);

// Her planlanan durağı kümedeki bir komşusuyla değiştir
const pickOther = (id) => ({ a150: 'b152', b152: 'a150', c154: 'a150', d300: 'e302', e302: 'd300' }[id]);
const oldId = ids0.find((id) => pickOther(id));
ok('planda değiştirilebilir durak var', !!oldId, ids0.join());
const newId = pickOther(oldId);
const swapped = planRoute({ ...base, mustIds: [newId], excludeIds: [oldId] });
const idsS = swapped.stops.map((s) => s.station.id);
ok('değiştirilince plan kurulur', swapped.feasible, swapped.reason);
ok('yeni istasyon planda', idsS.includes(newId), idsS.join());
ok('eski istasyon planda değil', !idsS.includes(oldId), idsS.join());
ok('duraklar rota sırasında', idsS.every((id, i) => i === 0 || swapped.stops[i].km > swapped.stops[i - 1].km));

// Zorunlu durak atlanamaz: planın doğal seçmeyeceği bir istasyonu zorunlu yap
const forced = planRoute({ ...base, mustIds: ['f420'] });
ok('zorunlu durak plana girer', forced.feasible && forced.stops.some((s) => s.station.id === 'f420'), JSON.stringify(forced.stops.map((s) => s.station.id)));
const forced2 = planRoute({ ...base, mustIds: ['c154', 'e302'] });
ok('iki zorunlu durak, ikisi de sırayla', forced2.feasible && forced2.stops.map((s) => s.station.id).filter((id) => id === 'c154' || id === 'e302').join() === 'c154,e302', JSON.stringify(forced2.stops.map((s) => s.station.id)));
const ex = planRoute({ ...base, excludeIds: ids0 });
ok('dışlanan istasyonlar kullanılmaz', ex.feasible ? ex.stops.every((s) => !ids0.includes(s.station.id)) : true);
ok('mustIds/excludeIds yokken sonuç değişmez', JSON.stringify(planRoute({ ...base, mustIds: [], excludeIds: [] }).stops.map((s) => s.station.id)) === JSON.stringify(ids0));
const geçilmiş = planRoute({ ...base, startKm: 200, startSoc: 60, mustIds: ['a150'] });
ok('başlangıçtan geride kalan zorunlu istasyon yok sayılır', geçilmiş.feasible || /Uygun|zincir|bulunamadı/.test(geçilmiş.reason || ''), geçilmiş.reason);
ok('geride kalan zorunlu durak planı engellemez (aynı plan)', JSON.stringify(geçilmiş.stops.map((s) => s.station.id)) === JSON.stringify(planRoute({ ...base, startKm: 200, startSoc: 60 }).stops.map((s) => s.station.id)));

// Kurulamayan zorunluluk: ulaşılamaz bir istasyon (pil yetmez)
const impossible = planRoute({ ...base, startSoc: 20, stations: [st('x400', 400)], mustIds: ['x400'] });
ok('ulaşılamayan zorunlu durak: plan kurulamaz', impossible.feasible === false);

// Yalnızca o durak değişir: öbür duraklar aynı kalır (swapStop'un 1. denemesi: aday kümesi = zincir + yeni istasyon, hepsi zorunlu)
const multi = planRoute({ ...base, startSoc: 55 });
const mIds = multi.stops.map((s) => s.station.id);
ok('iki duraklı temel plan', multi.feasible && mIds.length >= 2, mIds.join());
const victim = mIds.find((id) => pickOther(id));
const repl = pickOther(victim);
const chain = mIds.filter((id) => id !== victim);
const only = [...chain, repl];
const chained = planRoute({ ...base, startSoc: 55, stations: stations.filter((s) => only.includes(s.id)), mustIds: only, excludeIds: [victim] });
const cIds = chained.stops.map((s) => s.station.id);
ok('zincir modu: plan kurulur', chained.feasible, chained.reason);
ok('yeni istasyon eskisinin yerine geçer, öbür duraklar aynı', JSON.stringify(cIds) === JSON.stringify([...mIds.map((id) => (id === victim ? repl : id))].sort((a, b) => stations.find((s) => s.id === a).km - stations.find((s) => s.id === b).km)), cIds.join() + ' <- ' + mIds.join());
ok('zincirde ek durak eklenmez', cIds.length === mIds.length);
const rs = chained.stops.find((s) => s.station.id === repl);
ok('yeni durak için varış/ayrılış pili ve maliyet yeniden hesaplanır', rs && rs.leaveSoc > rs.arriveSoc && rs.cost > 0 && Math.abs(rs.cost - (((rs.leaveSoc - rs.arriveSoc) / 100) * BAT / 0.95) * rs.station.price) < 0.01);
ok('toplamlar güncel (maliyet = durak maliyetleri toplamı)', Math.abs(chained.totals.cost - chained.stops.reduce((a, s) => a + s.cost, 0)) < 0.01);

// Aday listesi
const dist = (a, b) => haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
const stop = plan0.stops.find((s) => s.station.id === oldId);
const c = swapCandidates({ stop, stations, dist, radiusKm: 5, fromKm: 0, plannedIds: ids0 });
ok('adaylar durağın 5 km çevresinde', c.length >= 1 && c.every((r) => r.distKm <= 5), JSON.stringify(c.map((r) => [r.station.id, r.distKm.toFixed(2)])));
ok('durağın kendisi aday değil', c.every((r) => r.station.id !== oldId));
ok('en yakın önce', c.every((r, i) => i === 0 || c[i - 1].distKm <= r.distKm));
ok('uzak istasyonlar (5 km dışı) yok', c.every((r) => !['d300', 'e302', 'f420', 'g60'].includes(r.station.id) || r.distKm <= 5));
ok('güç filtresi: 60 kW istasyon aday değil (minKw ' + PLANNER.minKw + ')', swapCandidates({ stop: { station: stations[6] }, stations: [...stations, st('h61', 61, { kw: 60 })], dist, radiusKm: 5, fromKm: 0 }).every((r) => r.station.kw >= PLANNER.minKw));
const brandsBefore = PLANNER.brands;
PLANNER.brands = ['astor'];
const cb = swapCandidates({ stop, stations, dist, radiusKm: 5, fromKm: 0, plannedIds: [] });
ok('marka tercihi: yalnızca tercih edilen marka', cb.every((r) => r.station.opId === 'astor') && !cb.some((r) => r.station.id === 'c154'), JSON.stringify(cb.map((r) => r.station.id)));
PLANNER.brands = brandsBefore;
const behind = swapCandidates({ stop, stations, dist, radiusKm: 5, fromKm: 151, plannedIds: [] });
ok('araçtan geride kalan istasyon aday değil', behind.every((r) => r.station.km > 151.5));
const other = swapCandidates({ stop, stations, dist, radiusKm: 5, fromKm: 0, plannedIds: [...ids0, 'c154'] });
ok('plandaki öbür duraklar aday değil', !other.some((r) => r.station.id === 'c154' || (ids0.includes(r.station.id) && r.station.id !== oldId)));
ok('yarıçap parametresi', swapCandidates({ stop, stations, dist, radiusKm: 0.5, fromKm: 0 }).length <= c.length);

// Arayüz ve denetleyici bağlantıları
const ctrl = read('js/routing/controller.js');
ok('swapStop: yeni zorunlu, eski dışlanır; kurulamazsa plan korunur', /export function swapStop\(oldId, newId\)/.test(ctrl) && /pinIds: \[\.\.\.prev\.pinIds\.filter/.test(ctrl) && /banIds: \[\.\.\.new Set/.test(ctrl) && /if \(!out\?\.result\.feasible\) return \{ ok: false/.test(ctrl));
ok('swapStop önce yalnızca o durağı değiştirir (zincir + yeni istasyon), olmazsa yeniden düzenler', /onlyIds: \[\.\.\.chain, newId\]/.test(ctrl) && /reflowed = true/.test(ctrl) && /const all = plan\.stations;/.test(ctrl) && /stations: all, startKm/.test(ctrl));
ok('yeni rotada zorunlu/dışlanan listeleri sıfırlanır', /pinIds: \[\], banIds: \[\]/.test(ctrl));
ok('computePlan zorunlu/dışlanan istasyonları planlayıcıya verir', /mustIds:/.test(ctrl) && /excludeIds:/.test(ctrl));
const html = read('index.html');
const dlg = html.slice(html.indexOf('<dialog id="swap-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="swap-dialog"')));
ok('değiştirme penceresi: başlık, alt metin, liste, kapat', ['swap-title', 'swap-sub', 'swap-list', 'swap-close'].every((id) => dlg.includes(`id="${id}"`)));
const rp = read('js/ui/routePanel.js');
ok('durak satırında Değiştir düğmesi', /textContent: 'Değiştir'/.test(rp) && /openSwap\(/.test(rp));
const ui = read('js/ui/stopSwap.js');
ok('seçilince swapStop çağrılır, başarısızsa bildirim', /swapStop\(/.test(ui) && /toast\(/.test(ui));
ok('5 km yarıçap', /radiusKm: 5/.test(ui) || /RADIUS_KM = 5/.test(ui));
ok('çevrimdışı kabukta yeni dosya', read('sw.js').includes("'./js/ui/stopSwap.js'"));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
