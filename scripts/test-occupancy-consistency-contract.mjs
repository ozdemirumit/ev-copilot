// BL-P2-09 R3: nav/planlayıcı ↔ fail-closed doluluk biçimlendiricisi TUTARLILIK SÖZLEŞMESİ — çevrimdışı regresyon testi.
// node scripts/test-occupancy-consistency-contract.mjs   (ağ yok, anahtar yok, sağlayıcı çağrısı yok; sentetik fikstür + kaynak denetimi)
//
// Bu test bir DÜZELTME İDDİA ETMEZ. Üç tür denetim yapar:
//  1) KONTROL  : bugün tutarlı olması gereken ve tutarlı olan durumlar (normal PASS).
//  2) KNOWN-GAP: bugün bilinen çelişkiler (docs/occupancy-consistency-contract.md G1..G7). Çelişki HÂLÂ VARSA beklenen bulgu
//                olarak sayılır (PASS değil "KNOWN-GAP present"). Çelişki KENDİLİĞİNDEN kaybolursa test BAŞARISIZ olur:
//                "GAP CLOSED" → gelecekteki düzeltme görevi bu boşluğu sözleşme kabul denetimine (ACCEPT) taşımalı ve belgeyi güncellemelidir.
//  3) ACCEPT   : düzeltmenin kabul ölçütleri. D3-T4 (v0.99.83) görüntü yolunu (G3/G3b/G3c/G6b), D3-T5 (v0.99.84) nav/planlayıcı
//                karar yolunu (G1/G2/G2b/G4/G4b/G5/G6/G7: slots.js slotKind/isFresh → doğrulanmış occupancyDecision) kapattı;
//                bu boşluklar artık ACCEPT denetimidir. Yeniden açılırlarsa test BAŞARISIZ olur.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const read = (p) => readFileSync(join(root, p), 'utf8');

const stored = new Map(); // config.js (planlayıcı) localStorage okur; sahte, boş
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };

const { formatOccupancy } = await imp('js/routing/occupancyLabel.js');
const { slotKind, isFresh, slotEl, slotLabel, FRESH_MS } = await imp('js/routing/slots.js');
const { availability: nearAvail, sortNearby } = await imp('js/nav/nearSort.js');
const { planRoute, usable } = await imp('js/routing/planner.js');
const { fromNdwAvailabilities, buildAvailability } = await imp('server/availability.mjs');

let pass = 0, fail = 0, gaps = 0;
const results = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
/** Bilinen boşluk: present=true → beklenen bulgu; false → boşluk kapanmış, sözleşme güncellenmeli (FAIL). */
const knownGap = (id, name, present, extra = '') => {
  results.push({ id, name, present });
  if (present) { gaps++; console.log(`KNOWN-GAP present ${id}: ${name}`); }
  else { fail++; console.log(`FAIL GAP CLOSED ${id}: ${name} — belge + testi ACCEPT'e taşı`, extra); }
};

// slots.js saati kendisi okur (Date.now); fikstürler bu ana göre kurulur. Biçimlendiriciye aynı an `now` olarak verilir.
const NOW = Date.now();
const MIN = 60e3;
const fmt = (s) => formatOccupancy(s, { now: NOW });

// ---------- Sahte document (yalnızca slotEl'in kullandığı yüzey) ----------
class El { constructor(tag) { this.tagName = tag; this.className = ''; this.children = []; this._text = ''; this.translate = true; }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c instanceof El ? c.textContent : c.text)).join(''); } }
globalThis.document = { createElement: (t) => new El(t) };

