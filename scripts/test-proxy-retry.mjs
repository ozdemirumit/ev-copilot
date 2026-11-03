// Ara sunucu yeniden deneme testleri (bağımlılıksız, düz node): node scripts/test-proxy-retry.mjs
// proxyFetchRetry (js/net/proxy.js), ortak kapı, HERE / Overpass / OpenChargeMap / Mapbox istasyon aramasının kullanımı ve toast olayı.
// Ağ, localStorage ve document taklit edilir; uyku sahtedir (gerçek 4 sn beklenmez). Gerçek anahtar kullanılmaz.
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ---- tarayıcı ortamı taklidi ----
const store = new Map([
  ['evcp.proxyUrl', JSON.stringify('http://proxy.test')],
  ['evcp.proxyCode', JSON.stringify('testcode-1234567890abc')],
  ['evcp.proxyCaps', JSON.stringify({ here: true, mapbox: true, ocm: true, overpass: true })],
  ['evcp.deviceId', JSON.stringify('d_abcdefghijklmnopqrstu')],
]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const events = [];
const listeners = new Map();
globalThis.document = {
  dispatchEvent(e) { events.push(e.type); (listeners.get(e.type) || []).forEach((fn) => fn(e)); return true; },
  addEventListener(t, fn) { listeners.set(t, [...(listeners.get(t) || []), fn]); },
  getElementById() { return fakeToastEl; },
};
const fakeToastEl = { textContent: '', classList: { add() {}, remove() {} } };

// ---- sahte fetch: sıradaki yanıt/hata sırayla verilir (sıra bitince son öğe tekrarlanır) ----
let script = [];
let calls = [];
const resp = (status, body = '{}') => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
const netErr = (m = 'Failed to fetch') => new TypeError(m);
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init, signal: init.signal });
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError');
  const i = Math.min(calls.length - 1, script.length - 1);
  const step = typeof script[i] === 'function' ? await script[i](String(url), init) : script[i];
  if (step instanceof Error) throw step;
  return step.clone ? step.clone() : step;
};
const run = (steps) => { script = steps; calls = []; };

const sleeps = [];
const fakeSleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };

const P = await import('../js/net/proxy.js');
const { proxyFetchRetry, resetRetryGate, retryTuning } = P;
retryTuning.sleep = fakeSleep;
const reset = () => { resetRetryGate(); sleeps.length = 0; events.length = 0; };
const NOJ = { jitterMs: 0 };

