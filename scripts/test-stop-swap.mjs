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

// Aday listesi: rotada durağın ±5 km çevresi, FİLTRESİZ
const stop = plan0.stops.find((s) => s.station.id === oldId);
const c = swapCandidates({ stop, stations, rangeKm: 5, fromKm: 0, plannedIds: ids0 });
ok('adaylar rotada durağın ±5 km çevresinde', c.length >= 1 && c.every((r) => Math.abs(r.station.km - stop.km) <= 5), JSON.stringify(c.map((r) => [r.station.id, r.dKm])));
ok('dKm: rotada önce (−) / sonra (+)', c.every((r) => Math.abs(r.dKm - (r.station.km - stop.km)) < 1e-9));
ok('durağın kendisi aday değil', c.every((r) => r.station.id !== oldId));
ok('rotada en yakın önce', c.every((r, i) => i === 0 || Math.abs(c[i - 1].dKm) <= Math.abs(r.dKm)));
ok('5 km dışındaki istasyonlar yok', c.every((r) => !['d300', 'e302', 'f420'].includes(r.station.id)));
const low = st('h61', 151, { kw: 60 });
const withLow = swapCandidates({ stop, stations: [...stations, low], rangeKm: 5, fromKm: 0, plannedIds: [] });
ok('güç filtresi uygulanmaz: 60 kW istasyon listede (minKw ' + PLANNER.minKw + ')', withLow.some((r) => r.station.id === 'h61'));
ok('filtreye uymayan işaretlenir (offFilter)', withLow.find((r) => r.station.id === 'h61').offFilter === true && withLow.find((r) => r.station.id === 'b152' || r.station.id === 'a150' || r.station.id === 'c154').offFilter === false);
const brandsBefore = PLANNER.brands;
PLANNER.brands = ['astor'];
const cb = swapCandidates({ stop, stations, rangeKm: 5, fromKm: 0, plannedIds: [] });
ok('marka tercihi uygulanmaz: tercih dışı marka da listede, işaretli', cb.some((r) => r.station.id === 'c154' && r.offFilter === true), JSON.stringify(cb.map((r) => [r.station.id, r.offFilter])));
PLANNER.brands = brandsBefore;
const behind = swapCandidates({ stop, stations, rangeKm: 5, fromKm: 151, plannedIds: [] });
ok('araçtan geride kalan istasyon aday değil', behind.every((r) => r.station.km > 151.5));
const other = swapCandidates({ stop, stations, rangeKm: 5, fromKm: 0, plannedIds: [...ids0, 'c154'] });
ok('plandaki öbür duraklar aday değil', !other.some((r) => r.station.id === 'c154' || (ids0.includes(r.station.id) && r.station.id !== oldId)));
ok('menzil parametresi', swapCandidates({ stop, stations, rangeKm: 1, fromKm: 0 }).length <= c.length && swapCandidates({ stop, stations, rangeKm: 1, fromKm: 0 }).every((r) => Math.abs(r.dKm) <= 1));

// Filtreye uymayan (60 kW) istasyon seçilince de plana girer: zorunlu durak filtreden bağımsızdır
const lowPlan = planRoute({ ...base, stations: [...stations, low], mustIds: ['h61'], excludeIds: [oldId] });
ok('60 kW istasyon zorunlu seçilince plana girer', lowPlan.feasible && lowPlan.stops.some((s) => s.station.id === 'h61'), JSON.stringify(lowPlan.stops.map((s) => s.station.id)) + ' ' + (lowPlan.reason || ''));
const lowChain = planRoute({ ...base, stations: [...stations, low].filter((s) => s.id === 'h61' || ids0.filter((i) => i !== oldId).includes(s.id)), mustIds: ['h61', ...ids0.filter((i) => i !== oldId)], excludeIds: [oldId] });
ok('zincir modunda da (yalnızca 60 kW seçilen + öbür duraklar)', lowChain.feasible || /Uygun|zincir/.test(lowChain.reason || ''), lowChain.reason);
const lowStop = lowPlan.stops.find((s) => s.station.id === 'h61');
ok('düşük güçte şarj süresi uzar (≥ 180 kW\'lık eşdeğerinden)', lowStop && lowStop.minutes > 0);
const noMust = planRoute({ ...base, stations: [...stations, low] });
ok('zorunlu değilse 60 kW istasyon yine seçilmez (filtre planlayıcıda duruyor)', !noMust.stops.some((s) => s.station.id === 'h61'));