// ---------- Sentetik fikstürler ----------
// Sunucu (server/occupancy.mjs ndw()) dönüşü: eski alanlar + `availability` (normalize). NDW zaman vermez: at = okuma anı.
// İstemci eşlemesi (js/routing/occupancyClient.js) aynen taklit edilir: { total, available, out, at, checked, src, price, community, availability }.
const clientSlots = (r) => ({ total: r.total, available: r.available, out: r.out ?? 0, at: r.at, checked: NOW, src: r.src, price: r.price || null, community: r.community || null, availability: r.availability || null });
const ndwServer = (available, total) => {
  const conns = [{ available, total, power_max: 150000 }];
  return { src: 'ndw', total, available, out: null, at: NOW, price: null, availability: fromNdwAvailabilities(conns, { now: NOW }) };
};
const NDW_FREE = clientSlots(ndwServer(2, 4)); // "2/4 boş" — zamanı yalnızca okuma anı (fetched)
const NDW_FULL = clientSlots(ndwServer(0, 4)); // "0/4" — NDW durum ayrıntısı vermez: boş olmayanlar UNKNOWN
// Kontrol: sağlayıcı zamanlı (Google benzeri) taze kayıt — formatter canlı teyit verir.
const provAv = (counts, atAgoMin) => buildAvailability({ source: 'google', counts, at: NOW - atAgoMin * MIN, fetchedAt: NOW, now: NOW });
const PROV_FREE = clientSlots({ src: 'google', total: 4, available: 3, out: 0, at: NOW - 3 * MIN, availability: provAv({ AVAILABLE: 3, CHARGING: 1 }, 3) });
const PROV_FULL = clientSlots({ src: 'google', total: 4, available: 0, out: 0, at: NOW - 3 * MIN, availability: provAv({ CHARGING: 4 }, 3) });
// Kontrol: eski (3 sa) sağlayıcı kaydı — her iki yol da "boş/dolu" demez.
const OLD = 3 * 60 * MIN;
const PROV_STALE = { ...clientSlots({ src: 'google', total: 4, available: 3, out: 0, at: NOW - OLD, availability: provAv({ AVAILABLE: 3, CHARGING: 1 }, 180) }), checked: NOW - OLD };

const station = (id, slots, extra = {}) => ({ id, name: id, slots, distKm: 1, kw: 180, price: 14, ...extra });

// ---------- 0) Fikstür ve kaynak ön koşulları (uyuşmazlıkta dur) ----------
{
  ok('NDW normalize: timestampKind fetched', NDW_FREE.availability?.timestampKind === 'fetched', JSON.stringify(NDW_FREE.availability));
  ok('NDW normalize: source ndw, simulated false', NDW_FREE.availability?.source === 'ndw' && NDW_FREE.availability?.simulated === false);
  ok('NDW 0/4: boş olmayanlar UNKNOWN', NDW_FULL.availability?.counts?.UNKNOWN === 4 && NDW_FULL.availability?.counts?.AVAILABLE === 0);
  const occ = read('server/occupancy.mjs');
  ok('sunucu NDW eski alanı at = okuma anı (Date.now)', /src: 'ndw'[^\n]*at: Date\.now\(\)/.test(occ));
  ok('sunucu NDW availability = fromNdwAvailabilities', /src: 'ndw'[^\n]*availability: fromNdwAvailabilities\(conns\)/.test(occ));
  const cli = read('js/routing/occupancyClient.js');
  ok('istemci eşlemesi: at: r.at, checked: Date.now(), availability taşınır', /at: r\.at, checked: Date\.now\(\)/.test(cli) && /availability: r\.availability \|\| null/.test(cli));
  ok('FRESH_MS = 15 dk', FRESH_MS === 15 * MIN);
}

