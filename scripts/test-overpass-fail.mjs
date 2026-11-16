// Overpass kesintisi ve istasyon keşfi (bağımlılıksız, düz node): node scripts/test-overpass-fail.mjs
// Canlı Beta hatası: "0 istasyon ileride … Kaynak: 3 kayıt → 0 aday. Overpass: 1 parça alınamadı — Fetch is aborted. Hiç istasyon alınamadı."
// Ağ kesintisi (WebKit "Fetch is aborted" = zaman aşımı) geçerli sıfır sonuçtan ayrılır; kaç parçanın alınamadığı doğru sayılır;
// koridor dışı elenen kayıtlar özetle gösterilir; son başarılı parça sonucu (eski olduğu belirtilerek) ve önceki liste korunur;
// elle yeniden arama kesintiden sonra yeniden ağa gider. Ara sunucu yok (Beta oturumsuz), gerçek ağ ve anahtar kullanılmaz.
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { dispatchEvent() { return true; }, addEventListener() {}, getElementById() { return null; } };

let handler = () => { throw new Error('fetch beklenmiyordu'); };
let calls = [];
globalThis.fetch = async (url, init = {}) => { calls.push(String(url)); return handler(String(url), init); };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const webkitAbort = () => new DOMException('Fetch is aborted', 'AbortError'); // iOS/Safari: AbortSignal.timeout dolunca

const O = await import('../js/osm/chargers.js');
const S = await import('../js/routing/chargerSource.js');

// Düz doğu yönlü rota: enlem LAT, boylam 29.0'dan başlar; 1 km aralıklı noktalar, 200 km → 4 Overpass parçası (60 km)
const KM_PER_DEG = 111.2 * Math.cos((40 * Math.PI) / 180);
function route(lat, totalKm = 200) {
  const pts = [];
  for (let km = 0; km <= totalKm; km++) pts.push({ lat, lon: 29 + km / KM_PER_DEG, km });
  const profile = { totalKm, project: (la, lo) => ({ km: (lo - 29) * KM_PER_DEG, offKm: Math.abs(la - lat) * 111.2 }) };
  return { pts, profile };
}
const el = (id, lat, lon) => ({ type: 'node', id, lat, lon, tags: { amenity: 'charging_station', name: `Test DC ${id}`, 'socket:type2_combo': '2', 'socket:type2_combo:output': '120 kW' } });
// Sorgudaki ilk çizgi noktasının boylamına bir istasyon (yol üstünde) koyar
const onRouteEl = (init, lat) => {
  const q = new URLSearchParams(String(init.body)).get('data');
  const m = /around:\d+,([\d.-]+),([\d.-]+)/.exec(q);
  return el(Math.round(Number(m[2]) * 1e4), lat, Number(m[2]) + 0.05);
};

// ---- A. Tüm aynalar WebKit "Fetch is aborted" ile düşer: ağ kesintisi ----
{
  handler = () => { throw webkitAbort(); };
  calls = [];
  const e = await O.overpass('[out:json][timeout:60];nwr["amenity"="charging_station"](around:3000,40,29);out tags center;').catch((x) => x);
  ok('A1 overpass(): AbortError (WebKit) zaman aşımı sayılır, ham "Fetch is aborted" gösterilmez', e instanceof Error && /zaman aşımı/.test(e.message) && !/Fetch is aborted/.test(e.message), e?.message);
  ok('A2 overpass(): hiçbir aynaya ulaşılamadı → unreachable', e?.unreachable === true);
  ok('A3 overpass(): üç ayna da denendi (paralel fırtına yok, sırayla)', calls.length === 3 && new Set(calls).size === 3, JSON.stringify(calls));

  const { pts, profile } = route(40);
  calls = [];
  const r = await O.fetchChargers(pts, profile);
  ok('A4 kesinti: istasyon yok, sourceDown=true (geçerli sıfırdan ayrı)', r.stations.length === 0 && r.sourceDown === true, JSON.stringify({ n: r.stations.length, d: r.sourceDown }));
  ok('A5 kesinti: tüm parçalar sayılır ("4/4 parça alınamadı"), yalnız ilk düşen değil', r.errors.some((x) => /Overpass: 4\/4 parça alınamadı — Overpass zaman aşımı/.test(x)), JSON.stringify(r.errors));
  ok('A6 kesinti: kullanıcıya kaynağa ulaşılamadığı söylenir', /İstasyon kaynağına ulaşılamadı/.test(r.errors[0] || ''), JSON.stringify(r.errors));
  ok('A7 kesinti: ulaşılamayınca kalan parçalar için ağa yeniden gidilmez (≤ 3 eşzamanlı parça × 3 ayna)', calls.length <= 9, String(calls.length));

  // ---- F. Elle yeniden arama: kesinti başarısızlıkları önbelleğe girmez, yeniden ağa gidilir ----
  handler = (url, init) => json({ elements: [onRouteEl(init, 40)] });
  calls = [];
  const r2 = await O.fetchChargers(pts, profile);
  ok('F1 yeniden ara: aynalar "ölü" işaretli olsa da yeniden denenir ve istasyonlar gelir', r2.stations.length === 4 && r2.errors.length === 0 && r2.sourceDown === false, JSON.stringify({ n: r2.stations.length, e: r2.errors }));
  ok('F2 yeniden ara: her parça ağa gitti (hata önbelleğe alınmamış)', calls.length === 4, String(calls.length));
}