// ================= 1. proxyFetchRetry: temel davranış =================
{
  reset(); run([resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000 });
  ok('ilk denemede başarı: tek çağrı, uyku yok, olay yok', r.status === 200 && calls.length === 1 && sleeps.length === 0 && events.length === 0);
  ok('istek ara sunucu adresine ve kimlik başlıklarıyla gider', calls[0].url === 'http://proxy.test/x' && calls[0].init.headers.get('X-Device-Id') === 'd_abcdefghijklmnopqrstu');
}
{
  reset(); run([resp(502), resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('502 sonra 200: yeniden denenir ve 200 döner', r.status === 200 && calls.length === 2 && sleeps.length === 1);
}
{
  reset(); run([netErr(), netErr(), resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('ağ hatası iki kez sonra 200: üç çağrı', r.status === 200 && calls.length === 3 && sleeps.length === 2);
}
for (const st of [503, 504]) {
  reset(); run([resp(st), resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok(`${st} yeniden denenir`, r.status === 200 && calls.length === 2);
}
for (const st of [400, 401, 402, 403, 404, 429, 500, 501]) {
  reset(); run([resp(st), resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok(`${st} yeniden DENENMEZ (tam bir çağrı)`, r.status === st && calls.length === 1 && sleeps.length === 0);
}
{
  reset(); run([resp(502)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('tükenince son 502 olduğu gibi döner (1 + 3 deneme)', r.status === 502 && calls.length === 4 && sleeps.length === 3);
}
{
  reset();
  const errs = [netErr('e1'), netErr('e2'), netErr('e3'), netErr('e4')];
  run(errs);
  let thrown = null;
  try { await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ }); } catch (e) { thrown = e; }
  ok('tükenince SON ağ hatası yeniden fırlatılır', thrown === errs[3] && calls.length === 4);
}
{
  reset(); run([new DOMException('x', 'TimeoutError'), resp(200)]);
  let thrown = null;
  try { await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ }); } catch (e) { thrown = e; }
  ok('zaman aşımı (TimeoutError) yeniden denenmez', thrown?.name === 'TimeoutError' && calls.length === 1);
  reset(); run([new Error('bilinmeyen'), resp(200)]);
  thrown = null;
  try { await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ }); } catch (e) { thrown = e; }
  ok('ağ hatası olmayan hata yeniden denenmez', thrown?.message === 'bilinmeyen' && calls.length === 1);
}

// ================= 2. deneme başına yeni zaman aşımı sinyali =================
{
  reset(); run([resp(502)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 5000, ...NOJ });
  const sigs = calls.map((c) => c.signal);
  ok('her deneme kendi sinyalini taşır (4 ayrı sinyal)', sigs.every(Boolean) && new Set(sigs).size === 4);
  ok('hiçbir sinyal henüz iptal edilmiş değil (zaman aşımı dolmadı)', sigs.every((s) => !s.aborted));
}
{
  // Sinyal denemeler arasında yeniden kullanılsaydı süresi dolan sinyal sonraki denemeyi bozardı: sahte uyku sinyali "süresi dolmuş" yapar
  reset();
  run([resp(502), resp(502), resp(200)]);
  const slow = (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, 60)); };
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 30, retries: 3, delayMs: 10, ...NOJ, sleep: slow });
  ok('timeoutMs (30 ms) denemeler arası bekleme (60 ms) süresini aşsa da sonraki deneme iptal edilmemiş sinyalle başlar', r.status === 200 && calls.length === 3);
}
{
  reset(); run([resp(200)]);
  const ctrl = new AbortController();
  await proxyFetchRetry('/x', { signal: ctrl.signal }, { timeoutMs: 1000 });
  ok('çağıranın sinyali de verilirse birleşik sinyal geçer (çağıran iptal ederse iner)', calls[0].signal !== ctrl.signal && (ctrl.abort(), calls[0].signal.aborted));
}

// ================= 3. çağıran iptal ederse yeniden denenmez =================
{
  reset(); run([resp(502), resp(200)]);
  const ctrl = new AbortController();
  const sl = (ms) => { sleeps.push(ms); ctrl.abort(); return new Promise((r) => setTimeout(r, 20)); }; // bekleme sırasında kullanıcı iptal eder
  let thrown = null;
  try { await proxyFetchRetry('/x', { signal: ctrl.signal }, { timeoutMs: 1000, ...NOJ, sleep: sl }); } catch (e) { thrown = e; }
  ok('bekleme sırasında çağıran iptal ederse yeniden deneme yapılmaz, iptal hatası fırlar', thrown?.name === 'AbortError' && calls.length === 1, String(thrown));
}
{
  reset(); run([resp(200)]);
  const ctrl = new AbortController(); ctrl.abort();
  let thrown = null;
  try { await proxyFetchRetry('/x', { signal: ctrl.signal }, { timeoutMs: 1000, ...NOJ }); } catch (e) { thrown = e; }
  ok('baştan iptal edilmiş istek: iptal hatası, yeniden deneme yok', thrown?.name === 'AbortError' && calls.length <= 1 && sleeps.length === 0);
}