// ---------- 1) KONTROL: bugün tutarlı olanlar ----------
{
  const f = fmt(PROV_FREE);
  ok('kontrol: sağlayıcı zamanlı taze boş → formatter free + confirmed', f.state === 'free' && f.confirmed === true, JSON.stringify(f));
  ok('kontrol: sağlayıcı zamanlı taze boş → slotKind free + isFresh', slotKind(station('p', PROV_FREE)) === 'free' && isFresh(station('p', PROV_FREE)));
  const g = fmt(PROV_FULL);
  ok('kontrol: sağlayıcı zamanlı taze dolu → formatter busy + confirmed', g.state === 'busy' && g.confirmed === true, JSON.stringify(g));
  ok('kontrol: sağlayıcı zamanlı taze dolu → slotKind full', slotKind(station('p', PROV_FULL)) === 'full');
  const s = fmt(PROV_STALE);
  ok('kontrol: 3 sa eski → formatter unknown/stale', s.state === 'unknown' && s.reason === 'stale', JSON.stringify(s));
  ok('kontrol: 3 sa eski → nearSort "stale" (boş/dolu denmez)', nearAvail(station('p', PROV_STALE), NOW) === 'stale');
  ok('kontrol: 3 sa eski → isFresh false (planlayıcı dolu saymaz)', !isFresh(station('p', PROV_STALE)));
  ok('kontrol: veri yok → formatter unknown, slotKind unknown', fmt(null).state === 'unknown' && slotKind(station('x', null)) === 'unknown');
}