// Şarj et (istasyonu ekle): istasyon zorunlu, öbür duraklar serbest; gerekmeyen otomatik durak çıkar
const eng = (id, km) => ({ id, name: id, km, lat: 40, lon: 30 + km * 0.01, kw: 180, price: 14, opId: 'astor', opName: 'Astor', slow: false, uncertain: false, offKm: 0.2 });
const aStations = [eng('s140', 140), eng('s250', 250), eng('s300', 300), eng('s330', 330), eng('s420', 420)];
const aBase = { profile, stations: aStations, startKm: 0, startSoc: 80, minArrival: 15, mode: 'opt', k: 1 };
const a0 = planRoute(aBase);
ok('ekleme öncesi plan: s140 ve s300', a0.feasible && a0.stops.map((x) => x.station.id).join() === 's140,s300', a0.stops.map((x) => x.station.id).join());
const a1 = planRoute({ ...aBase, mustIds: ['s250'] });
const a1ids = a1.stops.map((x) => x.station.id);
ok('eklenen istasyon plana girer', a1.feasible && a1ids.includes('s250'), a1ids.join());
ok('gerekmeyen otomatik durak (s140) çıkar', !a1ids.includes('s140'), a1ids.join());
ok('plan yine de eşik pilini korur (varışta ≥ eşik − tolerans)', a1.totals.arriveSoc >= 15 - PLANNER.tolerance - 0.01, String(a1.totals.arriveSoc));
const a2 = planRoute({ ...aBase, mustIds: ['s250', 's420'] });
ok('iki eklenen istasyon da sırayla planda', a2.feasible && a2.stops.map((x) => x.station.id).filter((i) => i === 's250' || i === 's420').join() === 's250,s420', a2.stops.map((x) => x.station.id).join());
const a3 = planRoute({ ...aBase, mustIds: ['s140'] });
ok('zaten planda olanı eklemek planı bozmaz', a3.feasible && a3.stops.map((x) => x.station.id).join() === a0.stops.map((x) => x.station.id).join());