// ================= 4. gecikmeler =================
{
  reset(); run([resp(502)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('varsayılan gecikme 4000 ms, 3 kez (jitter 0)', JSON.stringify(sleeps) === '[4000,4000,4000]');
}
{
  reset(); run([resp(502)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 1000 });
  ok('varsayılan jitter ±500 ms içinde (3500–4500)', sleeps.length === 3 && sleeps.every((m) => m >= 3500 && m <= 4500) && sleeps.some((m) => m !== 4000));
  ok('toplam bekleme ≤ 13,5 sn (15 sn sınırı içinde)', sleeps.reduce((a, b) => a + b, 0) <= 13500);
}
{
  reset(); run([resp(502)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 1000, retries: 2, delayMs: 1000, ...NOJ });
  ok('retries ve delayMs ayarlanabilir', JSON.stringify(sleeps) === '[1000,1000]' && calls.length === 3);
}

// ================= 5. ortak kapı =================
{
  reset(); run([resp(502)]);
  const N = 6;
  const rs = await Promise.all(Array.from({ length: N }, () => proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ })));
  ok('paralel N çağrı: hepsi son 502 ile döner', rs.every((r) => r.status === 502));
  ok('paralel N çağrı: tek ortak zamanlayıcı (3 uyku, N×3 değil)', sleeps.length === 3, `sleeps=${sleeps.length}`);
  ok('paralel N çağrı: çağrı başına en çok 1+retries deneme', calls.length <= N * 4, `calls=${calls.length}`);
  ok('paralel N çağrı: tek olay (toast) gönderilir', events.filter((e) => e === 'proxy-retrying').length === 1, JSON.stringify(events));
  calls.length = 0; sleeps.length = 0;
  for (let i = 0; i < 10; i++) await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('tükenmiş kesintide yeni çağrılar tek denemeyle döner (uyku yok, 10 çağrı = 10 istek)', calls.length === 10 && sleeps.length === 0, `calls=${calls.length}`);
  ok('soğuma süresinde yeni olay yok', events.filter((e) => e === 'proxy-retrying').length === 1);
  // soğuma bitince yeni bir deneme turu başlar
  const realNow = Date.now;
  Date.now = () => realNow() + 25000;
  try {
    calls.length = 0;
    await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
    ok('soğuma (20 sn) bitince yeni tur: 4 deneme ve yeni olay', calls.length === 4 && sleeps.length === 3 && events.filter((e) => e === 'proxy-retrying').length === 2);
  } finally { Date.now = realNow; }
}
{
  // Kesinti sürerken ortada başarı olursa kapı sıfırlanır; sonraki kesinti yeniden dener
  reset(); run([resp(502), resp(200)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('başarıdan sonra kapı temiz: ilk tur 1 olay', events.length === 1);
  run([resp(200)]);
  await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  run([resp(503), resp(200)]);
  const r = await proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ });
  ok('toparlanma sonrası yeni kesinti yeniden denenir ve ikinci olayı gönderir', r.status === 200 && events.length === 2);
}
{
  // Aynı turda gelen farklı kalan hak: geç gelen çağrı turun kalanına katılır, sınırı aşmaz
  reset(); run([resp(502)]);
  const a = proxyFetchRetry('/a', {}, { timeoutMs: 1000, ...NOJ, sleep: (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, 15)); } });
  await new Promise((r) => setTimeout(r, 20));
  const b = proxyFetchRetry('/b', {}, { timeoutMs: 1000, ...NOJ });
  await Promise.all([a, b]);
  ok('geç gelen çağrı da (1+retries)’i aşmaz', calls.filter((c) => c.url.endsWith('/b')).length <= 4 && calls.filter((c) => c.url.endsWith('/a')).length <= 4);
}

// ================= 6. toast olayı dinleyicisi =================
{
  const { watchProxyRetry } = await import('../js/ui/statusBadges.js');
  watchProxyRetry();
  reset(); run([resp(502)]);
  fakeToastEl.textContent = '';
  await Promise.all(Array.from({ length: 4 }, () => proxyFetchRetry('/x', {}, { timeoutMs: 1000, ...NOJ })));
  ok('toast: "Sunucuya ulaşılamıyor, yeniden deneniyor…" gösterilir', fakeToastEl.textContent === 'Sunucuya ulaşılamıyor, yeniden deneniyor…', fakeToastEl.textContent);
  ok('toast: kesinti başına tek olay', events.filter((e) => e === 'proxy-retrying').length === 1);
}