// ---------- 2) KNOWN-GAP: NDW yalnızca okuma zamanlı (fetched) kayıt ----------
{
  const fF = fmt(NDW_FREE);
  // Formatter tarafı bugün zaten fail-closed (bu bir kontroldür, boşluk değil):
  ok('formatter: NDW fetched 2/4 → unknown (unverified-time), confirmed false', fF.state === 'unknown' && fF.reason === 'unverified-time' && fF.confirmed === false, JSON.stringify(fF));
  const fB = fmt(NDW_FULL);
  ok('formatter: NDW fetched 0/4 → unknown, asla busy', fB.state === 'unknown' && fB.confirmed === false, JSON.stringify(fB));
  // Sağlayıcı zamanı olsaydı bile 0/4 + UNKNOWN EVSE "dolu" sayılmaz (formatter kuralı):
  const fB2 = formatOccupancy({ ...NDW_FULL.availability, timestampKind: 'provider', at: NOW - MIN }, { now: NOW });
  ok('formatter: NDW 0/4 sağlayıcı zamanlı olsa da UNKNOWN EVSE → unknown-evse', fB2.state === 'unknown' && fB2.reason === 'unknown-evse', JSON.stringify(fB2));

  const sF = station('ndwF', NDW_FREE), sB = station('ndwB', NDW_FULL);
  // G1/G2/G2b KAPANDI (D3-T5, v0.99.84): tazelik kapısı okuma anını (checked) değil doğrulanmış sağlayıcı kararını kullanır;
  // NDW fetched kayıt ne taze ne boş/dolu sayılır (ACCEPT).
  ok('ACCEPT G1 (D3-T5): isFresh(NDW fetched 2/4 ve 0/4) === false', isFresh(sF) === false && isFresh(sB) === false);
  ok("ACCEPT G2 (D3-T5): slotKind(NDW fetched 0/4) === 'unknown' (asla full)", slotKind(sB) === 'unknown', slotKind(sB));
  ok("ACCEPT G2b (D3-T5): slotKind(NDW fetched 2/4) === 'unknown' (asla free)", slotKind(sF) === 'unknown', slotKind(sF));
  // G3/G3b/G3c KAPANDI (D3-T4, v0.99.83): liste/kart görüntüsü (slotEl/slotLabel) saf occupancyDecision kararıyla yalnız
  // Müsait / Dolu / Bilinmiyor gösterir → NDW fetched kayıtta "⚪ Bilinmiyor"; sayı, yaş, "boş"/"dolu" yazılmaz (ACCEPT).
  const elF = slotEl(sF)?.textContent || '', elB = slotEl(sB)?.textContent || '';
  ok('ACCEPT G3 (D3-T4): slotEl(NDW fetched 2/4) → "⚪ Bilinmiyor", sayı/yaş yok', elF === ' · ⚪ Bilinmiyor', elF);
  ok('ACCEPT G3b (D3-T4): slotEl(NDW fetched 0/4) → "⚪ Bilinmiyor", asla dolu', elB === ' · ⚪ Bilinmiyor', elB);
  ok('ACCEPT G3c (D3-T4): slotLabel(NDW fetched 2/4) → "⚪ Bilinmiyor"', slotLabel(sF) === '⚪ Bilinmiyor', slotLabel(sF));
  ok('ACCEPT (D3-T4): sağlayıcı zamanlı taze kayıtta görüntü korunur (Müsait/Dolu + sayı)', /^ · 🟢 Müsait · 3\/4 · 3 dk önce/.test(slotEl(station('p', PROV_FREE))?.textContent || '') && /^ · 🔴 Dolu · 0\/4 · 3 dk önce/.test(slotEl(station('p', PROV_FULL))?.textContent || ''), slotEl(station('p', PROV_FREE))?.textContent);
  ok('ACCEPT (D3-T4): 3 sa eski kayıt → "⚪ Bilinmiyor"', slotEl(station('p', PROV_STALE))?.textContent === ' · ⚪ Bilinmiyor', slotEl(station('p', PROV_STALE))?.textContent);
  // G4/G4b KAPANDI (D3-T5): yakın istasyon sıralaması NDW fetched kaydını dolu saymaz; mesafe sırası korunur (ACCEPT).
  ok("ACCEPT G4 (D3-T5): nearSort.availability(NDW fetched 0/4) === 'unknown'", nearAvail(sB, NOW) === 'unknown', nearAvail(sB, NOW));
  const near = sortNearby([station('ndwB', NDW_FULL, { distKm: 1 }), station('none', null, { distKm: 5 })], 'near', NOW);
  const order = (Array.isArray(near) ? near : near?.items || near?.list || []).map((x) => x.id);
  ok('ACCEPT G4b (D3-T5): sortNearby: 1 km NDW 0/4 istasyon 5 km bilinmeyenin ÖNÜNDE (mesafe sırası)', order[0] === 'ndwB' && order[1] === 'none', order.join());

  // G5 KAPANDI (D3-T5): planlayıcı NDW 0/4'ü "taze dolu" saymaz; yakın durak plandan çıkarılmaz, bekleme eklenmez (ACCEPT).
  const KWH_PER_KM = 0.25;
  const profile = { totalKm: 400, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * KWH_PER_KM * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
  const st = (id, km, slots = null) => ({ id, name: id, km, lat: 40 + km * 1e-4, lon: 30, kw: 180, price: 14, opId: 'x', opName: 'X', slow: false, uncertain: false, offKm: 0.2, slots });
  const base = { profile, startKm: 0, startSoc: 50, minArrival: 15, mode: 'fast', k: 1 };
  const plan0 = planRoute({ ...base, stations: [st('a100', 100), st('b104', 104), st('c250', 250), st('d254', 254)] });
  const first = plan0.stops?.[0]?.station;
  ok('planlayıcı fikstürü: ilk durak ≤150 km (WAIT_NEAR_KM içinde)', plan0.feasible && first && first.km <= 150, JSON.stringify(plan0.stops?.map((s) => s.station.id)));
  if (first) {
    const stations = [st('a100', 100), st('b104', 104), st('c250', 250), st('d254', 254)].map((s) => (s.id === first.id ? { ...s, slots: NDW_FULL } : s));
    const plan1 = planRoute({ ...base, stations });
    const ids1 = plan1.stops.map((s) => s.station.id);
    ok(`ACCEPT G5 (D3-T5): planRoute: NDW fetched 0/4 olan ilk durak (${first.id}) planda kalır, bekleme yok`, plan1.feasible && ids1.join() === plan0.stops.map((s) => s.station.id).join() && plan1.stops.every((s, i) => s.waitMin === plan0.stops[i].waitMin), ids1.join());
  }
  // usable(): NDW eski alanında out=null → 'out' olmaz (kontrol; ayrık bir boşluk değil).
  ok("kontrol: usable(NDW fetched) — NDW 'out' üretmez", usable(sB) === true);
}

// ---------- 3) KNOWN-GAP: kaynak denetimi — nav/planlayıcı KARAR yolu fail-closed karara bağlı değil ----------
{
  const files = { nearby: read('js/nav/nearby.js'), routePanel: read('js/ui/routePanel.js'), planner: read('js/routing/planner.js'), livePlan: read('js/routing/livePlan.js'), slots: read('js/routing/slots.js'), sw: read('sw.js') };
  // D3-T4: GÖRÜNTÜ yolu (slots.js slotEl/slotLabel) saf occupancyDecision'a bağlandı. D3-T5: KARAR yolu (slotKind/isFresh →
  // planner, livePlan, nearby gone(), nearSort, chargePick, routeOptions) aynı doğrulanmış karara (trustedOccupancy) bağlandı.
  const decide = (src) => /occupancyLabel|formatOccupancy|occupancyView|occupancyDecision/.test(src);
  const slotsDecision = files.slots.replace(/\/\/.*$/gm, '').split(/\nexport /).filter((b) => /^(function slotKind|const isFresh|function slotsOf)/.test(b));
  const usesFormatter = [...Object.entries(files).filter(([k]) => !['sw', 'slots'].includes(k)).filter(([, src]) => decide(src)).map(([k]) => k), ...(slotsDecision.length === 3 && slotsDecision.some(decide) ? ['slots(slotKind/isFresh)'] : [])];
  ok('kaynak: slots.js karar gövdeleri (slotKind/isFresh/slotsOf) bulundu', slotsDecision.length === 3, String(slotsDecision.length));
  const kindBody = slotsDecision.find((b) => b.startsWith('function slotKind')) || '', freshBody = slotsDecision.find((b) => b.startsWith('const isFresh')) || '';
  ok('ACCEPT G6 (D3-T5): slots slotKind/isFresh fail-closed kararı (trustedOccupancy → occupancyDecision) kullanır', usesFormatter.includes('slots(slotKind/isFresh)') && /trustedOccupancy\(/.test(kindBody) && /trustedOccupancy\(/.test(freshBody), usesFormatter.join());
  // G6b KAPANDI (D3-T4): karar + biçimlendirici yayında yüklenir.
  ok('ACCEPT G6b (D3-T4): sw.js SHELL occupancyDecision.js + occupancyLabel.js + communityReport.js içerir', ['occupancyDecision', 'occupancyLabel', 'communityReport'].every((m) => files.sw.includes(`'./js/routing/${m}.js'`)));
  ok('ACCEPT (D3-T4): slots.js görüntü yolu occupancyDecision kullanır', /import \{ occupancyDecision \} from '\.\/occupancyDecision\.js'/.test(files.slots) && /occupancyDecision\(sl, \{ now \}\)/.test(files.slots));
  // Bağlantı noktaları bugün eski yolu kullanıyor (gelecekteki düzeltmenin dokunacağı yerler):
  ok('kaynak: planner usable/waitMin/fullNear isFresh+slotKind kullanır', /usable = \(s\) => meetsPower\(s\) && !\(isFresh\(s\) && slotKind\(s\) === 'out'\)/.test(files.planner)
    && /waitMin = \(s, fromKm\) => \(isFresh\(s\) && slotKind\(s\) === 'full'/.test(files.planner) && /fullNear = [^\n]*isFresh\(s\) && slotKind\(s\) === 'full'/.test(files.planner));
  ok('kaynak: nearby gone() isFresh+slotKind kullanır', /const gone = \(s\) => \{ const k = slotKind\(s\); return k === 'out' \|\| \(premium && k === 'full' && isFresh\(s\)\); \}/.test(files.nearby));
  ok('kaynak: nearby liste/uyarı slotEl kullanır (D3-T4: ayrı "eski" etiketi yok)', /const slotNode = slotEl\(s\);/.test(files.nearby) && /slotEl\(s, ''\)/.test(files.nearby) && !/doluluk bilgisi eski/.test(files.nearby));
  ok('kaynak: routePanel durak satırı slotEl kullanır', /slotEl\(s\.station\)/.test(files.routePanel));
  ok('kaynak: livePlan slotKind ile "şu an boş yuva yok" söyler', /slotKind\(worse\) === 'out' \? 'şarj üniteleri arızalı' : 'şu an boş yuva yok'/.test(files.livePlan));
  ok("ACCEPT (D3-T5): slots.isFresh okuma anı ('checked') değil doğrulanmış karar", /isFresh = \(s, now = Date\.now\(\)\) => !!trustedOccupancy\(s\?\.slots, now\)/.test(files.slots) && !/checked/.test(freshBody));
}

// ---------- 4) ACCEPT: gelecekteki düzeltmenin kabul ölçütleri (bugün yalnız biçimlendirici için doğrulanabilir) ----------
// Sözleşme: nav/planlayıcının "taze" ve "boş/dolu/arızalı" kararı = formatOccupancy(slots.availability) sonucu.
//  trusted(s)    := d.confirmed === true            (sağlayıcı zamanı + ≤15 dk + tutarlı sayılar + bilinen kaynak, simüle değil)
//  shownState(s) := d.state  ('unknown' → "boş"/"dolu" yazılmaz)
//  plannerFull   := trusted && d.state === 'busy';  plannerOut := trusted && d.state === 'out'
const contract = (slots) => { const d = fmt(slots); return { trusted: d.confirmed === true, shown: d.state, plannerFull: d.confirmed === true && d.state === 'busy', plannerOut: d.confirmed === true && d.state === 'out' }; };
{
  const cF = contract(NDW_FREE), cB = contract(NDW_FULL);
  ok('ACCEPT(formatter): NDW fetched → trusted false', !cF.trusted && !cB.trusted);
  ok('ACCEPT(formatter): NDW fetched → gösterilen durum unknown', cF.shown === 'unknown' && cB.shown === 'unknown');
  ok('ACCEPT(formatter): NDW fetched 0/4 → plannerFull false, plannerOut false', !cB.plannerFull && !cB.plannerOut);
  const cP = contract(PROV_FULL);
  ok('ACCEPT(formatter): sağlayıcı zamanlı taze dolu → plannerFull true (işlev korunur)', cP.trusted && cP.plannerFull);
  ok('ACCEPT(formatter): eski kayıt → trusted false', !contract(PROV_STALE).trusted);
  ok('ACCEPT(formatter): availability yok (eski biçim) → trusted false', !contract({ total: 4, available: 0, out: 0, at: NOW, checked: NOW, src: 'ndw' }).trusted);
  ok('ACCEPT(formatter): simüle (mock) → trusted false', !contract({ availability: { ...NDW_FREE.availability, simulated: true, timestampKind: 'provider', at: NOW } }).trusted);
  // Nav/planlayıcı tarafı: bugünkü davranış sözleşmeyi ihlal ediyor mu? (ihlal = bilinen boşluk; G1/G2/G5 ile aynı kök)
  const violates = (slots) => { const s = station('v', slots); const c = contract(slots); return (isFresh(s) && slotKind(s) === 'full') !== c.plannerFull || (isFresh(s) && slotKind(s) !== 'unknown' && c.shown === 'unknown'); };
  ok('ACCEPT G7 (D3-T5): nav/planlayıcı kararı sözleşmeden sapmaz (NDW fetched 2/4 ve 0/4, 3 sa eski)', !violates(NDW_FREE) && !violates(NDW_FULL) && !violates(PROV_STALE));
  ok('ACCEPT: sağlayıcı zamanlı taze boş/dolu kayıtta bugün de sapma yok', !violates(PROV_FREE) && !violates(PROV_FULL));
}

const present = results.filter((r) => r.present).length;
console.log(`\ntest-occupancy-consistency-contract: ${pass} passed, ${fail} failed; known gaps present (beklenen bulgu, düzeltilmedi): ${present}/${results.length} [${results.filter((r) => r.present).map((r) => r.id).join(', ')}]`);
process.exit(fail ? 1 : 0);
