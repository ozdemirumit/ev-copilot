// "Rotaya Ekle" (js/routing/addToRoute.js, ui/addRoute.js, controller.js, stationCard.js): uygunluk, ara noktalar, geri dönüş, doğrulama,
// metin sözlüğü, bağlantı, çeviriler. Kullanım: node scripts/test-add-to-route.mjs — düz Node, ağ yok, sentetik rota/istasyon.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = new URL('https://example.test/');
globalThis.document = { getElementById: () => null, createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} }, append() {}, addEventListener() {} }), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { append() {}, classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} } };
globalThis.window = globalThis;

const A = await import('../js/routing/addToRoute.js');
const { addEligibility, stationAt, lockedAhead, addVias, startUturn, judgeAddRoute, ADD_TEXT, ADD_MAX_OFF_KM, PREVIEW_TTL_MS, GPS_MAX_ACC_M, GPS_MAX_OFF_KM, START_TURN_DEG } = A;
const { MAX_VIA } = await import('../js/routing/stopVia.js');

// ---- sentetik rota (kaplumbağa): segs [{ len (m), turn (derece, sol +) }] → [lon, lat]
const LAT0 = 40, LON0 = 30;
const route = (segs, stepM = 50) => {
  let x = 0, y = 0, th = 0;
  const pts = [[x, y]];
  for (const { len, turn = 0 } of segs) {
    const n = Math.max(1, Math.ceil(len / stepM)); const dth = (turn * Math.PI) / 180 / n; const ds = len / n;
    for (let i = 0; i < n; i++) { th += dth / 2; x += ds * Math.cos(th); y += ds * Math.sin(th); th += dth / 2; pts.push([x, y]); }
  }
  return pts.map(([px, py]) => [LON0 + px / (111320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + py / 110574]);
};
const at = (xM, yM) => ({ lat: LAT0 + yM / 110574, lon: LON0 + xM / (111320 * Math.cos((LAT0 * Math.PI) / 180)) });
const line = route([{ len: 6000 }]); // 6 km doğuya düz
const st = (id, x, y) => ({ id, name: 'İstasyon ' + id, ...at(x, y) });

// 1) stationAt: izdüşüm km ve rotadan uzaklık
{
  const a = stationAt(line, st('S1', 2000, 150));
  ok('stationAt: km ≈ 2,0 ve rotadan ≈ 0,15 km', !!a && Math.abs(a.km - 2.0) < 0.1 && Math.abs(a.offKm - 0.15) < 0.05, JSON.stringify(a));
  ok('stationAt: bozuk girdi null', stationAt(null, st('S', 1, 1)) === null && stationAt(line, { id: 'x' }) === null && stationAt([[30, 40]], st('S', 1, 1)) === null);
}

// 2) addEligibility
{
  const stops = [{ km: 3, station: { id: 'L1' } }, { km: 0.2, station: { id: 'GERI' } }];
  const plan = (o = {}) => ({ status: 'ready', route: { coords: line }, profile: { totalKm: 6 }, stops, userPins: ['L1', 'GERI'], leaveSocs: {}, fromKm: 0, ...o });
  const s = st('S1', 2000, 150);
  const el = (o = {}, atv = { km: 2, offKm: 0.15 }, here = 0, station = s) => addEligibility({ plan: plan(o), station, at: atv, here });
  ok('uygun: ok true, neden yok', (() => { const r = el(); return r.show && r.ok && r.reason === null; })());
  ok('rota yok: düğme gösterilmez (noroute)', (() => { const r = addEligibility({ plan: { status: 'none' }, station: s, at: null }); return !r.show && !r.ok && r.reason === 'noroute'; })());
  ok('rota hesaplanıyor: açıklama gösterilir (loading)', (() => { const r = addEligibility({ plan: { status: 'loading' }, station: s, at: null }); return r.show && !r.ok && r.reason === 'loading'; })());
  ok('zaten kilitli ileri durak (locked)', (() => { const r = el({}, { km: 3, offKm: 0.1 }, 0, { ...s, id: 'L1' }); return r.show && !r.ok && r.reason === 'locked'; })());
  ok('geride kalan kilitli durak kilit sayılmaz (GERİ: km 0,2 ≤ 0,5)', (() => { const r = el({}, { km: 2, offKm: 0.1 }, 0, { ...s, id: 'GERI' }); return r.ok; })());
  ok('izdüşüm yok: uzak (far)', el({}, null).reason === 'far');
  ok(`rotadan > ${ADD_MAX_OFF_KM} km: uzak (far)`, el({}, { km: 2, offKm: ADD_MAX_OFF_KM + 0.1 }).reason === 'far' && el({}, { km: 2, offKm: ADD_MAX_OFF_KM }).ok);
  ok('aracın gerisinde: geçti (passed); sınır 0,5 km', el({}, { km: 1.2, offKm: 0.1 }, 1.0).reason === 'passed' && el({}, { km: 1.51, offKm: 0.1 }, 1.0).ok);
  ok('varışın ötesinde (beyond); sınır varış−0,5 km', el({}, { km: 5.6, offKm: 0.1 }).reason === 'beyond' && el({}, { km: 5.4, offKm: 0.1 }).ok);
  ok('bozuk istasyon (koordinat yok): gösterilmez', (() => { const r = el({}, { km: 2, offKm: 0.1 }, 0, { id: 'x' }); return !r.show && !r.ok; })());
  ok('infeasible plan da uygun sayılır (kullanıcı çözüm arıyor)', el({ status: 'infeasible' }).ok);
}

// 3) lockedAhead: elle seçilen, şarj hedefi verilen, Git ile seçilen ilk durak; yalnız ileridekiler
{
  const plan = { fromKm: 0, userPins: ['P'], leaveSocs: { T: 80 }, forceFirstId: 'F', stops: [
    { km: 1, station: { id: 'P' } }, { km: 2, station: { id: 'T' } }, { km: 3, station: { id: 'F' } }, { km: 4, station: { id: 'OTO' } }, { km: 0.3, station: { id: 'P' } }] };
  const ids = lockedAhead(plan, 0).map((s) => s.station.id).sort();
  ok('kilitli: pin + şarj hedefi + zorunlu ilk durak; otomatik durak değil; geride kalan elenir', ids.join() === 'F,P,T', ids.join());
  ok('ilerleyen konumda önceki duraklar düşer', lockedAhead(plan, 2.2).map((s) => s.station.id).join() === 'F');
}

// 4) addVias: rota sırasıyla ara noktalar
{
  const add = { km: 2, station: st('A', 2000, 100) };
  const locked = [{ km: 4, station: st('L2', 4000, 50) }, { km: 1, station: st('L1', 1000, 50) }, { km: 2, station: add.station }];
  const v = addVias({ locked, add, stopover: at(3000, 0), stopoverKm: 3, fromKm: 0 });
  ok('ara noktalar km sırasıyla (L1, A, ara durak, L2) ve eklenen yinelenmez', v && v.ids.join() === 'L1,A,L2' && v.wps.length === 4, JSON.stringify(v?.ids));
  ok('ara durak ileride değilse eklenmez', addVias({ add, stopover: at(500, 0), stopoverKm: 0.3, fromKm: 0.2 }).wps.length === 1);
  ok(`sağlayıcı sınırı (${MAX_VIA}) aşılırsa null`, addVias({ locked: Array.from({ length: MAX_VIA }, (_, i) => ({ km: i + 3, station: st('X' + i, 3000 + i, 0) })), add, fromKm: 0 }) === null);
  ok('ids yalnız istasyonları içerir (ara durak id null elenir)', v.ids.every((x) => typeof x === 'string'));
}

// 5) startUturn: yeni rota başlangıçta ters yöne gidiyor mu
{
  const origin = at(0, 0);
  ok('aynı yönde devam: geri dönüş yok', startUturn(route([{ len: 3000 }]), 90 /* doğu */, origin) === false);
  ok('ters yöne başlıyor: geri dönüş var', startUturn(route([{ len: 400, turn: 0 }, { len: 3000 }]).map(([lo, la]) => [2 * LON0 - lo, la]), 90, origin) === true);
  ok('çok kısa rota (< 1,2 km): güvenli false', startUturn(route([{ len: 800 }]), 270, origin) === false);
  ok('yön bilinmiyorsa false', startUturn(line, null, origin) === false);
  ok(`eşik sabiti ${START_TURN_DEG}°`, START_TURN_DEG === 100);
}

// 6) judgeAddRoute
{
  ok('başlangıçta geri dönüş: startuturn', judgeAddRoute({ viaIssues: [], addId: 'A', startTurn: true }).reason === 'startuturn');
  ok('eklenen istasyon sorunlu: kendi nedeni + adı', (() => { const r = judgeAddRoute({ viaIssues: [{ id: 'A', name: 'Ada', reason: 'noreach' }, { id: 'B', name: 'B', reason: 'novia' }], addId: 'A' }); return !r.ok && r.reason === 'noreach' && r.names.join() === 'Ada'; })());
  ok('yalnız diğer duraklar sorunlu: others + adları', (() => { const r = judgeAddRoute({ viaIssues: [{ id: 'B', name: 'Bor', reason: 'novia' }, { id: 'C', name: 'Can', reason: 'uturn' }], addId: 'A' }); return !r.ok && r.reason === 'others' && r.names.join() === 'Bor,Can'; })());
  ok('sorun yok: ok', judgeAddRoute({ viaIssues: [], addId: 'A' }).ok === true);
}

// 7) Açıklama sözlüğü: üretilebilecek her neden için metin var
{
  const reasons = ['noroute', 'loading', 'locked', 'passed', 'far', 'beyond', 'busy', 'gps', 'blocked', 'unverified', 'provider', 'noreach', 'novia', 'uturn', 'startuturn', 'others', 'plan', 'changed', 'stale'];
  ok('ADD_TEXT: 19 neden için metin (eligibility + viaCheck + denetleyici nedenleri)', reasons.every((r) => typeof ADD_TEXT[r] === 'string' && ADD_TEXT[r].length > 10) && Object.keys(ADD_TEXT).length === reasons.length, Object.keys(ADD_TEXT).join());
  ok('denetleyicinin döndürdüğü tüm nedenler sözlükte', (() => { const src = read('js/routing/controller.js'); const rs = [...src.matchAll(/fail\('([a-z]+)'/g)].map((m) => m[1]); return rs.length > 8 && rs.every((r) => reasons.includes(r)); })());
  ok('eşikler: önizleme 120 sn, GPS doğruluğu 100 m, rotadan 300 m, rotaya uzaklık 15 km', PREVIEW_TTL_MS === 120000 && GPS_MAX_ACC_M === 100 && GPS_MAX_OFF_KM === 0.3 && ADD_MAX_OFF_KM === 15);
}

// 8) Güvenlik tasarımı: saf modül ağ/DOM kullanmaz; denetleyici fail-closed kapıları
{
  const pure = read('js/routing/addToRoute.js');
  ok('addToRoute.js saf: fetch/document/localStorage yok', !/\bfetch\(|document\.|localStorage/.test(pure));
  const c = read('js/routing/controller.js');
  ok('erişim doğrulanmadıysa EKLENMEZ (rec.verified yoksa unverified, ok değilse blocked)', /if \(!rec \|\| !rec\.verified\) return fail\('unverified'/.test(c) && /if \(!rec\.ok\) return fail\('blocked'\)/.test(c));
  const run = c.slice(c.indexOf('async function runAddPreview')); // yalnız ekleme önizlemesi (başka fonksiyonlardaki verifyStops çağrıları sayılmaz)
  ok('ağ çağrılarından önce uygunluk ve (navigasyonda) GPS doğruluğu denetlenir', run.indexOf("return fail('gps')") > 0 && run.indexOf("return fail('gps')") < run.indexOf('await verifyStops') && run.indexOf('const el = addEligibility') < run.indexOf('await verifyStops') && run.indexOf('await verifyStops') < run.indexOf('await route(v.wps)'));
  ok('plan YALNIZ onayla değişir: previewAddToRoute durumu yazmaz, applyAddToRoute eski önizlemeyi reddeder (changed/stale)', /preview\.seq !== tripSeq \|\| preview\.planId !== pl\.planId/.test(c) && /now - preview\.at > PREVIEW_TTL_MS\) return \{ ok: false, reason: 'stale' \}/.test(c));
  ok('aynı anda tek ekleme hesabı (busy)', /if \(addRun\) return addRun\.id === station\?\.id \? addRun\.p : Promise\.resolve\(\{ ok: false, reason: 'busy'/.test(c));
  ok('rota temizlenince süren önizleme geçersiz (addRun = null)', /addRun = null; \/\/ v0\.99\.108: süren Rotaya Ekle önizlemesi/.test(c));
  ok('yeni rotada eklenen istasyon + kilitli duraklar viaCheck ile doğrulanır', /const vc = viaCheck\(\{ coords: rt\.coords, stops: out\.result\.stops, fromKm: 0, viaIds, pinIds: \[\] \}\)/.test(c) && /judgeAddRoute\(\{ viaIssues: vc\.issues, addId: station\.id/.test(c));
  ok('kullanıcı kilitleri (userPins) onayda plana yazılır ve yeniden rotada korunur', /userPins = \[\.\.\.new Set\(\[\.\.\.locked\.map/.test(c) && /const keepU = from \?/.test(c));
}

// 9) Arayüz bağlantısı
{
  const card = read('js/ui/stationCard.js');
  ok('istasyon kartı: yalnız uygunsa "➕ Rotaya Ekle", değilse neden metni', /if \(elig\.ok\) acts\.append\(btn\('➕ ' \+ tr\('Rotaya Ekle'\)/.test(card) && /addReasonText\(elig\.reason\)/.test(card));
  ok('istasyon kartı: planlı/eklenen durakta 🎯 %hedef düğmesi openTarget açar', /import \{ openTarget \} from '\.\/stopTarget\.js'/.test(card) && /btn\('🎯 %' \+ Math\.round\(stop\.leaveSoc\), \(\) => \{ close\(\); openTarget\(stop\); \}/.test(card));
  const ui = read('js/ui/addRoute.js');
  ok('onay penceresi: önizleme sürerken Onayla kapalı, İptal/✕/Esc değişiklik yapmaz', /apply\.disabled = true/.test(ui) && /cancel\.addEventListener\('click', close\)/.test(ui) && /if \(my !== tok \|\| !d\.open\) return/.test(ui));
  ok('onay: applyAddToRoute sonucu başarısızsa açık metin, başarıda bilgi', /if \(!r\.ok\) return toast\(addReasonText\(r\.reason\), 8000\)/.test(ui));
  ok('sw.js SHELL iki yeni dosyayı içerir (çevrimdışı)', read('sw.js').includes("'./js/routing/addToRoute.js'") && read('sw.js').includes("'./js/ui/addRoute.js'"));
}

// 10) Önizleme satırları (DOM'suz)
{
  const { addLines } = await import('../js/ui/addRoute.js');
  const pv = { station: { name: 'Test İst.' }, stop: { arriveSoc: 14.6, leaveSoc: 80.2, minutes: 31.4 }, addKm: 3.26, addMin: -2.4, provider: 'osm', elevOk: true, wxOk: true, socTrusted: true, moving: false };
  const l = addLines(pv);
  ok('önizleme: ad, pil %15 → %80 ~31 dk, +3,3 km, −2 dk, sağlayıcı', l[0].includes('Test İst.') && l[1].includes('%15') && l[1].includes('%80') && l[1].includes('31') && l[2].includes('+3.3') && l[2].includes('−2') && l[3].includes('OSM/Valhalla'), JSON.stringify(l));
  ok('önizleme: veri tam ve pil güvenilirken uyarı satırı yok (4 satır)', l.length === 4);
  ok('önizleme: rakım/hava yoksa ve hareket hâlinde pil güvenilmezse iki uyarı eklenir', addLines({ ...pv, elevOk: false, socTrusted: false, moving: true }).length === 6);
}

// 11) Çeviriler: 34 yeni metin x 11 dil
{
  const KEYS = [
    'Yeni zorunlu durak: {0}', 'Durakta %{0} → %{1} (~{2} dk şarj)', 'Kalan yol {0} km · sürüş {1} dk', 'Rota: {0} · istasyon ara nokta, gidiş yönünde erişim doğrulandı',
    'Rakım ya da hava alınamadı: tahmin bu verisiz.', 'Pil okuması güvenilir değil: planın beklediği pil kullanıldı.', 'Rotaya Ekle', 'Onayla ve rotayı güncelle',
    'Rota güncellendi ama durak doğrulanamadı: {0}', 'Rotaya eklendi: {0}. Mavi rota istasyondan geçiyor; sonraki duraklar yeniden hesaplandı.',
    'Gidiş yönünde erişim doğrulanıyor ve istasyon üzerinden rota hesaplanıyor…', ...Object.values(ADD_TEXT),
    'yol ağı sorgusu yapılamadı', 'ara nokta sınırı aşıldı', 'rota yanıtı boş', 'durak planda yok',
  ];
  const extra = JSON.parse(read('i18n/keys.extra.json'));
  ok(`${KEYS.length} çeviri anahtarı keys.extra.json içinde`, KEYS.every((k) => extra.includes(k)), KEYS.filter((k) => !extra.includes(k)).join(' | '));
  const ph = (s) => (s.match(/\{\d\}/g) || []).sort().join('');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let all = true, why = '';
  for (const l of ['bg', 'de', 'el', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ro']) {
    const src = read(`js/i18n/lang/${l}.extra.js`);
    for (const k of KEYS) {
      const m = src.match(new RegExp('^  ' + esc(JSON.stringify(k)) + ': (".*"),$', 'm'));
      if (!m) { all = false; why = `${l}: yok ${k}`; break; }
      const v = JSON.parse(m[1]);
      if (ph(v) !== ph(k) || v === k) { all = false; why = `${l}: yer tutucu/kopya ${k}`; break; }
    }
    if (!all) break;
  }
  ok('11 dilde tüm metinler var, yer tutucular aynı, Türkçe kopya değil', all, why);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