// ================= 7. HERE circle() davranışı =================
{
  const H = await import('../js/here/chargers.js');
  let lat = 40;
  const around = () => H.stationsAround(lat += 1, 30, 20); // her test ayrı koordinat (önbellek çakışmasın)
  const item = { id: 'a1', n: 'Zes Test', la: 40.1, lo: 30.1, s: 'Zes', dc: 120 };

  for (const [st, msg] of [[402, 'HERE aylık hakkı doldu'], [501, 'Sunucuda HERE anahtarı yok'], [401, 'Sunucu erişim kodu geçersiz']]) {
    reset(); run([resp(st), resp(200, JSON.stringify({ items: [item] }))]);
    const r = await around();
    ok(`HERE ${st}: fatal "${msg}", yeniden deneme yok (1 çağrı)`, r.fatal?.fatal === true && r.fatal.message === msg && calls.length === 1 && sleeps.length === 0, `${r.fatal?.message} calls=${calls.length}`);
  }
  {
    reset(); run([resp(502, JSON.stringify({ error: 'HERE HTTP 403' }))]);
    const r = await around();
    ok('HERE 502 + HERE 40x: yine fatal "HERE anahtarı geçersiz" (yeniden deneme tükendikten sonra)', r.fatal?.fatal === true && r.fatal.message === 'HERE anahtarı geçersiz' && calls.length === 4, `${r.fatal?.message} calls=${calls.length}`);
  }
  {
    reset(); run([resp(502, JSON.stringify({ error: 'HERE HTTP 429' })), resp(200, JSON.stringify({ items: [item] }))]);
    const r = await around();
    ok('HERE geçici 502 önce yeniden denenir, sonra 200 ile sonuç gelir', !r.fatal && r.out.size === 1 && calls.length === 2 && r.failed === 0, `calls=${calls.length} failed=${r.failed}`);
  }
  {
    reset(); run([resp(502, JSON.stringify({ error: 'HERE HTTP 500' }))]);
    const r = await around();
    ok('HERE 502 (40x değil) tükenince eski yol: HERE HTTP 502 + hiç sonuç yoksa fatal "HERE yanıt vermedi"', r.failed === 1 && r.lastError === 'HERE HTTP 502' && r.fatal?.message === 'HERE yanıt vermedi' && calls.length === 4);
  }
  {
    reset(); run([netErr()]);
    const r = await around();
    ok('HERE ağ hatası tükenince fatal "Ara sunucuya ulaşılamadı"', r.fatal?.fatal === true && r.fatal.message === 'Ara sunucuya ulaşılamadı' && calls.length === 4);
  }
  {
    reset(); run([resp(502), resp(200, JSON.stringify({ items: [item] }))]);
    const rs = await Promise.all([lat += 1, lat += 1, lat += 1].map((la) => H.stationsAround(la, 30, 20)));
    ok('HERE: üç paralel daire kesintide tek ortak zamanlayıcıyla toparlanır', rs.every((r) => !r.fatal && r.out.size === 1) && sleeps.length === 1, `sleeps=${sleeps.length}`);
  }
}

// ================= 8. Overpass / OpenChargeMap =================
{
  const O = await import('../js/osm/chargers.js');
  {
    reset(); run([resp(502), resp(200, JSON.stringify({ elements: [{ id: 1 }] }))]);
    const els = await O.overpass('q1');
    ok('Overpass ara sunucu kolu: 502 sonra 200 → yeniden denenir, doğrudan sunucuya düşülmez', els.length === 1 && calls.length === 2 && calls.every((c) => c.url === 'http://proxy.test/overpass'));
    ok('Overpass: POST gövdesi her denemede aynı', calls.every((c) => String(c.init.body) === 'data=q1' && c.init.method === 'POST'));
  }
  {
    reset();
    run([(url) => (url.startsWith('http://proxy.test') ? resp(502) : resp(200, JSON.stringify({ elements: [{ id: 7 }, { id: 8 }] })))]);
    const els = await O.overpass('q2');
    const urls = calls.map((c) => c.url);
    ok('Overpass: ara sunucu tükenince (4 deneme) halka açık sunuculara düşer ve sonuç alır', els.length === 2 && urls.slice(0, 4).every((u) => u === 'http://proxy.test/overpass') && urls[4] === 'https://overpass-api.de/api/interpreter' && urls.length === 5, JSON.stringify(urls));
  }
  {
    reset();
    run([(url) => (url.startsWith('http://proxy.test') ? netErr() : resp(200, JSON.stringify({ elements: [{ id: 9 }] })))]);
    const els = await O.overpass('q3');
    ok('Overpass: ağ hatasıyla tükenince de doğrudan sunucuya düşer (eski davranış)', els.length === 1 && calls.length === 5);
  }
  {
    reset(); run([resp(429), resp(200, JSON.stringify({ elements: [{ id: 1 }] }))]);
    const els = await O.overpass('q4').catch((e) => e);
    ok('Overpass: ara sunucu 429 yeniden denenmez (doğrudan sunucuya düşer)', calls[0].url === 'http://proxy.test/overpass' && calls[1].url.startsWith('https://overpass') && Array.isArray(els));
  }
  {
    reset(); run([resp(503), resp(200, '[]')]);
    const r = await O.testOcm();
    ok('OpenChargeMap ara sunucu kolu: 503 sonra 200 → yeniden denenir', r.ok === true && calls.length === 2 && calls[0].url.startsWith('http://proxy.test/ocm/poi'), JSON.stringify(r));
  }
  {
    reset(); run([resp(401), resp(200, '[]')]);
    const r = await O.testOcm();
    ok('OpenChargeMap 401 yeniden denenmez, ileti aynı', r.ok === false && r.text === 'Sunucu erişim kodu geçersiz' && calls.length === 1);
  }
  {
    reset(); run([resp(502)]);
    const r = await O.testOcm();
    ok('OpenChargeMap 502 tükenince eski ileti: OpenChargeMap HTTP 502', r.ok === false && r.text === 'OpenChargeMap HTTP 502' && calls.length === 4);
  }
}