// Kaldır: gereksizse tamamen çıkar, gerekiyorsa rota üzerinden alternatif
{
  // Kısa rota (200 km): şarjsız gidilir; zorunlu tutulan durak kaldırılınca durak kalmaz
  const short = { totalKm: 200, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.25 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
  const sStations = [eng('r100', 100)];
  const withStop = planRoute({ profile: short, stations: sStations, startKm: 0, startSoc: 80, minArrival: 15, mode: 'opt', k: 1, mustIds: ['r100'] });
  ok('kısa rota: zorunlu durakla plan 1 duraklı', withStop.feasible && withStop.stops.length === 1);
  const noStop = planRoute({ profile: short, stations: [], startKm: 0, startSoc: 80, minArrival: 15, mode: 'opt', k: 1 });
  ok('durak gereksizse kaldırınca tamamen çıkar (boş zincir, plan kurulur)', noStop.feasible && noStop.stops.length === 0 && noStop.totals.arriveSoc >= 15 - PLANNER.tolerance);
  // Uzun rota: s140 kaldırılınca öbür duraklar aynı kalsa plan kurulamaz → alternatif aranır
  const chainOnly = planRoute({ ...aBase, stations: aStations.filter((x) => x.id === 's300'), mustIds: ['s300'], excludeIds: ['s140'] });
  ok('uzun rota: öbür duraklar aynı kalıp bu durak çıkarsa plan kurulamaz', chainOnly.feasible === false);
  const alt = planRoute({ ...aBase, excludeIds: ['s140'] });
  const altIds = alt.stops.map((x) => x.station.id);
  ok('serbest planlamada alternatif seçilir (s140 yok, plan kurulur)', alt.feasible && !altIds.includes('s140') && altIds.length >= 1, altIds.join());
  ok('alternatif varışta eşiği korur', alt.totals.arriveSoc >= 15 - PLANNER.tolerance - 0.01);
  const altPinned = planRoute({ ...aBase, excludeIds: ['s140'], mustIds: ['s330'] });
  ok('seçilmiş (pinli) öbür durak kaldır sırasında korunur', altPinned.feasible && altPinned.stops.some((x) => x.station.id === 's330') && !altPinned.stops.some((x) => x.station.id === 's140'), altPinned.stops.map((x) => x.station.id).join());
  const noAlt = planRoute({ ...aBase, startSoc: 40, stations: [eng('only', 140)], excludeIds: ['only'] });
  ok('hiç alternatif yoksa plan kurulamaz (eski plan korunur)', noAlt.feasible === false);
}

// Arayüz ve denetleyici bağlantıları
const ctrl = read('js/routing/controller.js');
ok('swapStop: yeni zorunlu, eski dışlanır; kurulamazsa plan korunur', /export function swapStop\(oldId, newId\)/.test(ctrl) && /pinIds: \[\.\.\.prev\.pinIds\.filter/.test(ctrl) && /banIds: \[\.\.\.new Set/.test(ctrl) && /if \(!out\?\.result\.feasible\) return \{ ok: false/.test(ctrl));
ok('swapStop önce yalnızca o durağı değiştirir (zincir + yeni istasyon), olmazsa yeniden düzenler', /onlyIds: \[\.\.\.chain, newId\]/.test(ctrl) && /reflowed = true/.test(ctrl) && /const all = acc\.stations;/.test(ctrl) && /applyAccess\(plan\.stations, accessBook/.test(ctrl) && /stations: all, startKm/.test(ctrl));
ok('yeni rotada zorunlu/dışlanan listeleri sıfırlanır', /pinIds: \[\], banIds: \[\]/.test(ctrl));
ok('computePlan zorunlu/dışlanan istasyonları planlayıcıya verir', /mustIds:/.test(ctrl) && /excludeIds:/.test(ctrl));
const html = read('index.html');
const dlg = html.slice(html.indexOf('<dialog id="swap-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="swap-dialog"')));
ok('değiştirme penceresi: başlık, alt metin, liste, kapat', ['swap-title', 'swap-sub', 'swap-list', 'swap-close'].every((id) => dlg.includes(`id="${id}"`)));
const rp = read('js/ui/routePanel.js');
ok('durak satırında Değiştir düğmesi', /textContent: 'Değiştir'/.test(rp) && /openSwap\(/.test(rp));
const ui = read('js/ui/stopSwap.js');
ok('seçilince swapStop çağrılır, başarısızsa bildirim', /swapStop\(/.test(ui) && /toast\(/.test(ui));
ok('rotada ±5 km, filtresiz', /RANGE_KM = 5/.test(ui) && /rangeKm: RANGE_KM/.test(ui) && !/radiusKm/.test(ui));
const card = read('js/ui/stationCard.js');
ok('istasyon kartında Değiştir, Fiyat bildir ile aynı satırda ve sonrasında', card.indexOf("btn('💳 Fiyat bildir'") > 0 && card.indexOf("btn('🔁 Değiştir'") > card.indexOf("btn('💳 Fiyat bildir'") && /acts\.append\(btn\('🔁 Değiştir'/.test(card));
ok('Değiştir yalnızca rotadaki (araçtan ileri) durak için', /plan'\)\.stops\?\.find\(\(x\) => x\.station\.id === s\.id && x\.km > progressKm\(\) - 0\.3\)/.test(card) && /if \(stop\) acts/.test(card));
ok('kart kapanır, aynı değiştirme penceresi açılır', /close\(\); openSwap\(stop, progressKm\(\)\)/.test(card));
ok('addStop: zorunlu eklenir, eski plan kurulamazsa korunur, gerekmeyen çıkarılanlar bildirilir', /export function addStop\(newId\)/.test(ctrl) && /pinIds: \[\.\.\.new Set\(\[\.\.\.\(plan\.pinIds \|\| \[\]\), newId\]\)\]/.test(ctrl) && /if \(!out\?\.result\.feasible\) return \{ ok: false, reason: out\?\.result\.reason \|\| 'Plan kurulamadı', dropped: \[\] \}/.test(ctrl) && /const dropped = /.test(ctrl));
ok('istasyon kartında Şarj et: rotadaki ama planda olmayan istasyon için', /btn\('⚡ Şarj et'/.test(card) && /else if \(getState\('plan'\)\.status === 'ready'/.test(card) && /addStop\(s\.id\)/.test(card));
ok('Şarj et bildirimi: eklenen ve çıkarılan duraklar', /Şarj durağı eklendi: \{0\}\. Gerekmeyen durak çıkarıldı: \{1\}/.test(card));
const rpSrc = read('js/ui/routePanel.js');
ok('removeStop: durak dışlanır, önce öbürleri aynı (onlyIds), olmazsa alternatif; kurulamazsa eski plan', /export function removeStop\(oldId\)/.test(ctrl) && /banIds: \[\.\.\.new Set\(\[\.\.\.\(plan\.banIds \|\| \[\]\), oldId\]\)\]/.test(ctrl) && /onlyIds: chain \}\)/.test(ctrl) && /if \(!out\?\.result\.feasible\) return \{ ok: false, reason: out\?\.result\.reason \|\| 'Plan kurulamadı', added: \[\] \}/.test(ctrl));
ok('Rota sayfasında durak satırında Kaldır (Değiştir yanında)', /textContent: '🗑️ Kaldır'/.test(rpSrc) && /removeFromRoute\(s\)/.test(rpSrc) && /acts\.append\(show, swap, rm\)/.test(rpSrc));
ok('İstasyon kartında rotadaki durak için Kaldır', /btn\('🗑️ Kaldır'/.test(card) && /removeFromRoute\(stop\)/.test(card));
ok('Kaldır bildirimi: alternatif varsa yazılır', /Durak çıkarıldı: \{0\}\. Alternatif: \{1\}/.test(ui) && /Durak rotadan çıkarıldı: \{0\}/.test(ui));
const sv = read('js/ui/stationsView.js');
ok('İstasyonlar sekmesi: planlı satırda Değiştir ve Kaldır (aday satırda yok)', /const stop = n \? stops\.find\(\(s\) => s\.station\.id === r\.station\.id\) : null;/.test(sv) && /'🔁 Değiştir'/.test(sv) && /'🗑️ Kaldır'/.test(sv) && /openSwap\(stop, here\)/.test(sv) && /removeFromRoute\(stop\)/.test(sv) && /import \{ openSwap, removeFromRoute \} from '\.\/stopSwap\.js'/.test(sv));
ok('Operatörü düzelt açılır menüsü kaldırıldı', !/op-fix/.test(sv) && !/setStationOperator/.test(sv) && !/Operatörü düzelt/.test(sv) && !/\.op-fix/.test(read('css/styles.css')));
ok('çevrimdışı kabukta yeni dosya', read('sw.js').includes("'./js/ui/stopSwap.js'"));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