// ---- B. Geçerli sıfır: Overpass yanıt verdi, rota boyunca istasyon yok ----
{
  handler = () => json({ elements: [] });
  const { pts, profile } = route(41);
  const r = await O.fetchChargers(pts, profile);
  ok('B1 geçerli sıfır: hata yok, sourceDown=false', r.stations.length === 0 && r.errors.length === 0 && r.sourceDown === false, JSON.stringify(r.errors));
  ok('B2 geçerli sıfır: özet 0 kayıt', r.summary.raw === 0 && r.summary.kept === 0);
}

// ---- D. "3 kayıt → 0 aday": koridor dışı elenen kayıtlar özette görünür ----
{
  handler = (url, init) => {
    const q = new URLSearchParams(String(init.body)).get('data');
    return json({ elements: /around:3000,43\.00000,29\.00000/.test(q) ? [el(1, 43.09, 29.1), el(2, 43.09, 29.2), el(3, 43.09, 29.3)] : [] }); // ~10 km kuzeyde
  };
  const { pts, profile } = route(43);
  const r = await O.fetchChargers(pts, profile);
  ok('D1 3 ham kayıt, koridor (≤3 km) dışında → 0 aday', r.summary.raw === 3 && r.summary.kept === 0 && r.errors.length === 0, JSON.stringify(r.summary));
  ok('D2 elenme nedeni özette: "rota koridoru dışı 3" (sessiz kayıp yok)', r.summary.drop['rota koridoru dışı'] === 3, JSON.stringify(r.summary.drop));
  ok('D3 koridor güvenliği gevşemedi: 10 km uzaktaki istasyon aday olmaz', r.stations.length === 0);
}

// ---- C. Son başarılı parça sonucu: taze önbellek bitti, Overpass kesik → eski veri olduğu söylenerek kullanılır ----
{
  handler = (url, init) => json({ elements: [onRouteEl(init, 42)] });
  const { pts, profile } = route(42);
  const r1 = await O.fetchChargers(pts, profile);
  ok('C1 ilk arama: 4 istasyon', r1.stations.length === 4 && r1.errors.length === 0, JSON.stringify(r1.errors));
  const realNow = Date.now;
  Date.now = () => realNow() + 7 * 3600e3; // 6 sa taze önbellek bitti
  try {
    handler = () => { throw webkitAbort(); };
    calls = [];
    const r2 = await O.fetchChargers(pts, profile);
    ok('C2 kesinti + son başarılı sonuç: 4 istasyon korunur', r2.stations.length === 4, String(r2.stations.length));
    ok('C3 kesinti açıkça söylenir ve verinin eski olduğu belirtilir', r2.errors.some((x) => /parça alınamadı/.test(x)) && r2.errors.some((x) => /son başarılı aramadan/.test(x)), JSON.stringify(r2.errors));
    ok('C4 eski veriyle sourceDown=false, stale=4', r2.sourceDown === false && r2.stale === 4, JSON.stringify({ d: r2.sourceDown, s: r2.stale }));
    ok('C5 taze önbellek bitince yine önce ağa gidildi', calls.length > 0);
  } finally { Date.now = realNow; }
  Date.now = () => realNow() + 4 * 24 * 3600e3; // son başarılı sonuç da çok eski (3 günden fazla)
  try {
    const r3 = await O.fetchChargers(pts, profile);
    ok('C6 3 günden eski son sonuç kullanılmaz (uydurma/çok eski veri yok)', r3.stations.length === 0 && r3.sourceDown === true, String(r3.stations.length));
  } finally { Date.now = realNow; }
}

// ---- E. Önceki liste korunur (elle "Yeniden ara" kesintide listeyi silmez) ----
{
  const prev = [{ id: 'a', km: 10 }, { id: 'b', km: 50 }];
  const down = S.keepLastGood(prev, { stations: [], errors: ['İstasyon kaynağına ulaşılamadı: internet veya Overpass sunucusu'], sourceDown: true });
  ok('E1 kesinti + önceki liste → önceki istasyonlar kalır', down.stations === prev && down.kept === true);
  ok('E2 kesinti notu eklenir (önceki liste korunuyor, sayı ile)', down.errors.some((x) => /Önceki istasyon listesi korunuyor \(2\)/.test(x)), JSON.stringify(down.errors));
  const zero = S.keepLastGood(prev, { stations: [], errors: [], sourceDown: false });
  ok('E3 geçerli sıfır sonuç önceki listeyi korumaz (doğru sonuç gösterilir)', zero.stations.length === 0 && zero.kept === false);
  const none = S.keepLastGood([], { stations: [], errors: ['x'], sourceDown: true });
  ok('E4 önceki liste yoksa sonuç aynen döner', none.stations.length === 0 && none.kept === false && none.errors.length === 1);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