// ================= 9. Mapbox =================
{
  const A = await import('../js/mapbox/api.js');
  const M = await import('../js/mapbox/chargers.js');
  const feat = { properties: { name: 'Test AC', mapbox_id: 'mbx1' }, geometry: { coordinates: [30.2, 40.2] } };
  {
    reset();
    let cat = 0;
    run([(url) => (url.includes('/list/category') ? resp(200, '{}') : (cat++ === 0 ? resp(502) : resp(200, JSON.stringify({ features: [feat] }))))]);
    const r = await M.stationsAround(40.2, 30.2, 5);
    const catCalls = calls.filter((c) => c.url.includes('/category/') && !c.url.includes('/list/'));
    ok('Mapbox istasyon araması: 502 sonra 200 → yeniden denenir, kutu başarısız sayılmaz', r.failed === 0 && !r.fatal && r.out.size === 1 && catCalls.length === 2, `failed=${r.failed} fatal=${r.fatal?.message} cat=${catCalls.length}`);
  }
  {
    reset(); run([resp(502), resp(200, '{}')]);
    let err = null;
    try { await A.mbfetch('/directions/v5/mapbox/driving/1,1;2,2', {}); } catch (e) { err = e; }
    ok('mbfetch varsayılan: yeniden deneme YOK (rota/coğrafi kodlama) → 502 hatası, 1 çağrı', err?.status === 502 && calls.length === 1 && sleeps.length === 0);
  }
  {
    reset(); run([netErr(), resp(200, '{"ok":1}')]);
    let err = null;
    try { await A.mbfetch('/geocoding/v5/mapbox.places/x.json', {}); } catch (e) { err = e; }
    ok('mbfetch varsayılan: ağ hatası yeniden denenmez → fatal "Ara sunucuya ulaşılamadı"', err?.fatal === true && err.message === 'Ara sunucuya ulaşılamadı' && calls.length === 1);
  }
  {
    reset(); run([resp(502), resp(200, '{"ok":1}')]);
    const j = await A.mbfetch('/search/x', {}, { retry: true });
    ok('mbfetch { retry: true }: 502 sonra 200 → yeniden denenir', j.ok === 1 && calls.length === 2);
  }
  {
    reset(); run([netErr()]);
    let err = null;
    try { await A.mbfetch('/search/x', {}, { retry: true }); } catch (e) { err = e; }
    ok('mbfetch { retry: true }: ağ hatası tükenince fatal "Ara sunucuya ulaşılamadı" (4 deneme)', err?.fatal === true && err.message === 'Ara sunucuya ulaşılamadı' && calls.length === 4);
  }
  {
    reset(); run([resp(402), resp(200, '{}')]);
    let err = null;
    try { await A.mbfetch('/search/x', {}, { retry: true }); } catch (e) { err = e; }
    ok('mbfetch { retry: true }: 402 yeniden denenmez, fatal', err?.status === 402 && err.fatal === true && calls.length === 1);
  }
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
